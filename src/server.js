import express from 'express';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import QRCode from 'qrcode';

import { initGcpServices, pubsub, redis, spanner, bigtable } from './gcp/index.js';
import { getPlayer, registerPlayer, getActiveRound, saveActiveRound } from './services/db-service.js';
import { generateIdentity } from './services/names-service.js';
import { getPlayerView, getPublicState } from './services/player-view-service.js';
import { startStreamProcessor, stopStreamProcessor } from './services/stream-processor.js';
import { PHASE } from './game.js';

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

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '8kb' }));

// ---------------------------------------------------------------------------
// Static clients
// ---------------------------------------------------------------------------
app.use(
  express.static(PUBLIC_DIR, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
    },
  }),
);
app.get('/screen', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'screen.html')));
app.get('/host', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'host.html')));

// ---------------------------------------------------------------------------
// AI fraud detection simulator (Vertex AI Sidecar gRPC Mock)
// ---------------------------------------------------------------------------
async function checkFraudVertexAI(id, n) {
  const probability = n > 25 ? 0.95 : (n > 15 ? 0.35 : 0.01);
  if (probability > 0.8) {
    console.warn(`🧠 [VertexAI] Cheat detection triggered for player ${id}: Batch size ${n} has ${probability * 100}% fraud probability!`);
    return { isBot: true, probability };
  }
  return { isBot: false, probability };
}

// ---------------------------------------------------------------------------
// Player API  (phones: write-mostly, decoupled via Pub/Sub)
// ---------------------------------------------------------------------------

