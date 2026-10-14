import express from 'express';
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import zlib from 'node:zlib';
import QRCode from 'qrcode';

import { Game, PHASE } from './game.js';
import { Batucada } from './batucada.js';
import { Vote } from './vote.js';
import { VoteGuard, clientIp, sameOrigin } from './vote-guard.js';
import { SEED_NAMES, SEED_CATEGORIES } from './vote-seed.js';
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

// A second, independent game living in the same process — see
// docs/BATUCADA_SPEC.md. Deliberately not wired into `game`'s persistence
// (out of scope for v1) or its tuning knobs: it has no continuous hot path
// like /tap, so none of Tap Race's adaptive-cadence machinery applies.
// The SEQ_* env vars exist for the test harnesses (a 10-round game at real
// speeds is minutes long) and for event-day pacing tweaks without a rebuild.
const batucada = new Batucada({
  totalRounds: numEnv('SEQ_ROUNDS'),
  symbolOnMs: numEnv('SEQ_SYMBOL_ON_MS'),
  symbolGapMs: numEnv('SEQ_SYMBOL_GAP_MS'),
  memorizeLeadInMs: numEnv('SEQ_MEMORIZE_LEAD_IN_MS'),
  recallBaseMs: numEnv('SEQ_RECALL_BASE_MS'),
  recallPerSymbolMs: numEnv('SEQ_RECALL_PER_SYMBOL_MS'),
  revealMs: numEnv('SEQ_REVEAL_MS'),
  bonusAfterRound: numEnv('SEQ_BONUS_AFTER'), // 0 disables the reflex round
  bonusArmMinMs: numEnv('SEQ_BONUS_ARM_MIN_MS'),
  bonusArmJitterMs: numEnv('SEQ_BONUS_ARM_JITTER_MS'),
  bonusHitWindowMs: numEnv('SEQ_BONUS_HIT_WINDOW_MS'),
});

// A third app in the same process — see docs/VOTE_SPEC.md. Same tick, same
// admin session; an admin-only SSE stream for the screen, and a shared,
// precompressed buffer that every phone polls (phones can't each hold a
// stream under Cloud Run's 1.000-connection cap). VOTE_CODE_MS and
// VOTE_MIN_DURATION_MS exist for the test harnesses only — an expired-code or
// deadline check should not take a minute.
const vote = new Vote({ names: SEED_NAMES, categories: SEED_CATEGORIES, minDurationMs: numEnv('VOTE_MIN_DURATION_MS') });
const voteGuard = new VoteGuard({ epochMs: numEnv('VOTE_CODE_MS') });
// Restarts reuse listVersion/roundId numbers from 1; this tells a phone (and
// its HTTP cache) that a "v2" from before a restart is not this "v2".
const VOTE_BOOT = randomBytes(6).toString('hex');

const app = express();
app.disable('x-powered-by');

// ---------------------------------------------------------------------------
// Observability. Node's event loop is the resource that actually runs out here
// (it cannot use a second core — docs/SCALE.md, finding 3), and loop lag is the
// earliest, clearest signal that it is losing. Sampling costs one timer.
//
// Everything here feeds a single 1 Hz sampler (below, next to the game loop).
// It drains these counters into a two-minute ring and — only when a dashboard
// is actually watching — builds and gzips the whole /metrics payload once. That
// is what makes a *public* /metrics safe: the handler writes a buffer and does
// no work of its own, however many people open it.
// ---------------------------------------------------------------------------
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS) || 10000;
const LAG_SAMPLE_MS = 500;
const SAMPLE_MS = 1000;
const HISTORY_SAMPLES = 120; // two minutes at 1 Hz — the sparkline window
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
// 300 names × 60 chars is ~18 KB — over the 8 KB every other route lives
// under. body-parser skips a body that's already been parsed, so this
// route-scoped parser simply wins for this one path.
app.use('/vote/admin/config', express.json({ limit: '64kb' }));
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

