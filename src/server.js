import express from 'express';
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import zlib from 'node:zlib';
import QRCode from 'qrcode';

import { Game, PHASE } from './game.js';
import { persistResults, persistence } from './persist.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const PORT = Number(process.env.PORT) || 8080;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || null;
const TICK_MS = Number(process.env.TICK_MS) || 100;
const IS_PROD = process.env.NODE_ENV === 'production' || !!process.env.GOOGLE_CLOUD_PROJECT;

// The event password, as a scrypt hash. The plaintext is deliberately not in this
// repository: cloning it must not hand someone the ability to reset a live round.
// A hash is enough to *check* a password and useless for reading one back, and
// baking it in means the deployment needs no secret plumbing at all.
// Regenerate with: npm run admin:hash
const ADMIN_PASSWORD_HASH =
  process.env.ADMIN_PASSWORD_HASH ||
  'scrypt$16384$8$1$7KgtFie_C32QzHXn06YxdQ$Z6JI8v-NJ5AEaZk-kSgLDiMDzM9elhJTG104slseTe8';

// The baked-in password is a real one, so booting with no configuration is now
// safe. An *explicitly* weak override is not — that is how test tokens reach
// production by accident.
if (IS_PROD && ADMIN_TOKEN !== null && ADMIN_TOKEN.length < 12) {
  console.error('FATAL: ADMIN_TOKEN is set but too weak for production. Unset it to use the built-in password.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Admin auth
//
// `/host` is a public URL and the password is the kind of thing a bored attendee
// guesses from the event name, so this is more careful than the room deserves:
// constant-time comparison, a throttle on wrong guesses, and — once you are in —
// a session cookie, so the host page never has to keep the password anywhere
// JavaScript (or a shoulder, or a projector) can read it.
// ---------------------------------------------------------------------------
const ADMIN_COOKIE = 'tr_admin';
const ADMIN_SESSION_MS = Number(process.env.ADMIN_SESSION_MS) || 12 * 3600 * 1000;
const adminSessions = new Map(); // sid -> expiresAt

// Digest first: timingSafeEqual throws on a length mismatch, and the length of a
// password is itself worth not leaking. SHA-256 makes every candidate 32 bytes.
const digest = (s) => createHash('sha256').update(String(s)).digest();
const ADMIN_TOKEN_DIGEST = ADMIN_TOKEN === null ? null : digest(ADMIN_TOKEN);

const [, scryptN, scryptR, scryptP, scryptSalt, scryptHash] = ADMIN_PASSWORD_HASH.split('$');
const SCRYPT_PARAMS = {
  N: Number(scryptN),
  r: Number(scryptR),
  p: Number(scryptP),
  maxmem: 64 * 1024 * 1024,
};
const SCRYPT_SALT = Buffer.from(scryptSalt, 'base64url');
const SCRYPT_EXPECTED = Buffer.from(scryptHash, 'base64url');

/**
 * True if `given` is the admin password.
 *
 * ADMIN_TOKEN, when set, overrides the baked-in password — that is how the test
 * harnesses and local dev get a cheap, known token. Otherwise the candidate is
 * run through scrypt, which is ~77ms of deliberate work: slow enough to make
 * guessing pointless, and run on the threadpool rather than the event loop,
 * because blocking that would stall the round for every phone in the room.
 */
function verifyAdmin(given) {
  if (typeof given !== 'string' || given.length === 0 || given.length > 256) {
    return Promise.resolve(false);
  }
  if (ADMIN_TOKEN_DIGEST !== null) {
    return Promise.resolve(timingSafeEqual(digest(given), ADMIN_TOKEN_DIGEST));
  }
  return new Promise((resolve) => {
    scrypt(given, SCRYPT_SALT, SCRYPT_EXPECTED.length, SCRYPT_PARAMS, (err, derived) => {
      resolve(!err && timingSafeEqual(derived, SCRYPT_EXPECTED));
    });
  });
}

// Failed guesses get slower. Two caps keep this from becoming an own-goal on a
// single instance: the delay itself, and how many delayed responses may be
// waiting at once — otherwise an attacker could park concurrency slots that the
// 5.000 phones need (docs/SCALE.md, finding 4). A correct password resets it, so
// the host is never locked out by someone else's guessing.
const AUTH_DELAY_STEP_MS = 250;
const AUTH_DELAY_MAX_MS = 2000;
const AUTH_DELAY_MAX_PENDING = 16;
let authFailures = 0;
let authDelaysPending = 0;

function rejectAdmin(res) {
  authFailures += 1;
  const delay = Math.min(authFailures * AUTH_DELAY_STEP_MS, AUTH_DELAY_MAX_MS);
  const send = () => res.status(401).json({ error: 'bad admin token' });
  if (authDelaysPending >= AUTH_DELAY_MAX_PENDING) return send();
  authDelaysPending += 1;
  setTimeout(() => {
    authDelaysPending -= 1;
    send();
  }, delay);
}

function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

function sessionOk(sid) {
  if (!sid) return false;
  const expires = adminSessions.get(sid);
  if (expires === undefined) return false;
  if (expires <= Date.now()) {
    adminSessions.delete(sid);
    return false;
  }
  return true;
}

function issueSession(req, res) {
  for (const [sid, expires] of adminSessions) {
    if (expires <= Date.now()) adminSessions.delete(sid);
  }
  const sid = randomBytes(32).toString('base64url');
  adminSessions.set(sid, Date.now() + ADMIN_SESSION_MS);
  // HttpOnly so no script can read it back out; Strict so a hostile page cannot
  // ride it to /admin/reset. Secure only when the hop is actually TLS, or a
  // localhost dev session would silently never receive the cookie.
  const https = req.secure || req.get('x-forwarded-proto') === 'https';
  res.setHeader(
    'Set-Cookie',
    `${ADMIN_COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(ADMIN_SESSION_MS / 1000)}` +
      (https ? '; Secure' : ''),
  );
  return sid;
}

// `|| undefined` would swallow a deliberate 0 (e.g. GRACE_MS=0 to disable the
// grace window), so fall through to the Game defaults only when truly unset.
const numEnv = (name) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
};

const game = new Game({
  durationMs: Number(process.env.DURATION_MS) || 30000,
  // Scale knobs — see docs/SCALE.md. Defaults are tuned for a single Cloud Run
  // instance up to ~5.000 players; override only if you have measured something.
  graceMs: numEnv('GRACE_MS'), // set to pin the window; otherwise it sizes itself per round
  minGraceMs: numEnv('MIN_GRACE_MS'),
  maxGraceMs: numEnv('MAX_GRACE_MS'),
  lateArrivalMs: numEnv('LATE_ARRIVAL_MS'),
  requestBudgetRps: numEnv('REQUEST_BUDGET_RPS'),
  minTapIntervalMs: numEnv('MIN_TAP_INTERVAL_MS'),
  maxTapIntervalMs: numEnv('MAX_TAP_INTERVAL_MS'),
  minPollIntervalMs: numEnv('MIN_POLL_INTERVAL_MS'),
  maxPollIntervalMs: numEnv('MAX_POLL_INTERVAL_MS'),
  onEnded: (results) => { persistResults(results); },
});

const app = express();
app.disable('x-powered-by');

// ---------------------------------------------------------------------------
// Observability. Node's event loop is the resource that actually runs out here
// (it cannot use a second core — docs/SCALE.md, finding 3), and loop lag is the
// earliest, clearest signal that it is losing. Sampling costs one timer.
// ---------------------------------------------------------------------------
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS) || 10000;
const LAG_SAMPLE_MS = 500;
let reqCount = 0;
let lagMaxMs = 0;
let lagLast = Date.now();

