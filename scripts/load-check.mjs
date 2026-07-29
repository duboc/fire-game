// 5.000-player load run against a locally spawned server.
//
//   node scripts/load-check.mjs              # current behaviour
//   LOAD_SPREAD=0 node scripts/load-check.mjs  # A/B: unspread herd, fixed 1.5s window
//
// Two things this harness learned the hard way, both of which silently faked a
// passing result before they were fixed (docs/SCALE.md, finding 8):
//
//   * The generator must not be the bottleneck. It forks WORKERS processes; on a
//     4-core box leave one for the server, or you measure your own saturation.
//   * The agent's socket cap throttles the very herd being measured. LOAD_SOCKETS
//     must exceed PLAYERS/WORKERS, or the buzzer herd is dribbled out and the
//     unspread run looks harmless when it is losing a third of the room.
import { spawn, fork } from 'node:child_process';
import http from 'node:http';

const WORKERS = 3, PLAYERS = 5000, PORT = 8141, TOKEN = 'loadtok';
const SPREAD = process.env.LOAD_SPREAD !== '0';

if (process.env.LOAD_WORKER) {
  const n = Number(process.env.LOAD_N), base = Number(process.env.LOAD_BASE);
  const agent = new http.Agent({ keepAlive: true, maxSockets: Number(process.env.LOAD_SOCKETS) || 4096 });
  const ids = [];
  const lat = [];
  let errors = 0, done = 0;

  const req = (opts, body) => new Promise((resolve) => {
    const t0 = process.hrtime.bigint();
    const r = http.request({ host: '127.0.0.1', port: PORT, agent, ...opts }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        lat.push(Number(process.hrtime.bigint() - t0) / 1e6);
        done++;
        try { resolve(JSON.parse(d)); } catch { errors++; resolve(null); }
      });
    });
    r.on('error', () => { errors++; done++; resolve(null); });
    if (body) r.write(body);
    r.end();
  });

  // join
  for (let i = 0; i < n; i++) {
    const s = await req({ method: 'POST', path: '/join' });
    if (s?.id) ids.push(s.id);
  }
  process.send({ joined: ids.length, base });
  await new Promise((r) => process.once('message', r)); // wait for the round to start

  lat.length = 0; errors = 0; done = 0;
  const st = await req({ method: 'GET', path: '/state' });
  const endsAt = st.endsAt, skew = Date.now() - st.serverNow;
  const graceMs = st.graceMs, tapMs = st.tapIntervalMs;
  let credited = 0, tooLate = 0, lost = 0, lateMax = 0;

  await Promise.all(ids.map(async (id) => {
    let sent = 0;
    await new Promise((r) => setTimeout(r, Math.random() * (tapMs || 3000))); // natural desync
    // Steady tapping until the buzzer.
    while (Date.now() < endsAt + skew) {
      const remain = endsAt + skew - Date.now();
      sent += 8;
      const s = await req(
        { method: 'POST', path: '/tap', headers: { 'content-type': 'application/json' } },
        JSON.stringify({ id, n: 8 }),
      );
      if (!s) sent -= 8;
      if (remain <= (tapMs || 3000)) break;
      await new Promise((r) => setTimeout(r, Math.min(s?.tapIntervalMs || 3000, remain)));
    }
    // The buzzer herd: exactly what the phone does, jitter included. No extra
    // request here — instrumenting it would double the herd being measured.
    const jitter = SPREAD ? Math.random() * Math.min(tapMs || 3000, graceMs * 0.6) : 0;
    await new Promise((r) => setTimeout(r, Math.max(0, endsAt + skew - Date.now() + jitter)));
    sent += 8;
    const s = await req(
      { method: 'POST', path: '/tap', headers: { 'content-type': 'application/json' } },
      JSON.stringify({ id, n: 8 }),
    );
    const landedAt = Date.now() - skew;
    if (landedAt > lateMax) lateMax = landedAt;
    if (!s) lost++;                          // generator/network gave up
    else if (s.yourCount === sent) credited++;
    else tooLate++;                          // server refused it: arrived past settlesAt
  }));

  const sorted = lat.sort((a, b) => a - b);
  process.send({
    done, errors, credited, tooLate, lost,
    lastLandedAfterBuzzer: lateMax - endsAt, graceMs,
    p50: sorted[Math.floor(sorted.length * 0.5)], p99: sorted[Math.floor(sorted.length * 0.99)],
  });
  process.exit(0);
}