/**
 * RFC 9110 §13.1.2: If-None-Match is a *list* of entity-tags, or `*`. Comparing
 * the raw header to a single tag is right for the common browser case and wrong
 * for every intermediary that adds one — and getting it wrong turns a 200-byte
 * revalidation back into a full page, which at 5.000 phones is the difference
 * this whole precompress block exists to buy.
 */
function etagMatches(header, etag) {
  if (!header) return false;
  if (header.trim() === '*') return true;
  for (const candidate of header.split(',')) {
    if (candidate.trim().replace(/^W\//, '') === etag) return true;
  }
  return false;
}

// One shared entry per URL: the pages are language-independent, so there is no
// Vary: Accept-Language and every phone revalidates against the same ETag.
const HTML = 'text/html; charset=utf-8';
precompress('index.html', HTML, ['/', '/index.html']);
precompress('screen.html', HTML, ['/screen', '/screen.html']);
precompress('host.html', HTML, ['/host', '/host.html']);
precompress('dashboard.html', HTML, ['/dashboard', '/dashboard.html']);
precompress('theme.css', 'text/css; charset=utf-8', ['/theme.css']);
precompress('batucada/phone.html', HTML, ['/batucada', '/batucada/', '/batucada/phone.html']);
precompress('batucada/screen.html', HTML, ['/batucada/screen', '/batucada/screen.html']);
precompress('vote/search.js', 'text/javascript; charset=utf-8', ['/vote/search.js']);
precompress('vote/phone.html', HTML, ['/vote', '/vote/', '/vote/phone.html']);
precompress('vote/screen.html', HTML, ['/vote/screen', '/vote/screen.html']);

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

  if (etagMatches(req.headers['if-none-match'], asset.etag)) return res.status(304).end();

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
//
// `?lang=` overrides it, forwarded by the phone from its own query string, so a
// link handed out as /?lang=de mints German names whatever the browser asks for.
// normalizeLocale already bounds and sanitises anything arriving here
// (src/names.js:49).
app.post('/join', (req, res) => {
  const id = randomUUID();
  const ident = game.join(id, req.query.lang || req.get('accept-language'));
  res.json(ident);
});

// Record a batch of taps and return this player's live view.
// Self-healing: if the id is unknown (e.g. server restarted), transparently
// re-issue a fresh identity so the phone keeps working without a reload.
// This path stays on Accept-Language: /tap is the hot path and carrying a
// `lang` on every batch would cost the whole room bandwidth to serve a rejoin
// that only happens after a restart. The re-minted name may then differ from a
// picker choice — names already mix by design (README, "Player names").
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
// Batucada  (companion game — see docs/BATUCADA_SPEC.md)
// ---------------------------------------------------------------------------

app.post('/batucada/join', (req, res) => {
  const id = randomUUID();
  const ident = batucada.join(id, req.query.lang || req.get('accept-language'));
  res.json(ident);
});

// One POST per round, not a continuous batched stream like /tap — so none of
// Tap Race's adaptive-cadence machinery is needed on this path.
app.post('/batucada/recall', (req, res) => {
  const now = Date.now();
  let { id, sequence } = req.body || {};
  if (!id || !batucada.has(id)) {
    id = randomUUID();
    const ident = batucada.join(id, req.get('accept-language'));
    return res.json({ ...batucada.playerView(id, now), ...ident, rejoined: true });
  }
  // A genuinely new answer pops the player's animal emoji on the big screen —
  // the room watching itself arrive, one by one. Detected by the counter
  // moving, so retries and late taps never double-pop.
  const before = batucada.submittedCount;
  const view = batucada.recall(id, sequence, now);
  if (batucada.submittedCount > before && view.emoji) submitPops.push(view.emoji);
  res.json(view);
});

// Pure read, same reason as /state above: the tick loop already advances the
// phase machine, so calling it again per request would just re-pay that cost.
app.get('/batucada/state', (req, res) => {
  const now = Date.now();
  const id = req.query.id;
  if (id && batucada.has(id)) return res.json(batucada.playerView(id, now));
  res.json(batucada.playerView(null, now));
});

// ---------------------------------------------------------------------------
// Crowd reactions — plateia noise, deliberately NOT game state, so it lives
// here and not in the engine. Phones POST an emoji index; the counts ride the
// next SSE frame as deltas and the screen floats them up. Blocked during the
// phases that need silence (the flash, the bonus suspense/hit), throttled
// per player so one thumb cannot become a firehose.
// ---------------------------------------------------------------------------
const REACTION_COUNT = 4; // 🔥 👏 😱 ❤️ — order shared with both client pages
const REACT_MIN_INTERVAL_MS = 250;
const REACT_BLOCKED_PHASES = new Set(['memorize', 'bonus_arm', 'bonus_hit']);
let reactionDeltas = new Array(REACTION_COUNT).fill(0);
const lastReactAt = new Map(); // playerId -> last accepted reaction timestamp
let submitPops = []; // animal emojis of players whose answer just landed (drained per frame)

app.post('/batucada/react', (req, res) => {
  const { id, r } = req.body || {};
  const idx = Number(r);
  if (!batucada.has(id) || !Number.isInteger(idx) || idx < 0 || idx >= REACTION_COUNT) {
    return res.status(400).json({ ok: false });
  }
  if (REACT_BLOCKED_PHASES.has(batucada.phase)) return res.json({ ok: false, blocked: true });
  const now = Date.now();
  if (now - (lastReactAt.get(id) ?? 0) < REACT_MIN_INTERVAL_MS) {
    return res.json({ ok: false, throttled: true });
  }
  // Bounded by the roster in practice (only known ids get here); the sweep
  // guards a very long day of resets re-minting ids.
  if (lastReactAt.size > 20000) lastReactAt.clear();
  lastReactAt.set(id, now);
  reactionDeltas[idx] += 1;
  res.json({ ok: true });
});

const batucadaSseClients = new Set();

app.get('/batucada/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');
  res.write(`data: ${JSON.stringify(batucada.publicState(Date.now()))}\n\n`);
  batucadaSseClients.add(res);
  req.on('close', () => batucadaSseClients.delete(res));
});

