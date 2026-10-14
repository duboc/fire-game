// Live Vote verification — docs/VOTE_SPEC.md, "Testing". Spawns its own
// servers on localhost. Part 1 is the HTTP contract; Tasks 5–7 of
// docs/VOTE_PLAN.md append the browser checks for each page.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium, devices } from 'playwright';
import { SEED_NAMES, SEED_CATEGORIES } from '../src/vote-seed.js';

const ROOT = new URL('..', import.meta.url).pathname;
const TOKEN = 'votetok';
const CODE_MS = 3000;
const SHOTS = '/tmp/vote-check';
mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
let fail = 0;
const ok = (c, m) => {
  if (c) { pass++; console.log('  ✔', m); } else { fail++; console.log('  ✘', m); }
};
const FORBIDDEN = ['counts', 'ballotCount', 'votes', 'code', 'flags'];
// Every key at any depth — "no counts on phones" is about structure, not text.
const keysDeep = (o, out = new Set()) => {
  if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { out.add(k); keysDeep(v, out); }
  return out;
};
const leaks = (o) => FORBIDDEN.filter((k) => keysDeep(o).has(k));

function startServer(port, env = {}) {
  const child = spawn(process.execPath, [ROOT + 'src/server.js'], {
    env: {
      ...process.env, PORT: String(port), ADMIN_TOKEN: TOKEN, VOTE_CODE_MS: String(CODE_MS),
      VOTE_MIN_DURATION_MS: '2000', NODE_ENV: 'test', HEARTBEAT_MS: '60000', ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  const ready = (async () => {
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`${base}/livez`)).ok) return; } catch { /* not up yet */ }
      await sleep(100);
    }
    throw new Error(`server on ${port} did not start:\n${log}`);
  })();
  return { child, ready, base, log: () => log };
}

// One simulated device: its own cookie jar, IP (via X-Forwarded-For — honoured
// because clientIp() takes the rightmost entry and there is no proxy locally)
// and user-agent.
function client(base, { ip, ua = 'vote-check' } = {}) {
  const jar = new Map();
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const req = async (path, { method = 'GET', body, headers = {} } = {}) => {
    const h = { 'user-agent': ua, ...headers };
    if (ip) h['x-forwarded-for'] = ip;
    if (jar.size) h.cookie = cookie();
    if (body !== undefined) h['content-type'] = 'application/json';
    const r = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie()) {
      const kv = c.split(';')[0];
      const i = kv.indexOf('=');
      jar.set(kv.slice(0, i), kv.slice(i + 1));
    }
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: r.status, headers: r.headers, json, text };
  };
  return { base, jar, cookie, req };
}

async function adminClient(base) {
  const a = client(base);
  const r = await a.req('/admin/login', { method: 'POST', body: { token: TOKEN } });
  if (r.status !== 200) throw new Error('admin login failed');
  return a;
}

// The first frame of the admin SSE stream: counts, room code, flags.
async function frame(admin) {
  const ctl = new AbortController();
  const r = await fetch(admin.base + '/vote/events', { headers: { cookie: admin.cookie() }, signal: ctl.signal });
  if (r.status !== 200) { ctl.abort(); return { status: r.status }; }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return { status: 0 };
      buf += dec.decode(value, { stream: true });
      const m = buf.match(/data: (.*)\n\n/);
      if (m) return { status: 200, ...JSON.parse(m[1]) };
    }
  } finally { ctl.abort(); }
}

const enterWith = (c, code) => c.req('/vote/enter', { method: 'POST', body: { code } });
const ballot = (c, cat, listVersion, picks, extra = {}) =>
  c.req('/vote/ballot', { method: 'POST', body: { categoryId: cat.id, roundId: cat.roundId, listVersion, picks, ...extra } });