// -------------------------------------------------------------------- parent
const srv = spawn(process.execPath, ['src/server.js'], {
  env: {
    ...process.env,
    PORT: String(PORT), ADMIN_TOKEN: TOKEN, HEARTBEAT_MS: '5000', NODE_ENV: 'test',
    ...(SPREAD ? {} : { GRACE_MS: '1500' }), // the pre-finding-8 window, for the A/B
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let beats = [];
srv.stdout.on('data', (d) => String(d).split('\n').forEach((l) => { if (l.startsWith('beat')) beats.push(l); }));
await new Promise((r) => setTimeout(r, 900));

const B = `http://127.0.0.1:${PORT}`;

// A dashboard, open for the whole run. The claim being tested is that a public
// /metrics is free: the sampler builds one payload a second and the handler
// writes it, so this must neither slow the round down nor slow down itself while
// 5.000 phones are hammering the same event loop.
const dash = { polls: 0, errors: 0, maxWireB: 0, maxRawB: 0, lat: [], peakTaps: 0, peakPlayers: 0, maxLag: 0 };
const dashTimer = setInterval(async () => {
  const t = Date.now();
  try {
    const r = await fetch(B + '/metrics');
    const wire = Number(r.headers.get('content-length')) || 0;
    const m = await r.json();
    dash.lat.push(Date.now() - t);
    dash.polls++;
    if (wire > dash.maxWireB) dash.maxWireB = wire;
    const raw = JSON.stringify(m).length;
    if (raw > dash.maxRawB) dash.maxRawB = raw;
    if (m.tapsPerSec > dash.peakTaps) dash.peakTaps = m.tapsPerSec;
    if (m.players > dash.peakPlayers) dash.peakPlayers = m.players;
    if (m.server.lagMs > dash.maxLag) dash.maxLag = m.server.lagMs;
  } catch { dash.errors++; }
}, 1000);
dashTimer.unref();

const kids = [];
const joinT0 = Date.now();
await Promise.all(Array.from({ length: WORKERS }, (_, w) => new Promise((resolve) => {
  const k = fork(new URL(import.meta.url), {
    env: { ...process.env, LOAD_WORKER: '1', LOAD_N: String(PLAYERS / WORKERS), LOAD_BASE: String(w) },
  });
  kids.push(k);
  k.once('message', resolve);
})));
const joinSecs = (Date.now() - joinT0) / 1000;
const st0 = await (await fetch(B + '/state')).json();
console.log(`\nmode: ${SPREAD ? 'spread final flush + adaptive window' : 'A/B — unspread herd, fixed 1500ms window'}`);
console.log(`join: ${st0.total} players in ${joinSecs.toFixed(1)}s (${Math.round(st0.total / joinSecs)}/s)`);
console.log(`server-dictated cadence at ${st0.total}: tap=${st0.tapIntervalMs}ms poll=${st0.pollIntervalMs}ms`);
beats = [];

await fetch(B + '/admin/start', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': TOKEN },
  body: JSON.stringify({ durationMs: 20000 }),
});
await new Promise((r) => setTimeout(r, 3100)); // countdown

const results = await Promise.all(kids.map((k) => new Promise((res) => {
  k.send('go'); k.once('message', res);
})));

const sum = (k) => results.reduce((a, r) => a + r[k], 0);
console.log(`\nRUNNING, ${PLAYERS} players, 20s round:`);
console.log(`  ${sum('done')} requests   errors=${sum('errors')}`);
console.log(`  p50 ${Math.max(...results.map((r) => r.p50)).toFixed(1)}ms   p99 ${Math.max(...results.map((r) => r.p99)).toFixed(1)}ms`);
console.log(`\nthe buzzer herd (${PLAYERS} simultaneous final flushes):`);
console.log(`  grace window        ${results[0].graceMs}ms`);
console.log(`  last flush landed   ${Math.max(...results.map((r) => r.lastLandedAfterBuzzer))}ms after the buzzer`);
console.log(`  credited            ${sum('credited')} / ${PLAYERS}`);
console.log(`  refused (too late)  ${sum('tooLate')}`);
console.log(`  generator gave up   ${sum('lost')}`);

await new Promise((r) => setTimeout(r, 6500)); // let one more beat cover the herd
clearInterval(dashTimer);
const dl = dash.lat.sort((a, b) => a - b);
console.log(`\n/dashboard polling /metrics throughout (${dash.polls} polls, ${dash.errors} errors):`);
console.log(`  payload             ${dash.maxRawB}B raw -> ${dash.maxWireB}B gzip at ${dash.peakPlayers} players`);
console.log(`  poll latency        p50 ${dl[Math.floor(dl.length * 0.5)]}ms   p99 ${dl[Math.floor(dl.length * 0.99)]}ms   max ${dl[dl.length - 1]}ms`);
console.log(`  peak it observed    ${dash.peakTaps} taps/s, ${dash.maxLag}ms loop lag`);

console.log('\nserver heartbeats (the last one covers the buzzer herd):');
beats.forEach((b) => console.log('  ' + b));

srv.kill('SIGTERM');
process.exit(0);