function broadcastBatucada() {
  if (batucadaSseClients.size === 0) {
    // Nobody watching: drop the deltas rather than hoarding them for a burst
    // the moment a screen connects.
    if (reactionDeltas.some((c) => c > 0)) reactionDeltas = new Array(REACTION_COUNT).fill(0);
    if (submitPops.length) submitPops = [];
    return;
  }
  const state = batucada.publicState(Date.now());
  if (reactionDeltas.some((c) => c > 0)) {
    state.reactions = reactionDeltas;
    reactionDeltas = new Array(REACTION_COUNT).fill(0);
  }
  if (submitPops.length) {
    state.pops = submitPops.slice(0, 12); // a 300-answer stampede stays a stream, not a wall
    submitPops = [];
  }
  const payload = `data: ${JSON.stringify(state)}\n\n`;
  for (const res of batucadaSseClients) {
    try { res.write(payload); } catch { batucadaSseClients.delete(res); }
  }
}

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
// Drives Batucada and Live Vote too — one clock for every app rather than
// timers that can drift against each other.
const tickTimer = setInterval(() => {
  game.tick(Date.now());
  broadcast();
  batucada.tick(Date.now());
  broadcastBatucada();
  const now = Date.now();
  vote.tick(now);
  voteDetect(now);
  broadcastVote(now);
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

// ---------------------------------------------------------------------------
// Dashboard sampler  (feeds /metrics and the heartbeat)
// ---------------------------------------------------------------------------

/** Parallel int arrays, not one object per sample: ~5x smaller on the wire. */
const history = { tapsPerSec: [], rps: [], lagMs: [], players: [], conns: [] };

let lastTotalTaps = 0;
let lastPlayers = 0;
let lastConns = -1; // getConnections is async; sampled once a second and cached
let lastCpu = process.cpuUsage();
let cpuPct = 0;
let joinsPerSec = 0;
let peakTapsPerSec = 0;
let peakRoundId = -1;

// The one boolean the whole design rests on. game.stats() is O(n) over the
// roster, so an event with no dashboard open must not pay for it — the sampler
// skips the entire build unless someone asked for /metrics since it last ran.
let metricsWanted = false;
let snapshotRaw = null; // Buffer, pre-serialised
let snapshotGzip = null; // Buffer, pre-compressed
let snapshotAt = 0;

function pushSample(arr, v) {
  if (arr.length >= HISTORY_SAMPLES) arr.shift();
  arr.push(v);
}

/**
 * The entire dashboard payload. Runs inside the sampler, at most once a second.
 *
 * Deliberately absent, because this URL is public and unauthenticated: env
 * vars, filesystem paths, the Node version, the admin session count, anything
 * about how auth is configured. rss / lag / conns are in precisely because they
 * are the demo — one pinned instance absorbing the room.
 */
function buildSnapshot(now) {
  const mem = process.memoryUsage();
  const s = game.stats();
  const players = game.players.size;
  const n = history.rps.length;
  return {
    sampleAt: now,
    uptimeMs: Math.round(process.uptime() * 1000),
    refreshMs: SAMPLE_MS, // how soon it is worth the page coming back

    phase: game.phase,
    roundId: game.roundId,
    settled: game.settled,
    startsAt: game.startsAt,
    endsAt: game.endsAt,
    settlesAt: game.settlesAt,
    durationMs: game.durationMs,
    countdownMs: game.countdownMs,
    graceMs: game.graceMs,

    players,
    taps: game.totalTaps,
    tapsPerSec: history.tapsPerSec[n - 1] ?? 0,
    peakTapsPerSec,
    joinsPerSec, // the lobby filling up, which is its own kind of tense
    avgTapsPerPlayer: players ? Math.round((game.totalTaps / players) * 10) / 10 : 0,
    tapping: s.tapping,
    idle: s.idle,
    locales: s.locales,

    top: game.leaderboard(25),

    // What the server is currently telling phones to do. Watching this back off
    // as the room fills is the point of the adaptive cadence.
    cadence: {
      tapIntervalMs: game.tapIntervalMs(),
      pollIntervalMs: game.pollIntervalMs(),
      requestBudgetRps: game.requestBudgetRps,
      maxTapsPerBatch: game.maxTapsPerBatch,
    },

    server: {
      rps: history.rps[n - 1] ?? 0,
      lagMs: history.lagMs[n - 1] ?? 0,
      rssMb: Math.round(mem.rss / 1048576),
      heapMb: Math.round(mem.heapUsed / 1048576),
      conns: lastConns,
      sse: sseClients.size,
      cpuPct,
    },

    // t0 is derived rather than stored: the sampler is a 1 Hz interval, so the
    // oldest retained sample is (len-1) steps back. Good enough for a sparkline
    // and it keeps a whole array of timestamps off the wire.
    history: {
      stepMs: SAMPLE_MS,
      t0: now - Math.max(0, n - 1) * SAMPLE_MS,
      ...history,
    },
  };
}

function refreshSnapshot(now) {
  const json = Buffer.from(JSON.stringify(buildSnapshot(now)));
  snapshotRaw = json;
  // gzip only, at the default level: this is recompressed every second, unlike
  // the static pages, so brotli q11 would be paying seconds of CPU for a
  // payload that is already ~1 KB.
  snapshotGzip = zlib.gzipSync(json);
  snapshotAt = now;
}

const sampleTimer = setInterval(() => {
  const now = Date.now();

  const reqs = reqCount;
  reqCount = 0;
  const lag = Math.max(0, lagMaxMs);
  lagMaxMs = 0;

  const totalTaps = game.totalTaps;
  const players = game.players.size;
  // A new round zeroes totalTaps, so this delta goes negative exactly once per
  // round. Clamp rather than special-case: a "-260928 taps/s" spike on the
  // sparkline is worse than losing one sample of a round that just started.
  const tapsPerSec = Math.max(0, totalTaps - lastTotalTaps);
  joinsPerSec = Math.max(0, players - lastPlayers);
  lastTotalTaps = totalTaps;
  lastPlayers = players;

  const cpu = process.cpuUsage();
  const cpuMs = (cpu.user - lastCpu.user + cpu.system - lastCpu.system) / 1000;
  lastCpu = cpu;
  cpuPct = Math.round((cpuMs / SAMPLE_MS) * 100); // >100 is possible: --cpu 2

  if (game.roundId !== peakRoundId) {
    peakRoundId = game.roundId;
    peakTapsPerSec = 0;
  }
  if (tapsPerSec > peakTapsPerSec) peakTapsPerSec = tapsPerSec;

  pushSample(history.tapsPerSec, tapsPerSec);
  pushSample(history.rps, Math.round((reqs / SAMPLE_MS) * 1000));
  pushSample(history.lagMs, lag);
  pushSample(history.players, players);
  pushSample(history.conns, lastConns);

  // Cached for both the heartbeat and the snapshot, so neither has to make this
  // call itself. Open sockets, not requests: keep-alive is on, so this is
  // roughly the fan-in the instance is holding — the number that walks toward
  // Cloud Run's hard 1.000-concurrency cap when a herd arrives.
  server.getConnections((err, conns) => { lastConns = err ? -1 : conns; });

  if (metricsWanted) {
    metricsWanted = false;
    refreshSnapshot(now);
  }
}, SAMPLE_MS);
sampleTimer.unref();

const beatTimer = setInterval(() => {
  // Aggregated from the ring rather than from counters of its own, so the
  // heartbeat and the dashboard can never disagree about the same second.
  const want = Math.round(HEARTBEAT_MS / SAMPLE_MS);
  const from = Math.max(0, history.rps.length - want);
  let sum = 0;
  let lag = 0;
  for (let i = from; i < history.rps.length; i++) {
    sum += history.rps[i];
    if (history.lagMs[i] > lag) lag = history.lagMs[i];
  }
  const n = history.rps.length - from;
  const rps = n ? Math.round(sum / n) : 0;
  const rssMb = Math.round(process.memoryUsage.rss() / 1048576);
  console.log(
    `beat phase=${game.phase} players=${game.players.size} taps=${game.totalTaps} ` +
      `rps=${rps} conns=${lastConns} lag_max=${lag}ms ` +
      `rss=${rssMb}MB sse=${sseClients.size}`,
  );
}, HEARTBEAT_MS);
beatTimer.unref();

// ---------------------------------------------------------------------------
// Dashboard API  (public, read-only)
//
// Public and unauthenticated, which is the constraint that shaped everything
// above: fifty attendees can open this URL, so the handler must be O(1). It
// writes a buffer the sampler already built and compressed. Deliberately JSON
// and not the Prometheus text format, despite the name — the only consumer is
// /dashboard, and it wants a leaderboard and a phase machine, not counters.
// ---------------------------------------------------------------------------
const SNAPSHOT_STALE_MS = 2 * SAMPLE_MS;

app.get('/metrics', (req, res) => {
  metricsWanted = true; // tells the sampler to keep building while anyone watches
  const now = Date.now();
  // The escape hatch for a cold cache: the first visitor after an idle period
  // would otherwise see a snapshot minutes old. It cannot stampede — handlers
  // are synchronous, so the first caller refreshes and every other caller in
  // the same second finds it fresh.
  if (snapshotRaw === null || now - snapshotAt > SNAPSHOT_STALE_MS) refreshSnapshot(now);

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Accept-Encoding');
  // The clock, in a header rather than in the body — the body is up to a second
  // stale by construction, and a second of skew is the difference between "3…"
  // and "2…" on the countdown. This is the one number that must be read now, and
  // reading it costs a setHeader on a `now` the handler already has.
  res.setHeader('X-Server-Now', String(now));
  let body = snapshotRaw;
  if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    res.setHeader('Content-Encoding', 'gzip');
    body = snapshotGzip;
  }
  res.setHeader('Content-Length', body.length);
  if (req.method === 'HEAD') return res.end();
  res.end(body);
});

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

// Same password, same session cookie as Tap Race — one host controls both games.
app.post('/batucada/admin/start', async (req, res) => {
  if (!(await checkAdmin(req, res))) return;
  const totalRounds = Number(req.body?.totalRounds) || undefined;
  const state = batucada.start({ totalRounds, now: Date.now() });
  broadcastBatucada();
  res.json(state);
});

app.post('/batucada/admin/reset', async (req, res) => {
  if (!(await checkAdmin(req, res))) return;
  const state = batucada.reset({ now: Date.now() });
  broadcastBatucada();
  res.json(state);
});

// ---------------------------------------------------------------------------
// Live Vote  (companion app — see docs/VOTE_SPEC.md)
// ---------------------------------------------------------------------------
const VOTER_COOKIE = 'tv_voter';
const voteSseClients = new Set();
let voteScreenDirty = false; // a screen-visible change outside the engine: devices, entry
let voteSentVersion = -1;
let voteSentEpoch = -1;
let voteSentFlags = -1;
let voteLastFrameAt = 0;
let voteLastDetectAt = 0;

const isTls = (req) => req.secure || req.get('x-forwarded-proto') === 'https';
const voterOf = (req) => voteGuard.verify(readCookie(req, VOTER_COOKIE));

function voteSameOrigin(req, res) {
  if (sameOrigin(req.headers)) return true;
  res.status(403).json({ ok: false, reason: 'cross_site' });
  return false;
}

// Phones come back at ≤ 400 req/s in total: 3 s up to ~1.200 devices, then
// backing off to 6 s.
const votePollMs = () => Math.min(6000, Math.max(3000, Math.round((voteGuard.devices.size / 400) * 1000)));

// The /metrics trick (above): serialise and gzip once per change, so a
// request just writes a buffer however many phones are polling.
function jsonEntry(obj) {
  const raw = Buffer.from(JSON.stringify(obj));
  return { raw, gzip: zlib.gzipSync(raw) };
}

function sendEntry(req, res, entry) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Vary', 'Accept-Encoding');
  let body = entry.raw;
  if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    res.setHeader('Content-Encoding', 'gzip');
    body = entry.gzip;
  }
  res.setHeader('Content-Length', body.length);
  res.end(body);
}