async function apiChecks() {
  const A = startServer(8145);
  try {
    await A.ready;
    const admin = await adminClient(A.base);

    console.log('\n== public surface ==');
    const anon = client(A.base);
    const live0 = await anon.req('/vote/live');
    ok(live0.status === 200 && live0.json.categories.length === 5, '/vote/live lists the 5 seed categories');
    ok(Number(live0.headers.get('x-server-now')) > 0, '/vote/live carries X-Server-Now');
    ok(leaks(live0.json).length === 0, '/vote/live has no counts, code or flags');
    ok(live0.json.pollMs >= 3000 && live0.json.pollMs <= 6000, 'pollMs is within 3–6 s');
    ok(typeof live0.json.boot === 'string' && live0.json.boot.length >= 8, '/vote/live carries a boot id');
    const cands = await anon.req('/vote/candidates');
    ok(cands.json.candidates.length === 120, '120 seed names');
    const etag = cands.headers.get('etag');
    ok(etag.includes(live0.json.boot), 'candidates ETag includes the boot id');
    ok((await anon.req('/vote/candidates', { headers: { 'if-none-match': etag } })).status === 304, 'candidates revalidate to 304');
    ok((await anon.req('/vote/events')).status === 401, '/vote/events refuses without an admin session');
    ok((await anon.req('/vote/me')).json.entered === false, '/vote/me: not entered without a cookie');
    const c0 = live0.json.categories[0];
    const nb = await ballot(anon, c0, live0.json.listVersion, [0, 1, 2]);
    ok(nb.status === 401 && nb.json.reason === 'not_entered', 'ballot without a device cookie → 401 not_entered');
    ok((await anon.req('/state')).status === 200 && (await anon.req('/batucada/state')).status === 200, 'Tap Race and Sequência still answer');

    console.log('\n== entering ==');
    const f0 = await frame(admin);
    ok(f0.status === 200 && /^[A-HJKMNP-Z2-9]{5}$/.test(f0.code), 'admin frame carries the 5-char room code');
    const bad = client(A.base, { ip: '198.51.100.1' });
    const b1 = await enterWith(bad, 'ZZZZZ');
    ok(b1.status === 403 && b1.json.reason === 'bad_code', 'wrong code → 403 bad_code');
    for (let i = 0; i < 19; i++) await enterWith(bad, 'ZZZZZ');
    const thr = await enterWith(bad, (await frame(admin)).code);
    ok(thr.status === 429 && thr.json.reason === 'throttled', '20 wrong codes from one IP → 429, even with the right code');
    const x = await client(A.base).req('/vote/enter', { method: 'POST', body: { code: f0.code }, headers: { 'sec-fetch-site': 'cross-site' } });
    ok(x.status === 403 && x.json.reason === 'cross_site', 'cross-site POST refused');
    const dev = client(A.base, { ip: '198.51.100.2' });
    const e = await enterWith(dev, (await frame(admin)).code);
    const sc = e.headers.getSetCookie()[0] ?? '';
    ok(e.status === 200 && /^tv_voter=[^;]+; Path=\/vote; HttpOnly; SameSite=Strict/.test(sc), 'right code → device cookie (HttpOnly, Strict, /vote)');
    ok(!/Secure/.test(sc), 'no Secure flag over plain http');
    ok((await dev.req('/vote/me')).json.entered === true, '/vote/me: entered');
    const re = await enterWith(dev, 'ZZZZZ');
    ok(re.status === 200 && re.headers.getSetCookie().length === 0, 're-entering with a valid cookie is a no-op, whatever the code');

    console.log('\n== config ==');
    const big = Array.from({ length: 300 }, (_, i) => `Person ${String(i).padStart(3, '0')} ${'x'.repeat(46)}`);
    const cfg = await admin.req('/vote/admin/config', { method: 'POST', body: { names: big, categories: [{ title: 'Big', picks: 3 }] } });
    ok(cfg.status === 200, '300 × 57-char names save (body well over 8 KB)');
    const dup = await admin.req('/vote/admin/config', { method: 'POST', body: { names: ['Élio', 'ELIO'], categories: [{ title: 'X', picks: 1 }] } });
    ok(dup.status === 400 && /same name/.test(dup.json.errors.join(' ')), 'duplicate names → 400 naming the lines');
    const anonCfg = await client(A.base).req('/vote/admin/config', { method: 'POST', body: { names: ['A', 'B'], categories: [{ title: 'X', picks: 1 }] } });
    ok(anonCfg.status === 401, 'config needs the admin session');
    ok((await admin.req('/vote/admin/config', { method: 'POST', body: { names: SEED_NAMES, categories: SEED_CATEGORIES } })).status === 200, 'seed restored');

    console.log('\n== ballots ==');
    let live = (await anon.req('/vote/live')).json;
    const [c1] = live.categories;
    ok((await admin.req('/vote/admin/open', { method: 'POST', body: { categoryIds: [c1.id] } })).status === 200, 'open one category');
    live = (await anon.req('/vote/live')).json;
    let cat = live.categories.find((c) => c.id === c1.id);
    ok(cat.phase === 'open' && Math.abs(cat.endsAt - Date.now() - 180_000) < 5000, 'no duration → 3 min');
    const w = await ballot(dev, cat, live.listVersion, [0, 1]);
    ok(w.status === 400 && w.json.reason === 'wrong_count', 'a 2-pick ballot in a 3-pick category → wrong_count');
    await sleep(1100);
    const g = await ballot(dev, cat, live.listVersion, [2, 0, 1]);
    ok(g.status === 200 && g.json.ballot.join() === '0,1,2', 'a valid ballot lands (sorted)');
    ok(leaks(g.json).length === 0, 'the ballot response carries no counts');
    const tf = await ballot(dev, cat, live.listVersion, [0, 1, 3]);
    ok(tf.status === 429 && tf.json.reason === 'too_fast', 'a second submit within 1 s → too_fast');
    let f = await frame(admin);
    let fc = f.categories.find((c) => c.id === cat.id);
    ok(fc.counts.slice(0, 4).join() === '1,1,1,0' && fc.ballotCount === 1, 'the admin frame shows the counts');
    ok(f.feed.filter((x) => x.categoryId === cat.id).length === 3, 'the feed has the three +1s');
    ok((await dev.req('/vote/me')).json.ballots[cat.id].picks.join() === '0,1,2', '/vote/me returns my ballot');
    await sleep(1100);
    await ballot(dev, cat, live.listVersion, [0, 1, 3]);
    fc = (await frame(admin)).categories.find((c) => c.id === cat.id);
    ok(fc.counts.slice(0, 4).join() === '1,1,0,1' && fc.ballotCount === 1, 'changing one pick moves exactly one vote');
    await sleep(1100);
    const sl = await ballot(dev, cat, live.listVersion - 1, [0, 1, 4]);
    ok(sl.status === 409 && sl.json.reason === 'stale_list' && Array.isArray(sl.json.live.categories), 'stale list → 409 with fresh live state');

    console.log('\n== expiry & entry lock ==');
    const old = (await frame(admin)).code;
    await sleep(CODE_MS * 2 + 200);
    const late = await enterWith(client(A.base, { ip: '198.51.100.3' }), old);
    ok(late.status === 403 && late.json.reason === 'bad_code', 'a code older than two epochs is refused');
    await admin.req('/vote/admin/entry', { method: 'POST', body: { open: false } });
    const locked = await enterWith(client(A.base, { ip: '198.51.100.4' }), (await frame(admin)).code);
    ok(locked.status === 403 && locked.json.reason === 'entry_closed', 'entry closed → new devices refused');
    ok((await dev.req('/vote/me')).json.entered === true, '…devices already in stay in');
    ok((await anon.req('/vote/live')).json.entryOpen === false, 'phones learn entry is closed');
    await admin.req('/vote/admin/entry', { method: 'POST', body: { open: true } });

    console.log('\n== fraud flags ==');
    const fr = await frame(admin);
    await sleep(fr.codeRotatesAt - fr.now + 50); // a fresh epoch, so all six share an entry window
    const code = (await frame(admin)).code;
    const bots = [];
    for (let i = 0; i < 6; i++) {
      const b = client(A.base, { ip: '203.0.113.50', ua: 'BotPhone/1.0' });
      await enterWith(b, code);
      await ballot(b, cat, live.listVersion, [5, 6, 7]);
      bots.push(b);
    }
    await sleep(1300);
    f = await frame(admin);
    const flag = f.flags.find((x) => x.kind === 'cluster' && x.categoryId === cat.id);
    ok(flag && flag.devices === 6, 'six identical ballots from one network + browser → cluster flag');
    ok(!keysDeep(f.flags).has('voterIds'), 'voter ids never leave the server');
    const before = f.categories.find((c) => c.id === cat.id).counts[5];
    await admin.req('/vote/admin/void', { method: 'POST', body: { flagId: flag.id } });
    fc = (await frame(admin)).categories.find((c) => c.id === cat.id);
    ok(fc.counts[5] === before - 6 && fc.voidedCount === 6, 'void takes the six ballots out of the counts');
    await sleep(1100);
    const vb = await ballot(bots[0], cat, live.listVersion, [5, 6, 8]);
    ok(vb.status === 403 && vb.json.reason === 'voided', 'a voided device cannot vote again this round');
    ok((await bots[0].req('/vote/me')).json.voided.includes(cat.id), '/vote/me reports the void');
    await admin.req('/vote/admin/void', { method: 'POST', body: { flagId: flag.id, restore: true } });
    ok((await frame(admin)).categories.find((c) => c.id === cat.id).counts[5] === before, 'restore puts them back');

    console.log('\n== close ==');
    await admin.req('/vote/admin/close', { method: 'POST', body: { categoryIds: [cat.id] } });
    await sleep(1100);
    const cl = await ballot(dev, cat, live.listVersion, [0, 1, 2]);
    ok(cl.status === 409 && cl.json.reason === 'closed', 'a ballot after close → 409 closed');
    const st = await admin.req('/vote/admin/stage', { method: 'POST', body: { mode: 'pinned', categoryIds: [cat.id] } });
    ok(st.status === 200 && (await frame(admin)).stage.show.join() === cat.id, 'pinning the stage');

    console.log('\n== restart ==');
    const B = startServer(8146);
    try {
      await B.ready;
      const moved = client(B.base);
      for (const [k, v] of dev.jar) moved.jar.set(k, v);
      ok((await moved.req('/vote/me')).json.entered === false, 'a cookie from before a restart is not honoured');
      const liveB = (await moved.req('/vote/live')).json;
      ok(liveB.boot !== live0.json.boot, 'a new boot id after restart');
      const mb = await ballot(moved, liveB.categories[0], liveB.listVersion, [0, 1, 2]);
      ok(mb.status === 401, '…and it cannot vote');
    } finally { B.child.kill(); }
  } finally { A.child.kill(); }
}