// Deliberately NOT counting in-flight requests here. Every handler on this
// server is synchronous, so Express is never inside two of them at once: an
// in-flight gauge reads 1 no matter how deep the backlog is. The queue lives in
// the kernel accept backlog, which userland cannot see. Measured at 5.000
// players (docs/SCALE.md, finding 8): an unspread buzzer herd that refused
// 1.339 taps still reported one request in flight. Loop lag caught it — 166ms
// against 1ms for the spread herd — so lag is the herd signal, and `conns` is
// the one that tracks the 1.000-concurrency cliff.
app.use((_req, _res, next) => {
  reqCount += 1;
  next();
});
app.use(express.json({ limit: '8kb' }));

// ---------------------------------------------------------------------------
// Static clients
//
// The lobby is the heaviest moment of the whole event: 5.000 phones fetch
// 25,5K of HTML+CSS in about five seconds — 124,7 MiB off a single instance.
// So compress it, once, at boot: gzip takes that to ~45 MiB and brotli to
// ~38 MiB. Compressing per request would spend the only core we have on work
// whose answer never changes (docs/SCALE.md, findings 6 and 7).
// ---------------------------------------------------------------------------
/** @type {Map<string, {type:string, etag:string, raw:Buffer, gzip:Buffer, br:Buffer}>} */
const TEXT_ASSETS = new Map();