let voteLiveCache = null;
function voteLiveEntry() {
  const pollMs = votePollMs();
  const key = `${vote.phoneVersion}|${pollMs}|${voteGuard.entryOpen}`;
  if (voteLiveCache?.key !== key) {
    voteLiveCache = { key, entry: jsonEntry({ ...vote.phoneState(), boot: VOTE_BOOT, entryOpen: voteGuard.entryOpen, pollMs }) };
  }
  return voteLiveCache.entry;
}

let voteCandidatesCache = null;
function voteCandidatesEntry() {
  if (voteCandidatesCache?.v !== vote.listVersion) {
    voteCandidatesCache = { v: vote.listVersion, entry: jsonEntry({ listVersion: vote.listVersion, candidates: vote.candidates }) };
  }
  return voteCandidatesCache.entry;
}

app.post('/vote/enter', (req, res) => {
  if (!voteSameOrigin(req, res)) return;
  const r = voteGuard.enter({
    code: req.body?.code,
    existing: readCookie(req, VOTER_COOKIE),
    ip: clientIp(req.get('x-forwarded-for'), req.socket.remoteAddress),
    ua: req.get('user-agent'),
    now: Date.now(),
  });
  if (!r.ok) return res.status(r.reason === 'throttled' ? 429 : 403).json({ ok: false, reason: r.reason });
  if (!r.already) {
    res.setHeader('Set-Cookie', voteGuard.cookieHeader(r.cookie, isTls(req)));
    voteScreenDirty = true; // the device count is on the admin page
  }
  res.json({ ok: true });
});