async function phoneChecks() {
  const S = startServer(8147);
  const browser = await chromium.launch();
  try {
    await S.ready;
    const admin = await adminClient(S.base);
    let live = (await admin.req('/vote/live')).json;
    const [c1, c2] = live.categories;
    await admin.req('/vote/admin/open', { method: 'POST', body: { categoryIds: [c1.id] } });

    console.log('\n== phone: entering and searching ==');
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const bodies = [];
    page.on('response', async (r) => {
      if (r.url().includes('/vote/') && (r.headers()['content-type'] || '').includes('json')) {
        try { bodies.push(await r.json()); } catch { /* 304 / empty */ }
      }
    });
    await page.goto(`${S.base}/vote?k=${(await frame(admin)).code}`);
    await page.waitForSelector('#ballot:not([hidden])');
    ok(new URL(page.url()).search === '', 'the code is stripped from the address bar');
    ok((await page.textContent('#ballotTitle')) === c1.title, 'one open category → straight into its ballot');
    ok(/Pick exactly 3/.test(await page.textContent('#need')), '"Pick exactly 3" in the header');
    ok((await page.locator('#results li.hdr').count()) > 10, 'empty query: alphabetical with letter headers');
    ok((await page.locator('#rail span').count()) > 10, 'the A–Z rail is shown');
    const railBox = await page.locator('#rail').boundingBox();
    const trayBox = await page.locator('#tray').boundingBox();
    const searchBox = await page.locator('#searchForm').boundingBox();
    ok(railBox.y >= searchBox.y + searchBox.height && railBox.y + railBox.height <= trayBox.y, 'the A–Z rail fits between the search bar and the tray');

    const top = () => page.locator('#results li.row').first();
    await page.fill('#q', 'joao');
    ok((await top().getAttribute('data-name')) === 'João Pedro Silva', '"joao" finds João Pedro Silva first');
    ok((await top().locator('mark').allTextContents()).join('') === 'João', '…with "João" highlighted');
    ok(/^\d+ of 120$/.test((await page.textContent('#count')).trim()), 'result count reads "N of 120"');
    ok(await page.isHidden('#rail'), 'the rail hides while searching');
    await page.screenshot({ path: `${SHOTS}/phone-search.png` });
    await page.press('#q', 'Enter');
    ok((await page.inputValue('#q')) === '', 'Enter picks the top hit and clears the field');
    ok((await page.locator('#chips .chip').count()) === 1, 'the pick lands in the tray');
    ok(/1 of 3/.test(await page.textContent('#picked')), 'tray reads "1 of 3"');

    await page.fill('#q', 'suoza');
    ok((await top().getAttribute('data-name')) === 'Ana Souza', 'typo "suoza" still finds Ana Souza');
    await page.press('#q', 'Enter');
    await page.fill('#q', 'bruno lma');
    ok(await page.isVisible('#empty'), 'no match → empty state');
    ok((await page.textContent('#suggest')).includes('Bruno Lima'), '…with "Did you mean Bruno Lima?"');
    await page.click('#suggest .sug');
    ok((await page.locator('#chips .chip').count()) === 3, 'tapping a suggestion picks it');
    ok(await page.isEnabled('#submit'), 'Submit enabled at exactly 3');

    await page.fill('#q', 'carla');
    await top().click();
    ok(await page.isVisible('#toast.show'), 'a 4th pick is refused with a toast');
    ok((await page.textContent('#toast')).includes("You've picked 3"), '…"You\'ve picked 3 — remove one…"');
    ok((await page.locator('#chips .chip').count()) === 3, '…and the tray still has 3');

    console.log('\n== phone: submitting ==');
    await page.fill('#q', '');
    await page.locator('#submit').dblclick();
    await page.waitForSelector('#tray.submitted');
    await sleep(300);
    ok(!(await page.isVisible('#toast.error')), 'double-tapping Submit shows no error');
    let fc = (await frame(admin)).categories.find((c) => c.id === c1.id);
    ok(fc.ballotCount === 1 && fc.counts[0] === 1 && fc.counts[1] === 1 && fc.counts[4] === 1, 'the server counted Ana, João and Bruno');
    ok((await page.textContent('#submit')).includes('Submitted'), 'button reads "Submitted ✓"');
    await page.reload();
    await page.waitForSelector('#tray.submitted');
    ok((await page.locator('#chips .chip').count()) === 3, 'after a reload the submitted ballot is still shown');

    await page.locator('#chips .chip[data-id="4"]').click();
    ok(!(await page.locator('#tray').getAttribute('class')).includes('submitted'), 'removing a pick un-marks "submitted"');
    await page.fill('#q', 'carla');
    await page.press('#q', 'Enter');
    await page.click('#submit');
    await page.waitForSelector('#tray.submitted');
    fc = (await frame(admin)).categories.find((c) => c.id === c1.id);
    ok(fc.counts[4] === 0 && fc.counts[5] === 1 && fc.ballotCount === 1, 'changing a pick moved one vote');
    ok(bodies.every((b) => leaks(b).length === 0), 'no response the phone received contained counts');

    console.log('\n== phone: home, deadline ==');
    // Long enough for a 3 s poll to show the card, short enough to watch it end.
    await admin.req('/vote/admin/open', { method: 'POST', body: { categoryIds: [c2.id], durationMs: 10_000 } });
    await page.click('#back');
    await page.waitForSelector(`#cards .cat-card.open[data-id="${c2.id}"]`, { timeout: 8000 });
    ok((await page.textContent(`#cards .cat-card[data-id="${c1.id}"] .s`)).includes('Submitted'), 'home: category 1 reads "Submitted ✓"');
    ok((await page.locator('#cards .cat-card.open').count()) === 2, 'home: both open categories listed first');
    await page.screenshot({ path: `${SHOTS}/phone-categories.png` });
    await page.click(`#cards .cat-card[data-id="${c2.id}"]`);
    await page.fill('#q', 'mei lin');
    await page.press('#q', 'Enter');
    await page.waitForSelector('#deadlineMsg:not([hidden])', { timeout: 12_000 });
    ok(/didn.t count/.test(await page.textContent('#deadlineMsg')), "deadline with an unsubmitted draft → \"…didn't count\"");
    ok(await page.isDisabled('#submit'), 'Submit disabled after the deadline');
    {
      const r = await page.locator('#rail').boundingBox();
      const t = await page.locator('#tray').boundingBox();
      const q = await page.locator('#searchForm').boundingBox();
      ok(r.y >= q.y + q.height && r.y + r.height <= t.y, 'with a banner showing, the rail still fits between search and tray');
    }
    await page.screenshot({ path: `${SHOTS}/phone-ballot.png` });

    console.log('\n== phone: gate ==');
    const g = await browser.newContext({ ...devices['iPhone 13'] });
    const gp = await g.newPage();
    await gp.goto(`${S.base}/vote`);
    await gp.waitForSelector('#gate:not([hidden])');
    ok((await gp.textContent('#gateMsg')).includes('Scan the QR on the big screen'), 'no cookie → "Scan the QR on the big screen to vote"');
    await gp.goto(`${S.base}/vote?k=ZZZZZ`);
    await gp.waitForSelector('#gate:not([hidden])');
    ok(/expired/.test(await gp.textContent('#gateMsg')), 'an expired code says so');
    await gp.fill('#codeInput', (await frame(admin)).code.toLowerCase());
    await gp.click('#codeBtn');
    await gp.waitForSelector('#gate', { state: 'hidden' });
    ok(true, 'typing the code (any case) lets you in');
    await gp.screenshot({ path: `${SHOTS}/phone-home.png` });

    console.log('\n== phone: 360 px, 60-char names ==');
    const long = 'Maria Eduarda Quintela de Albuquerque Vasconcelos e Silva Jr';
    await admin.req('/vote/admin/close', { method: 'POST', body: { categoryIds: [c1.id, c2.id] } });
    await admin.req('/vote/admin/config', { method: 'POST', body: { names: [long, ...SEED_NAMES.slice(1)], categories: SEED_CATEGORIES } });
    live = (await admin.req('/vote/live')).json;
    await admin.req('/vote/admin/open', { method: 'POST', body: { categoryIds: [live.categories[0].id] } });
    const small = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, userAgent: devices['Pixel 5'].userAgent });
    const sp = await small.newPage();
    await sp.goto(`${S.base}/vote?k=${(await frame(admin)).code}`);
    await sp.waitForSelector('#ballot:not([hidden])');
    await sp.fill('#q', 'albuquerque'); // only the long name has this word
    await sp.press('#q', 'Enter');
    ok((await sp.locator('#chips .chip').count()) === 1, 'the 60-char name is in the tray');
    ok(await sp.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth), 'no horizontal scroll at 360 px with a 60-char name');
    const h = await sp.locator('#results li.row').first().boundingBox();
    ok(h.height >= 56, 'rows are at least 56 px tall');
    ok(await sp.evaluate(() => parseFloat(getComputedStyle(document.getElementById('q')).fontSize) >= 16), 'search input ≥ 16 px (no iOS zoom)');
    await sp.screenshot({ path: `${SHOTS}/phone-360.png` });

    ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  } finally {
    await browser.close();
    S.child.kill();
  }
}

