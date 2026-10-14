// Live Vote load test — N simulated phones against a running server (local or
// deployed), doing what a real phone does:
//   load the page + assets, enter with the live room code, poll /vote/live at
//   the server's pace, submit a random ballot in every open category, and
//   (30 % of them) change one pick a few seconds later.
//
//   VOTE_ADMIN_PASSWORD=… TARGET=https://live-vote-….run.app node scripts/vote-load.mjs
//   DEVICES=300 RAMP_S=15 HOLD_S=45 OPEN=2 CLEANUP=1 …
//
// OPEN=n opens the first n categories (3 min) for the run; CLEANUP=1 resets the
// categories it opened afterwards. The admin password is read from the
// environment (VOTE_ADMIN_PASSWORD, or ADMIN_TOKEN for a local test server) —
// never pass it on the command line of a shared machine.
// Exit code 0 only if no request failed and the server's ballot counts match
// what the phones were told was accepted.
const TARGET = (process.env.TARGET || 'http://127.0.0.1:8080').replace(/\/$/, '');
const DEVICES = Number(process.env.DEVICES || 300);
const RAMP_S = Number(process.env.RAMP_S || 15);
const HOLD_S = Number(process.env.HOLD_S || 45);
const OPEN = Number(process.env.OPEN || 0);
const CLEANUP = process.env.CLEANUP === '1';
const PASSWORD = process.env.VOTE_ADMIN_PASSWORD || process.env.ADMIN_TOKEN;
if (!PASSWORD) {
  console.error('Set VOTE_ADMIN_PASSWORD (or ADMIN_TOKEN for a local test server).');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stats = new Map(); // endpoint -> {n, err, ms: []}
const errors = new Map(); // "endpoint status reason" -> count
async function call(name, path, { method = 'GET', body, cookie, headers = {} } = {}) {
  const t0 = performance.now();
  let status = 0;
  let json = null;
  let res = null;
  try {
    res = await fetch(TARGET + path, {
      method,
      headers: { 'accept-encoding': 'gzip, br', ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    status = res.status;
    const text = await res.text();
    try { json = JSON.parse(text); } catch { /* html/css/js */ }
  } catch (e) {
    status = `ERR ${e.cause?.code || e.message}`;
  }
  const s = stats.get(name) ?? { n: 0, err: 0, ms: [] };
  s.n += 1;
  s.ms.push(performance.now() - t0);
  const okStatus = typeof status === 'number' && status < 400;
  if (!okStatus) {
    s.err += 1;
    const k = `${name} ${status} ${json?.reason ?? ''}`.trim();
    errors.set(k, (errors.get(k) ?? 0) + 1);
  }
  stats.set(name, s);
  return { status, json, res };
}

// ---- admin: session, live frames (room code + counts) -----------------------
const login = await call('admin/login', '/admin/login', { method: 'POST', body: { token: PASSWORD } });
if (login.status !== 200) {
  console.error(`Admin login failed (${login.status}) — wrong password or target?`);
  process.exit(2);
}
const adminCookie = login.res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const adminPost = (path, body) => call('admin', path, { method: 'POST', body, cookie: adminCookie });

let frame = null;
const streamCtl = new AbortController();
(async () => {
  const r = await fetch(TARGET + '/vote/events', { headers: { cookie: adminCookie }, signal: streamCtl.signal });
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const m = chunk.match(/^data: (.*)$/m);
      if (m) frame = JSON.parse(m[1]);
    }
  }
})().catch(() => {});
for (let i = 0; i < 50 && !frame; i++) await sleep(100);
if (!frame) { console.error('No admin frame from /vote/events'); process.exit(2); }

let opened = [];
if (OPEN > 0) {
  opened = frame.categories.slice(0, OPEN).map((c) => c.id);
  await adminPost('/vote/admin/open', { categoryIds: opened, durationMs: 180_000 });
  await sleep(500);
}
const devicesBefore = frame.devices;
const startBallots = Object.fromEntries(frame.categories.map((c) => [c.id, c.ballotCount]));
console.log(`Target ${TARGET} · ${DEVICES} phones · ramp ${RAMP_S}s · hold ${HOLD_S}s · open categories: ${frame.categories.filter((c) => c.phase === 'open').map((c) => c.title).join(', ') || 'none'}`);

// ---- one phone ---------------------------------------------------------------
const accepted = {}; // categoryId -> phones whose ballot the server accepted
const stopAt = Date.now() + (RAMP_S + HOLD_S) * 1000;
async function phone(i) {
  const ua = `LoadPhone/${i} (vote-load)`;
  await Promise.all([
    call('GET /vote', '/vote', { headers: { 'user-agent': ua } }),
    call('GET search.js', '/vote/search.js', { headers: { 'user-agent': ua } }),
    call('GET theme.css', '/vote/theme.css', { headers: { 'user-agent': ua } }),
  ]);
  const cands = (await call('candidates', '/vote/candidates', { headers: { 'user-agent': ua } })).json?.candidates ?? [];
  const enter = await call('enter', '/vote/enter', { method: 'POST', body: { code: frame.code }, headers: { 'user-agent': ua } });
  if (enter.status !== 200) return;
  const cookie = enter.res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  await call('me', '/vote/me', { cookie, headers: { 'user-agent': ua } });
  let live = (await call('live', '/vote/live', { headers: { 'user-agent': ua } })).json;
  const voted = new Map();
  const ballot = async (cat, picks) => {
    const r = await call('ballot', '/vote/ballot', {
      method: 'POST', cookie, headers: { 'user-agent': ua },
      body: { categoryId: cat.id, roundId: cat.roundId, listVersion: live.listVersion, picks },
    });
    if (r.status === 200) {
      if (!voted.has(cat.id)) (accepted[cat.id] ??= new Set()).add(i);
      voted.set(cat.id, picks);
    }
  };
  const randomPicks = (n) => {
    const s = new Set();
    while (s.size < n) s.add(cands[Math.floor(Math.random() * cands.length)].id);
    return [...s];
  };
  await sleep(1000 + Math.random() * 4000); // reading and searching
  for (const cat of live.categories.filter((c) => c.phase === 'open')) await ballot(cat, randomPicks(cat.picks));
  const changeAt = Math.random() < 0.3 ? Date.now() + 3000 + Math.random() * 10_000 : Infinity;
  while (Date.now() < stopAt) {
    await sleep((live.pollMs || 3000) * (0.8 + Math.random() * 0.4));
    live = (await call('live', '/vote/live', { headers: { 'user-agent': ua } })).json ?? live;
    if (Date.now() >= changeAt) {
      for (const [catId, picks] of voted) {
        const cat = live.categories.find((c) => c.id === catId);
        if (cat?.phase !== 'open') continue;
        const swap = randomPicks(cat.picks).find((p) => !picks.includes(p));
        if (swap !== undefined) await ballot(cat, [...picks.slice(1), swap]);
      }
      voted.clear();
    }
  }
}

const t0 = Date.now();
const phones = [];
for (let i = 0; i < DEVICES; i++) {
  phones.push(phone(i));
  await sleep((RAMP_S * 1000) / DEVICES);
}
await Promise.all(phones);
await sleep(1500); // let the last frame land

// ---- report --------------------------------------------------------------------
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0; };
let total = 0;
let failed = 0;
console.log(`\n${'endpoint'.padEnd(16)} ${'reqs'.padStart(6)} ${'errors'.padStart(6)} ${'p50'.padStart(7)} ${'p95'.padStart(7)} ${'p99'.padStart(7)} ${'max'.padStart(7)}`);
for (const [name, s] of stats) {
  total += s.n;
  failed += s.err;
  console.log(`${name.padEnd(16)} ${String(s.n).padStart(6)} ${String(s.err).padStart(6)} ${pct(s.ms, 50).toFixed(0).padStart(5)}ms ${pct(s.ms, 95).toFixed(0).padStart(5)}ms ${pct(s.ms, 99).toFixed(0).padStart(5)}ms ${Math.max(...s.ms).toFixed(0).padStart(5)}ms`);
}
const secs = (Date.now() - t0) / 1000;
console.log(`\n${total} requests in ${secs.toFixed(0)} s (${(total / secs).toFixed(0)} req/s avg), ${failed} failed`);
for (const [k, n] of errors) console.log(`  ✘ ${k} × ${n}`);

let mismatch = 0;
for (const c of frame.categories) {
  const want = (startBallots[c.id] ?? 0) + (accepted[c.id]?.size ?? 0);
  if (!accepted[c.id]) continue;
  const same = c.ballotCount === want;
  if (!same) mismatch += 1;
  console.log(`  ${same ? '✔' : '✘'} ${c.title}: server counts ${c.ballotCount} ballots, phones were told ${want - (startBallots[c.id] ?? 0)} accepted`);
}
console.log(`  devices entered: ${frame.devices - devicesBefore} of ${DEVICES}`);
try {
  const m = await (await fetch(TARGET + '/metrics')).json();
  console.log(`  server: lag max ${m.server.lagMs} ms · rss ${m.server.rssMb} MB · cpu ${m.server.cpuPct}%`);
} catch { /* /metrics is not served in APPS=vote */ }

if (CLEANUP && opened.length) {
  await adminPost('/vote/admin/reset', { categoryIds: opened });
  console.log(`  cleanup: reset ${opened.length} categor${opened.length === 1 ? 'y' : 'ies'}`);
}
streamCtl.abort();
process.exit(failed === 0 && mismatch === 0 ? 0 : 1);