app.get('/vote/candidates', (req, res) => {
  const etag = `"vl${VOTE_BOOT}-${vote.listVersion}"`;
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('ETag', etag);
  if (etagMatches(req.headers['if-none-match'], etag)) return res.status(304).end();
  sendEntry(req, res, voteCandidatesEntry());
});

// Shared by every phone and up to a change old by design — so the clock rides
// in a header read at request time, exactly as /metrics does.
app.get('/vote/live', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Server-Now', String(Date.now()));
  sendEntry(req, res, voteLiveEntry());
});

app.get('/vote/me', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const id = voterOf(req);
  const view = id ? vote.voterView(id) : { ballots: {}, voided: [] };
  res.json({ entered: !!id, entryOpen: voteGuard.entryOpen, ...view });
});

const BALLOT_STATUS = { closed: 409, stale_list: 409, stale_round: 409, voided: 403 };

app.post('/vote/ballot', (req, res) => {
  if (!voteSameOrigin(req, res)) return;
  const now = Date.now();
  res.setHeader('X-Server-Now', String(now));
  const voterId = voterOf(req);
  if (!voterId) return res.status(401).json({ ok: false, reason: 'not_entered' });
  const b = req.body || {};
  const gate = voteGuard.allowSubmit(voterId, b.categoryId, b.roundId, now);
  if (!gate.ok) return res.status(429).json({ ok: false, reason: gate.reason });
  const r = vote.submit(voterId, { categoryId: b.categoryId, roundId: b.roundId, listVersion: b.listVersion, picks: b.picks }, now);
  const live = { ...vote.phoneState(), boot: VOTE_BOOT };
  if (!r.ok) return res.status(BALLOT_STATUS[r.reason] ?? 400).json({ ok: false, reason: r.reason, live });
  if (r.changed) voteGuard.noteSubmit(b.categoryId, voterId, r.added, r.ballot, now);
  res.json({ ok: true, ballot: r.ballot, live });
});

