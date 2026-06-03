import express from 'express';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import QRCode from 'qrcode';

import { Game, PHASE } from './game.js';
import { persistResults, persistence } from './persist.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const PORT = Number(process.env.PORT) || 8080;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'dev';
const TICK_MS = Number(process.env.TICK_MS) || 100;
const IS_PROD = process.env.NODE_ENV === 'production' || !!process.env.GOOGLE_CLOUD_PROJECT;
const DEV_MODE = ADMIN_TOKEN === 'dev';

// Fail fast rather than silently shipping a public, default-token admin panel.
if (IS_PROD && DEV_MODE) {
  console.error('FATAL: ADMIN_TOKEN must be set to a non-default value in production (it is unset or "dev").');
  process.exit(1);
}

const game = new Game({
  durationMs: Number(process.env.DURATION_MS) || 30000,
  onEnded: (results) => { persistResults(results); },
});

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '8kb' }));

// ---------------------------------------------------------------------------
// Static clients
// ---------------------------------------------------------------------------
app.use(
  express.static(PUBLIC_DIR, {
    setHeaders: (res, filePath) => {
      // HTML/CSS must never be cached so a redeploy is picked up instantly mid-event.
      if (filePath.endsWith('.html') || filePath.endsWith('.css')) res.setHeader('Cache-Control', 'no-store');
      // Fonts are content-stable — cache hard so phones fetch them once.
      else if (filePath.endsWith('.woff2')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    },
  }),
);
app.get('/screen', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'screen.html')));
app.get('/host', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'host.html')));

// ---------------------------------------------------------------------------
// Player API  (phones: write-mostly)
// ---------------------------------------------------------------------------

// Register a new player. The server owns identity (auto-generated name).
app.post('/join', (_req, res) => {
  const id = randomUUID();
  const ident = game.join(id);
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
    const ident = game.join(id);
    return res.json({ ...game.playerView(id, now), ...ident, rejoined: true });
  }
  res.json(game.tap(id, n, now));
});

// Lightweight state poll used by phones during lobby/countdown (no taps yet).
app.get('/state', (req, res) => {
  const now = Date.now();
  const id = req.query.id;
  game.tick(now);
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

// ---------------------------------------------------------------------------
// Host / admin API
// ---------------------------------------------------------------------------
function checkAdmin(req, res) {
  // Header or JSON body only — never the query string (it would land in access logs).
  const token = req.get('x-admin-token') || req.body?.token;
  if (token !== ADMIN_TOKEN) {
    res.status(401).json({ error: 'bad admin token' });
    return false;
  }
  return true;
}

app.post('/admin/start', (req, res) => {
  if (!checkAdmin(req, res)) return;
  const durationMs = Number(req.body?.durationMs) || undefined;
  const state = game.start({ durationMs, now: Date.now() });
  broadcast();
  res.json(state);
});

app.post('/admin/reset', (req, res) => {
  if (!checkAdmin(req, res)) return;
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

app.get('/config', (_req, res) =>
  // adminToken is surfaced so the host page can prefill it (game is public; the
  // host controls are convenience, not a secret boundary).
  res.json({ phase: game.phase, persist: persistence.isEnabled(), durationMs: game.defaultDurationMs, devMode: DEV_MODE, adminToken: ADMIN_TOKEN }),
);

// ---------------------------------------------------------------------------
const server = app.listen(PORT, () => {
  console.log(`🔥 Tap Race on :${PORT}  | phone:/  screen:/screen  host:/host`);
  console.log(`   admin token: ${ADMIN_TOKEN === 'dev' ? 'dev (set ADMIN_TOKEN in prod!)' : '(set)'}`);
  console.log(`   persistence: ${persistence.isEnabled() ? 'firestore' : 'off (in-memory only)'}`);
});

// A long-lived SSE response is an active stream (we write every 100ms), so the
// idle keep-alive timer must not close it. But keep header-slowloris protection:
// SSE completes its request headers immediately, so headersTimeout is safe to keep.
server.keepAliveTimeout = 0; // don't close an active streaming connection for idleness
server.headersTimeout = 60000; // still reject clients that dribble request headers
server.requestTimeout = 0; // bodies are capped at 8kb by express.json

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