function precompress(file, type, urls) {
  const raw = fs.readFileSync(path.join(PUBLIC_DIR, file));
  const entry = {
    type,
    // Content-addressed, so a redeploy that changes nothing still revalidates
    // to a 304 and a redeploy that changes something busts instantly.
    etag: `"${createHash('sha1').update(raw).digest('base64url').slice(0, 20)}"`,
    raw,
    gzip: zlib.gzipSync(raw, { level: zlib.constants.Z_BEST_COMPRESSION }),
    br: zlib.brotliCompressSync(raw, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
      },
    }),
  };
  for (const u of urls) TEXT_ASSETS.set(u, entry);
  return entry;
}

precompress('index.html', 'text/html; charset=utf-8', ['/', '/index.html']);
precompress('screen.html', 'text/html; charset=utf-8', ['/screen', '/screen.html']);
precompress('host.html', 'text/html; charset=utf-8', ['/host', '/host.html']);
precompress('theme.css', 'text/css; charset=utf-8', ['/theme.css']);

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const asset = TEXT_ASSETS.get(req.path);
  if (!asset) return next();

  res.setHeader('Content-Type', asset.type);
  res.setHeader('Vary', 'Accept-Encoding');
  // no-cache, not no-store: the phone still revalidates on every load (so a
  // mid-event redeploy is picked up immediately), but an unchanged file comes
  // back as a ~200-byte 304 instead of 25,5K. Reloads are common at events —
  // people lock their phone, lose wifi, and pull to refresh.
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('ETag', asset.etag);

  const inm = req.headers['if-none-match'];
  if (inm && inm.replace(/^W\//, '') === asset.etag) return res.status(304).end();

  const accept = req.headers['accept-encoding'] || '';
  let body = asset.raw;
  if (/\bbr\b/.test(accept)) {
    res.setHeader('Content-Encoding', 'br');
    body = asset.br;
  } else if (/\bgzip\b/.test(accept)) {
    res.setHeader('Content-Encoding', 'gzip');
    body = asset.gzip;
  }
  res.setHeader('Content-Length', body.length);
  if (req.method === 'HEAD') return res.end();
  res.end(body);
});

// Fonts (and anything else) still come off disk — they are content-stable and
// already compressed, so there is nothing for the middleware above to save.
app.use(
  express.static(PUBLIC_DIR, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.woff2')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      else if (filePath.endsWith('.html') || filePath.endsWith('.css')) res.setHeader('Cache-Control', 'no-cache');
    },
  }),
);

// ---------------------------------------------------------------------------
// Player API  (phones: write-mostly)
// ---------------------------------------------------------------------------

// Register a new player. The server owns identity (auto-generated name).
// The player's language comes from Accept-Language rather than a field the
// phone has to send: every browser already sets it, it rides along on the
// self-healing rejoin below for free, and it costs no bytes on the hot path.
app.post('/join', (req, res) => {
  const id = randomUUID();
  const ident = game.join(id, req.get('accept-language'));
  res.json(ident);
});

// Record a batch of taps and return this player's live view.
// Self-healing: if the id is unknown (e.g. server restarted), transparently
// re-issue a fresh identity so the phone keeps working without a reload.
app.post('/tap', (req, res) => {
  const now = Date.now();
  let { id, n } = req.body || {};
  if (!id || !game.has(id)) {
    id = randomUUID();
    const ident = game.join(id, req.get('accept-language'));
    return res.json({ ...game.playerView(id, now), ...ident, rejoined: true });
  }
  res.json(game.tap(id, n, now));
});