function voteFrame(now) {
  return JSON.stringify({
    ...vote.screenState(),
    now,
    code: voteGuard.roomCode(now),
    codeRotatesAt: voteGuard.codeRotatesAt(now),
    codeMs: voteGuard.o.epochMs,
    entryOpen: voteGuard.entryOpen,
    devices: voteGuard.devices.size,
    flags: voteGuard.listFlags(vote.categories),
  });
}

// Admin-only: every frame carries the live room code and every count. If it
// were public, anyone anywhere could read the code and the room lock would be
// decoration.
app.get('/vote/events', (req, res) => {
  if (!sessionOk(readCookie(req, ADMIN_COOKIE))) return res.status(401).json({ error: 'admin session required' });
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');
  res.write(`data: ${voteFrame(Date.now())}\n\n`);
  voteSseClients.add(res);
  req.on('close', () => voteSseClients.delete(res));
});

// Called every tick; sends only when something changed (≤ 10 frames/s), with a
// comment every 15 s so an idle stream isn't reaped by a proxy.
function broadcastVote(now) {
  const epoch = Math.floor(now / voteGuard.o.epochMs);
  const changed =
    vote.version !== voteSentVersion || epoch !== voteSentEpoch ||
    voteGuard.flagsVersion !== voteSentFlags || voteScreenDirty;
  if (changed) {
    voteSentVersion = vote.version;
    voteSentEpoch = epoch;
    voteSentFlags = voteGuard.flagsVersion;
    voteScreenDirty = false;
  }
  if (voteSseClients.size === 0) return;
  let payload = null;
  if (changed) payload = `data: ${voteFrame(now)}\n\n`;
  else if (now - voteLastFrameAt >= 15000) payload = ': keepalive\n\n';
  if (!payload) return;
  voteLastFrameAt = now;
  for (const res of voteSseClients) {
    try { res.write(payload); } catch { voteSseClients.delete(res); }
  }
}