async function screenChecks() {
  const S = startServer(8148);
  const browser = await chromium.launch();
  try {
    await S.ready;
    const admin = await adminClient(S.base);
    console.log('\n== screen: login and lobby ==');
    const anon = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
    await anon.goto(`${S.base}/vote/screen`);
    await anon.waitForSelector('#login:not([hidden])');
    ok(true, 'no admin session → the screen asks for the password');

    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    await page.goto(`${S.base}/vote/screen`);
    await page.fill('#token', TOKEN);
    await page.click('#loginBtn');
    await page.waitForSelector('#lobby:not([hidden])');
    const code1 = (await page.textContent('#lobbyCode')).trim();
    ok(/^[A-HJKMNP-Z2-9]{5}$/.test(code1), 'lobby shows the 5-char room code');
    ok((await page.locator('#lobbyQr svg').count()) === 1, 'lobby shows the QR');
    ok((await page.locator('#lobbyCats li').count()) === 5, 'lobby lists the categories');
    await page.screenshot({ path: `${SHOTS}/screen-lobby.png` });
    await page.waitForFunction((c) => document.getElementById('lobbyCode').textContent.trim() !== c, code1, { timeout: CODE_MS + 2000 });
    ok(true, 'the code rotates on its own');

    console.log('\n== screen: live stage ==');
    let live = (await admin.req('/vote/live')).json;
    const [c1, c2] = live.categories;
    await admin.req('/vote/admin/open', { method: 'POST', body: { categoryIds: [c1.id, c2.id] } });
    await page.waitForSelector('#stage.n2');
    ok((await page.locator('#stage .panel').count()) === 2, 'two open categories → two panels');
    live = (await admin.req('/vote/live')).json;
    const cat1 = live.categories.find((c) => c.id === c1.id);
    const code = (await page.textContent('#code')).trim();
    for (const [i, picks] of [[0, [0, 1, 2]], [1, [0, 1, 3]], [2, [0, 4, 5]]]) {
      const v = client(S.base, { ip: `192.0.2.${i + 10}`, ua: `Phone${i}` });
      await enterWith(v, code);
      await ballot(v, cat1, live.listVersion, picks);
    }
    const top = page.locator(`#stage .panel[data-id="${c1.id}"] li.prow`).first();
    await page.waitForFunction((id) => document.querySelector(`#stage .panel[data-id="${id}"] li.prow .pvotes`)?.textContent.trim() === '3', c1.id, { timeout: 2000 });
    ok((await top.locator('.pname').textContent()).includes('Ana Souza'), 'Ana Souza leads with 3 within ~1 s');
    ok((await top.locator('.ppct').textContent()).includes('100'), '…on 100 % of ballots');
    ok((await page.locator('#feed li.item').count()) >= 3, 'the live feed shows the +1s');
    ok((await page.textContent('#feed')).includes(c1.title), '…tagged with the category');
    ok(/^\d+:\d\d$/.test((await page.locator(`#stage .panel[data-id="${c1.id}"] .ptimer`).textContent()).trim()), 'each panel has its own countdown');
    await sleep(900); // let the FLIP reorder and the feed slide-ins finish
    await page.screenshot({ path: `${SHOTS}/screen-live.png` });

    await admin.req('/vote/admin/entry', { method: 'POST', body: { open: false } });
    await page.waitForSelector('#entryClosed:not([hidden])');
    ok(await page.isHidden('#qrBox'), 'entry closed → the QR is hidden');
    await admin.req('/vote/admin/entry', { method: 'POST', body: { open: true } });

    console.log('\n== screen: reveal and stage ==');
    await admin.req('/vote/admin/close', { method: 'POST', body: { categoryIds: [c1.id] } });
    await page.waitForSelector(`#stage.n1 .panel[data-id="${c2.id}"]`);
    ok(true, 'auto stage follows the categories still open');
    await admin.req('/vote/admin/close', { method: 'POST', body: { categoryIds: [c2.id] } });
    await admin.req('/vote/admin/stage', { method: 'POST', body: { mode: 'pinned', categoryIds: [c1.id] } });
    await page.waitForSelector(`#stage .panel.podium[data-id="${c1.id}"]`);
    ok((await page.textContent(`#stage .panel[data-id="${c1.id}"]`)).includes('Ana Souza'), 'pinned closed category shows its podium');
    // Bruno, Carla, Lucas and Mariana all tie for 3rd: nobody tied may silently vanish.
    ok(/\+1 more tied/.test(await page.textContent(`#stage .panel[data-id="${c1.id}"] .step.s3`)), 'a 4-way tie for 3rd shows 3 names and "+1 more tied"');
    await sleep(1500); // the podium steps rise in turn
    await page.screenshot({ path: `${SHOTS}/screen-podium.png` });
  } finally {
    await browser.close();
    S.child.kill();
  }
}