// Lightweight state poll used by phones during lobby/countdown (no taps yet).
// Deliberately a pure read: it must NOT call game.tick(), which re-sorts every
// player. The 100ms loop below already advances the machine, so the worst case
// here is 100ms of staleness. Calling tick() per request cost 4.8s p50 at 5.000
// players (docs/SCALE.md, finding 1) — do not add it back.
app.get('/state', (req, res) => {
  const now = Date.now();
  const id = req.query.id;
  if (id && game.has(id)) return res.json(game.playerView(id, now));
  res.json(game.playerView(null, now));
});

// ---------------------------------------------------------------------------
// Big-screen API  (read-only SSE)
// ---------------------------------------------------------------------------
const sseClients = new Set();

app.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // disable proxy buffering (matters behind LBs)
  });
  res.write('retry: 2000\n\n');
  res.write(`data: ${JSON.stringify(game.publicState(Date.now()))}\n\n`);
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

function broadcast() {
  if (sseClients.size === 0) return;
  const payload = `data: ${JSON.stringify(game.publicState(Date.now()))}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch { sseClients.delete(res); }
  }
}

// Authoritative loop: advance phase machine + refresh rank snapshot + push.
const tickTimer = setInterval(() => {
  game.tick(Date.now());
  broadcast();
}, TICK_MS);

// A timer that should fire every LAG_SAMPLE_MS; whatever it overshoots by is
// time the loop spent blocked. Peak matters more than average — a 400ms stall
// is a visibly frozen leaderboard even if the mean looks healthy.
const lagTimer = setInterval(() => {
  const now = Date.now();
  const lag = now - lagLast - LAG_SAMPLE_MS;
  if (lag > lagMaxMs) lagMaxMs = lag;
  lagLast = now;
}, LAG_SAMPLE_MS);
lagTimer.unref();

const beatTimer = setInterval(() => {
  const rps = Math.round((reqCount / HEARTBEAT_MS) * 1000);
  const rssMb = Math.round(process.memoryUsage.rss() / 1048576);
  const lag = Math.max(0, lagMaxMs);
  reqCount = 0;
  lagMaxMs = 0;
  // Open sockets, not requests. Keep-alive is on, so this is roughly the fan-in
  // the instance is holding — the number that walks toward Cloud Run's hard
  // 1.000-concurrency cap when a herd arrives.
  server.getConnections((_err, conns) => {
    console.log(
      `beat phase=${game.phase} players=${game.players.size} taps=${game.totalTaps} ` +
        `rps=${rps} conns=${conns ?? -1} lag_max=${lag}ms ` +
        `rss=${rssMb}MB sse=${sseClients.size}`,
    );
  });
}, HEARTBEAT_MS);
beatTimer.unref();

// ---------------------------------------------------------------------------
// Host / admin API
// ---------------------------------------------------------------------------
/**
 * Resolves true if the request may drive the game, false once it has been
 * answered with a 401. A live session cookie is checked first and costs nothing;
 * only a raw password falls through to scrypt.
 */
async function checkAdmin(req, res) {
  if (sessionOk(readCookie(req, ADMIN_COOKIE))) return true;
  // Header or JSON body only — never the query string (it would land in access logs).
  const token = req.get('x-admin-token') || req.body?.token;
  if (await verifyAdmin(token)) {
    authFailures = 0;
    return true;
  }
  rejectAdmin(res);
  return false;
}

// Exchange the password for a session, so the host page can forget it. This is
// the only endpoint that needs the password itself.
app.post('/admin/login', async (req, res) => {
  if (!(await verifyAdmin(req.body?.token))) return rejectAdmin(res);
  authFailures = 0;
  issueSession(req, res);
  res.json({ ok: true, expiresInMs: ADMIN_SESSION_MS });
});

app.post('/admin/logout', (req, res) => {
  const sid = readCookie(req, ADMIN_COOKIE);
  if (sid) adminSessions.delete(sid);
  res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
  res.json({ ok: true });
});

// Cheap "am I still logged in?" so the host page can render the right state on
// load without holding the password. Deliberately says nothing else.
app.get('/admin/session', (req, res) => {
  res.json({ authenticated: sessionOk(readCookie(req, ADMIN_COOKIE)) });
});

app.post('/admin/start', async (req, res) => {
  if (!(await checkAdmin(req, res))) return;
  const durationMs = Number(req.body?.durationMs) || undefined;
  const state = game.start({ durationMs, now: Date.now() });
  broadcast();
  res.json(state);
});

app.post('/admin/reset', async (req, res) => {
  if (!(await checkAdmin(req, res))) return;
  const state = game.reset({ now: Date.now() });
  broadcast();
  res.json(state);
});

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

// Server-rendered QR (no CDN, works on flaky event wifi). ?data=<url>
const qrCache = new Map();
app.get('/qr.svg', async (req, res) => {
  const data = String(req.query.data || '');
  if (!data || data.length > 512) return res.status(400).send('bad data');
  try {
    let svg = qrCache.get(data);
    if (!svg) {
      if (qrCache.size > 64) qrCache.clear(); // bound it — legitimate cardinality is ~1 (the origin URL)
      svg = await QRCode.toString(data, {
        type: 'svg',
        margin: 1,
        errorCorrectionLevel: 'M',
        color: { dark: '#0b0b14', light: '#ffffff' },
      });
      qrCache.set(data, svg);
    }
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(svg);
  } catch {
    res.status(500).send('qr error');
  }
});

// /livez is canonical; /healthz is shadowed by the Cloud Run front-end, so keep both.
app.get(['/livez', '/healthz'], (_req, res) => res.json({ ok: true, phase: game.phase, players: game.players.size }));

// Deliberately says nothing about the admin password — not the value, not
// whether one is configured. It used to return the token outright so the host
// page could prefill it, but /config is public: every attendee could read it and
// /admin/reset the round out from under the room.
app.get('/config', (_req, res) =>
  res.json({ phase: game.phase, persist: persistence.isEnabled(), durationMs: game.defaultDurationMs }),
);

// ---------------------------------------------------------------------------
const server = app.listen(PORT, () => {
  console.log(`🔥 Tap Race on :${PORT}  | phone:/  screen:/screen  host:/host`);
  console.log(`   admin auth : ${ADMIN_TOKEN === null ? 'built-in password' : 'ADMIN_TOKEN override'}`);
  console.log(`   persistence: ${persistence.isEnabled() ? 'firestore' : 'off (in-memory only)'}`);
});

// keepAliveTimeout only governs *idle* periods between completed responses — an
// in-flight SSE stream is never closed by it (verified: a stream writing every
// 100ms survived a 1s timeout indefinitely). It is still 0 here, but for the
// other reason: behind Google's front end, a server that closes an idle pooled
// connection first loses the race with a request already on the wire and the
// caller sees a 502. Never expiring is the safe side of that race, and the GFE
// pools connections to the container, so this does not mean 5.000 open sockets.
server.keepAliveTimeout = 0;
server.headersTimeout = 60000; // still reject clients that dribble request headers
server.requestTimeout = 0; // bodies are capped at 8kb by express.json

// With min=max=1 this process *is* the game: there is no second instance to
// take over and no store to recover from, so a crash 12 seconds into a round
// loses all 5.000 scores and the replacement comes up empty. Node's advice is
// to let the process die on an uncaught throw, and it is right that surviving
// one means running on possibly-inconsistent state. That trade is worth taking
// here: the state is a Map of counters, the realistic uncaught error is a
// socket write to a phone that walked out of wifi range, and the round is over
// in 30 seconds either way. Log loudly so it is not silent.
process.on('uncaughtException', (err) => {
  console.error('uncaughtException (staying up — single instance owns the round)', err);
});
process.on('unhandledRejection', (err) => {
  console.error('unhandledRejection (staying up — single instance owns the round)', err);
});

function shutdown(signal) {
  console.log(`\n${signal} received, shutting down…`);
  clearInterval(tickTimer);
  for (const res of sseClients) { try { res.end(); } catch { /* ignore */ } }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { app, game, PHASE };