// 1 Hz. Members newly caught by a flag the admin already voided are voided too.
function voteDetect(now) {
  if (now - voteLastDetectAt < 1000) return;
  voteLastDetectAt = now;
  for (const { categoryId, voterIds } of voteGuard.detect(vote.categories, now)) vote.void(categoryId, voterIds);
}

// Same password, same session cookie as /host. Engine/guard validation errors
// come back as 400 {ok:false, errors}.
async function voteAdmin(req, res, fn) {
  if (!(await checkAdmin(req, res))) return;
  const r = fn(req.body || {}, Date.now());
  if (r && r.ok === false) return res.status(400).json(r);
  res.json(r ?? { ok: true });
}

app.post('/vote/admin/config', (req, res) => voteAdmin(req, res, (b) => vote.configure({ names: b.names, categories: b.categories })));
app.post('/vote/admin/open', (req, res) => voteAdmin(req, res, (b, now) => vote.open(b.categoryIds, b.durationMs, now)));
app.post('/vote/admin/close', (req, res) => voteAdmin(req, res, (b, now) => vote.close(b.categoryIds, now)));
app.post('/vote/admin/reset', (req, res) => voteAdmin(req, res, (b) => vote.reset(b.categoryIds)));
app.post('/vote/admin/stage', (req, res) => voteAdmin(req, res, (b) => vote.setStage(b)));
app.post('/vote/admin/entry', (req, res) =>
  voteAdmin(req, res, (b) => {
    voteGuard.setEntry(b.open);
    voteScreenDirty = true;
    return { ok: true, entryOpen: voteGuard.entryOpen };
  }),
);
app.post('/vote/admin/void', (req, res) =>
  voteAdmin(req, res, (b) => {
    const id = String(b.flagId ?? '');
    const flag = voteGuard.flags.get(id);
    if (!flag) return { ok: false, errors: ['Unknown flag.'] };
    const affected = b.restore
      ? vote.restore(flag.categoryId, voteGuard.restorable(id))
      : vote.void(flag.categoryId, flag.voterIds);
    voteGuard.markVoided(id, !b.restore);
    return { ok: true, affected };
  }),
);

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