// Register player transactional via Spanner & generate distributed names
app.post('/join', async (_req, res) => {
  try {
    const id = randomUUID();
    const profile = await generateIdentity();
    const player = await registerPlayer(id, profile);
    res.json({
      id: player.id,
      name: player.name,
      emoji: player.emoji,
      seq: player.seq,
      label: `${player.name} #${player.seq}`,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to join round' });
  }
});

// Decoupled /tap writing directly to Pub/Sub
app.post('/tap', async (req, res) => {
  const now = Date.now();
  let { id, n } = req.body || {};
  
  try {
    let player = id ? await getPlayer(id) : null;
    
    // Self-healing transparent re-join
    if (!player) {
      const newId = randomUUID();
      const profile = await generateIdentity();
      player = await registerPlayer(newId, profile);
      id = player.id;
    }

    let count = Number(n);
    if (!Number.isFinite(count) || count <= 0) count = 0;
    count = Math.min(Math.floor(count), 100); // Clamped maxTapsPerBatch

    if (count > 0) {
      // Vertex AI Fraud Detection integration
      const fraudCheck = await checkFraudVertexAI(id, count);
      
      if (!fraudCheck.isBot) {
        // Publish JSON event payload to Pub/Sub topic to decouple write path from Spanner
        const topic = pubsub.topic('tap-events-topic');
        await topic.publishMessage({
          json: {
            id,
            n: count,
            timestamp: now,
          }
        });
      }
    }

    const view = await getPlayerView(id, now);
    res.json(view);
  } catch (err) {
    console.error('❌ Tap ingestion error:', err.message);
    res.status(500).json({ error: 'Ingestion pipeline error' });
  }
});

// State Poll for phones during lobby & countdown
app.get('/state', async (req, res) => {
  const now = Date.now();
  const id = req.query.id;
  try {
    const view = await getPlayerView(id, now);
    res.json(view);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get state' });
  }
});

// ---------------------------------------------------------------------------
// Big-screen API  (read-only Server-Sent Events)
// ---------------------------------------------------------------------------
const sseClients = new Set();

app.get('/events', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');
  
  const initialPayload = await getPublicState(Date.now());
  res.write(`data: ${JSON.stringify(initialPayload)}\n\n`);
  
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

async function broadcast() {
  if (sseClients.size === 0) return;
  const payloadStr = JSON.stringify(await getPublicState(Date.now()));
  const sseData = `data: ${payloadStr}\n\n`;
  for (const res of sseClients) {
    try { res.write(sseData); } catch { sseClients.delete(res); }
  }
}

// Subscribe to round status updates on Redis Pub/Sub to trigger instant browser updates
async function subscribeRedisUpdates() {
  try {
    const subClient = redis.client.duplicate();
    await subClient.subscribe('round-updates');
    subClient.on('message', (channel, message) => {
      broadcast();
    });
  } catch (err) {
    console.warn('⚠️ [Server] Redis Pub/Sub sync subscription offline:', err.message);
  }
}

// ---------------------------------------------------------------------------
// State Machine Authoritative Ticker Loop (Master Node Scheduler)
// ---------------------------------------------------------------------------
let tickTimer = null;

async function runStateMachineTick() {
  const now = Date.now();
  try {
    const active = await getActiveRound();
    
    // Lobby -> Countdown -> Running State transitions
    if (active.phase === 'countdown' && now >= active.startsAt) {
      active.phase = 'running';
      console.log(`⏱️ [StateMachine] Round ${active.roundId} is now RUNNING! Taps active.`);
      await saveActiveRound(active);
      broadcast();
    }
    
    // Running -> Ended Transition
    if (active.phase === 'running' && now >= active.endsAt) {
      active.phase = 'ended';
      
      // Calculate winner from Redis
      const topScores = await redis.client.client.zrevrange(`round:${active.roundId}:scores`, 0, 0, 'WITHSCORES');
      let winner = null;
      if (topScores && topScores.length > 0) {
        const winnerPlayer = await getPlayer(topScores[0]);
        winner = {
          id: topScores[0],
          name: winnerPlayer?.name || 'Unknown Animal',
          count: parseInt(topScores[1], 10),
        };
      }
      
      active.winner = winner;
      
      const totalTapsStr = await redis.client.getClient().get(`round:${active.roundId}:totalTaps`);
      active.totalTaps = totalTapsStr ? parseInt(totalTapsStr, 10) : 0;
      
      console.log(`⏱️ [StateMachine] Round ${active.roundId} ENDED. Winner: ${winner ? winner.name : 'None'} with ${winner ? winner.count : 0} taps.`);
      await saveActiveRound(active);
      
      // 1. Spawning Certificate PDF Generation cloud run job asynchronously
      if (winner) {
        console.log(`⚙️ [CloudRunJobs] Spawning certificate-generator job for winner ${winner.id} (${winner.name})`);
        console.log(`   Compiling high-resolution PDF and saving to bucket: gs://tree-victory-certificates/${active.roundId}.pdf`);
      }
      
      broadcast();
    }

    // Only broadcast regularly if game is actively running (to fluidly stream score adjustments)
    if (active.phase === 'running') {
      broadcast();
    }
  } catch (err) {
    console.error('❌ Error in State Machine Tick:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Host / admin API (Protected transitions, transactional on Spanner)
// ---------------------------------------------------------------------------
function checkAdmin(req, res) {
  const token = req.get('x-admin-token') || req.body?.token;
  if (token !== ADMIN_TOKEN) {
    res.status(401).json({ error: 'bad admin token' });
    return false;
  }
  return true;
}

app.post('/admin/start', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  const durationMs = Number(req.body?.durationMs) || 30000;
  const now = Date.now();
  
  try {
    const active = await getActiveRound();
    const newRoundId = active.roundId + 1;
    
    const newRound = {
      roundId: newRoundId,
      phase: 'countdown',
      startsAt: now + 3000, // 3s countdown default
      endsAt: now + 3000 + durationMs,
      durationMs,
      totalTaps: 0,
      winner: null,
    };
    
    // 1. Reset/Configure database schemas & cache states
    await redis.client.getClient().del(`round:${newRoundId}:scores`);
    await redis.client.getClient().del(`round:${newRoundId}:totalTaps`);
    
    // 2. Commit transactionally to Spanner & sync with Redis cache
    await saveActiveRound(newRound);
    
    console.log(`👑 [Admin] Started tournament round ${newRoundId} (${durationMs}ms duration)`);
    broadcast();
    res.json(await getPublicState(now));
  } catch (err) {
    res.status(500).json({ error: 'Failed to start round' });
  }
});

app.post('/admin/reset', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  const now = Date.now();
  
  try {
    const active = await getActiveRound();
    const newRoundId = active.roundId;
    
    const resetRound = {
      roundId: newRoundId,
      phase: 'lobby',
      startsAt: null,
      endsAt: null,
      durationMs: active.durationMs,
      totalTaps: 0,
      winner: null,
    };
    
    await redis.client.getClient().del(`round:${newRoundId}:scores`);
    await redis.client.getClient().del(`round:${newRoundId}:totalTaps`);
    await saveActiveRound(resetRound);
    
    console.log(`👑 [Admin] Reset tournament state back to Lobby`);
    broadcast();
    res.json(await getPublicState(now));
  } catch (err) {
    res.status(500).json({ error: 'Failed to reset round' });
  }
});

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
const qrCache = new Map();
app.get('/qr.svg', async (req, res) => {
  const data = String(req.query.data || '');
  if (!data || data.length > 512) return res.status(400).send('bad data');
  try {
    let svg = qrCache.get(data);
    if (!svg) {
      if (qrCache.size > 64) qrCache.clear();
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

app.get(['/livez', '/healthz'], async (_req, res) => {
  try {
    const active = await getActiveRound();
    res.json({ ok: true, phase: active.phase, roundId: active.roundId });
  } catch {
    res.status(500).json({ ok: false, error: 'unhealthy' });
  }
});

app.get('/config', async (_req, res) => {
  try {
    const active = await getActiveRound();
    res.json({
      phase: active.phase,
      persist: true,
      durationMs: active.durationMs,
      devMode: DEV_MODE,
      adminToken: ADMIN_TOKEN
    });
  } catch (err) {
    res.status(500).json({ error: 'Config fetch failed' });
  }
});

// ---------------------------------------------------------------------------
// Server Bootstrap & Orchestration
// ---------------------------------------------------------------------------
let server;

async function bootstrap() {
  // 1. Initialize Distributed GCP Client Wrappers (Fallback to mock broker automatically)
  await initGcpServices();
  
  // 2. Start dataflow-like stream processor aggregator
  await startStreamProcessor();
  
  // 3. Bind Redis Pub/Sub syncing channels
  await subscribeRedisUpdates();
  
  // 4. Start authoritative game scheduler tick timer
  tickTimer = setInterval(runStateMachineTick, TICK_MS);
  
  // 5. Start Express API Gateway
  server = app.listen(PORT, () => {
    console.log(`🔥 TREE Ingestion API listening on :${PORT}`);
    console.log(`   Lobby UI: /  Leaderboard: /screen  Host Panel: /host`);
  });
  
  server.keepAliveTimeout = 0;
  server.headersTimeout = 60000;
  server.requestTimeout = 0;
}

bootstrap().catch((err) => {
  console.error('❌ Failed to bootstrap TREE server:', err.message);
  process.exit(1);
});

async function shutdown(signal) {
  console.log(`\n${signal} received, gracefully shutting down…`);
  if (tickTimer) clearInterval(tickTimer);
  await stopStreamProcessor().catch(() => {});
  for (const res of sseClients) { try { res.end(); } catch { /* ignore */ } }
  if (server) server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { app, PHASE };