async function adminChecks() {
  let S = startServer(8149);
  const browser = await chromium.launch();
  try {
    await S.ready;
    console.log('\n== admin: login and setup ==');
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    const page = await ctx.newPage();
    const login = async () => {
      await page.goto(`${S.base}/vote/admin`);
      await page.waitForSelector('#login:not([hidden])');
      await page.fill('#token', TOKEN);
      await page.click('#loginBtn');
      await page.waitForSelector('#app:not([hidden])');
    };
    await login();
    ok(true, 'login reveals the admin app');
    await page.waitForFunction(() => document.getElementById('names').value.split('\n').length === 120);
    ok(/120/.test(await page.textContent('#namesCount')), 'names textarea holds the 120 seed names');

    await page.fill('#names', (await page.inputValue('#names')) + '\nana souza');
    ok(/same name/.test(await page.textContent('#namesErr')), 'a duplicate (any case/accents) is flagged inline');
    ok(await page.isDisabled('#saveConfig'), '…and Save is disabled');
    await page.fill('#names', SEED_NAMES.join('\n'));
    await page.locator('#cats .cat-row').first().locator('input.title').fill('MVP 2026');
    await page.locator('#cats .cat-row').first().locator('input.picks').fill('2');
    await page.click('#saveConfig');
    const admin = await adminClient(S.base);
    await sleep(300);
    let live = (await admin.req('/vote/live')).json;
    ok(live.categories[0].title === 'MVP 2026' && live.categories[0].picks === 2, 'saving updates title and N');

    console.log('\n== admin: control board ==');
    const [c1, c2] = live.categories;
    await page.check(`#board .board-row[data-id="${c1.id}"] input.sel`);
    await page.check(`#board .board-row[data-id="${c2.id}"] input.sel`);
    await page.click('#dur button[data-min="1"]');
    await page.click('#openSelected');
    await sleep(300);
    live = (await admin.req('/vote/live')).json;
    const o1 = live.categories.find((c) => c.id === c1.id);
    ok(o1.phase === 'open' && Math.abs(o1.endsAt - Date.now() - 60_000) < 5000, 'open selected with the 1-min chip');
    ok(live.categories.find((c) => c.id === c2.id).phase === 'open', '…both categories');
    ok(await page.isDisabled('#saveConfig'), 'setup is locked while a category is open');

    const v = client(S.base, { ip: '192.0.2.77' });
    await enterWith(v, (await frame(admin)).code);
    await ballot(v, o1, live.listVersion, [0, 1]);
    await page.waitForFunction((id) => document.querySelector(`#board .board-row[data-id="${id}"] .bc`)?.textContent.includes('1'), c1.id);
    ok(true, 'the board shows the ballot count live');
    await page.click(`#board .board-row[data-id="${c1.id}"] button.close`);
    let dialog = '';
    page.once('dialog', async (d) => { dialog = d.message(); await d.accept(); });
    await page.click(`#board .board-row[data-id="${c1.id}"] button.open`);
    await sleep(300);
    ok(/clears its 1 ballot/.test(dialog), 'reopening a category with ballots asks first');
    await page.click(`#board .board-row[data-id="${c2.id}"] button.onscreen`);
    await sleep(300);
    ok((await frame(admin)).stage.show.join() === c2.id, '"On screen" pins the stage');
    await page.click('#stageAuto');
    await sleep(300);
    ok((await frame(admin)).stage.mode === 'auto', '"Auto" restores the automatic stage');
    await page.click('#entryBtn');
    await sleep(300);
    ok((await admin.req('/vote/live')).json.entryOpen === false, 'Close entry works');
    await page.click('#entryBtn');

    console.log('\n== admin: fraud panel and results ==');
    live = (await admin.req('/vote/live')).json;
    const cat = live.categories.find((c) => c.id === c2.id);
    const fr = await frame(admin);
    await sleep(fr.codeRotatesAt - fr.now + 50);
    const code = (await frame(admin)).code;
    for (let i = 0; i < 5; i++) {
      const b = client(S.base, { ip: '203.0.113.60', ua: 'BotPhone/2.0' });
      await enterWith(b, code);
      await ballot(b, cat, live.listVersion, [7, 8, 9]);
    }
    await page.waitForSelector('#flags .flag', { timeout: 4000 });
    ok(/identical ballot/.test(await page.textContent('#flags .flag .why')), 'cluster flag explained in plain English');
    ok((await page.textContent('#flags .flag .names')).includes(SEED_NAMES[7]), '…naming the ballot');
    await page.click('#flags .flag button.void');
    await page.waitForFunction(() => document.querySelector('#flags .flag button.void')?.textContent.trim() === 'Restore');
    ok((await frame(admin)).categories.find((c) => c.id === cat.id).voidedCount === 5, 'Void removes the five ballots');
    ok(/5/.test(await page.textContent('#voidedTotal')), 'voided total updates');

    await page.click(`#resTabs button[data-id="${c2.id}"]`);
    await page.fill('#resFilter', 'joao');
    ok((await page.locator('#resTable tbody tr').count()) >= 1 && (await page.textContent('#resTable tbody')).includes('João'), 'results filter uses the same search');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#csv')]);
    const csv = await (await import('node:fs/promises')).readFile(await dl.path(), 'utf8');
    ok(csv.startsWith('category,rank,name,votes\n') && csv.includes('"MVP 2026"'), 'CSV export covers every category');
    await page.screenshot({ path: `${SHOTS}/admin.png`, fullPage: true });

    console.log('\n== admin: restore after restart ==');
    await admin.req('/vote/admin/close', { method: 'POST', body: { categoryIds: [c1.id, c2.id] } });
    const exited = new Promise((r) => S.child.once('exit', r));
    S.child.kill();
    await exited; // the port must be free before the restart binds it
    S = startServer(8149);
    await S.ready;
    await login();
    await page.waitForSelector('#restoreBar:not([hidden])');
    await page.click('#restoreBtn');
    await page.click('#saveConfig');
    await sleep(300);
    const after = (await (await adminClient(S.base)).req('/vote/live')).json;
    ok(after.categories[0].title === 'MVP 2026', 'the saved setup is restored after a restart');

    console.log('\n== admin: phone width ==');
    const m = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage();
    await m.goto(`${S.base}/vote/admin`);
    await m.fill('#token', TOKEN);
    await m.click('#loginBtn');
    await m.waitForSelector('#app:not([hidden])');
    ok(await m.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth), 'admin has no horizontal scroll on a phone');
    await m.screenshot({ path: `${SHOTS}/admin-phone.png`, fullPage: true });
  } finally {
    await browser.close();
    S.child.kill();
  }
}

await apiChecks();
await phoneChecks();
await screenChecks();
await adminChecks();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