// Everything this server answers is JSON or a static page, and static pages
// never reach here — so an error is always a JSON client's problem. Express's
// default handler renders an HTML page instead, which makes the phone's
// `r.json()` throw on the error path (losing the real status) and, off a
// non-production build, ships a stack trace to whoever sent the bad body.
// The 4-arity signature is what marks this as an error handler; `_next` is
// required for that and deliberately unused.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const status = Number(err?.status || err?.statusCode) || 500;
  if (status >= 500) console.error(`unhandled ${req.method} ${req.path}`, err);
  if (res.headersSent) return res.end();
  res.status(status).json({ error: status === 400 ? 'bad request' : status === 413 ? 'body too large' : 'server error' });
});

// ---------------------------------------------------------------------------
const server = app.listen(PORT, () => {
  console.log(`🔥 Tap Race on :${PORT}  | phone:/  screen:/screen  host:/host`);
  console.log(`   batucada   : phone:/batucada  screen:/batucada/screen`);
  console.log(`   live vote  : phone:/vote  screen:/vote/screen  admin:/vote/admin`);
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
  for (const res of batucadaSseClients) { try { res.end(); } catch { /* ignore */ } }
  for (const res of voteSseClients) { try { res.end(); } catch { /* ignore */ } }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { app, game, PHASE, batucada, vote, voteGuard };
