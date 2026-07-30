// Browser + crash-guard verification for the 5k reliability pass.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { ROSTER } from '../src/locales/animals.js';
import esLocale from '../src/locales/es.js';
import itLocale from '../src/locales/it.js';

// Every name a locale can possibly mint, so an assertion can say "this is
// Italian" without hard-coding one of 42 × N outcomes.
const legalNames = (loc) => {
  const out = new Set();
  for (const { key } of ROSTER) {
    const [word, g = 'm'] = loc.animals[key];
    for (const adj of loc.adjectives) {
      for (const title of loc.titles) out.add(loc.compose({ name: word, g }, adj, title));
    }
  }
  return out;
};
const bare = (s) => s.trim().replace(/\s*#\d+\s*$/, '');

const ROOT = new URL('..', import.meta.url).pathname;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔', m); } else { fail++; console.log('  ✘', m); } };

// ------------------------------------------------- crash guard (real throw)
console.log('\n== uncaughtException guard ==');
{
  const child = spawn(process.execPath, [
    '--input-type=module', '-e',
    `await import('${ROOT}src/server.js');
     setTimeout(() => { throw new Error('synthetic boom'); }, 300);
     setTimeout(() => { Promise.reject(new Error('synthetic rejection')); }, 500);
     setTimeout(async () => {
       const r = await fetch('http://127.0.0.1:8138/livez');
       console.log('ALIVE_AFTER_THROW ' + r.status);
       process.exit(0);
     }, 900);`,
  ], { env: { ...process.env, PORT: '8138', ADMIN_TOKEN: 'x', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const code = await new Promise((r) => child.on('exit', r));
  ok(out.includes('uncaughtException (staying up'), 'uncaught throw is logged, not fatal');
  ok(out.includes('unhandledRejection (staying up'), 'unhandled rejection is logged, not fatal');
  ok(out.includes('ALIVE_AFTER_THROW 200'), 'server still answers /livez after both');
  ok(code === 0, 'process exited only when told to');
}

// ------------------------------------------------------------------ browser
const TOKEN = 'uitok';
const srv = spawn(process.execPath, [ROOT + 'src/server.js'], {
  env: { ...process.env, PORT: '8139', ADMIN_TOKEN: TOKEN, NODE_ENV: 'test' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
await sleep(900);
const B = 'http://127.0.0.1:8139';
const browser = await chromium.launch();

/**
 * The id in localStorage once the server agrees it exists — a page that boots
 * with a forgotten id (server restart, or the host clearing the room) polls
 * /state, sees `known:false` and re-registers. Returns null if it never does.
 */
const recoveredId = async (page, timeoutMs = 6000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const id = await page.evaluate(() => localStorage.getItem('tapId'));
    if (id && (await (await fetch(B + '/state?id=' + id)).json()).known) return id;
    await sleep(200);
  }
  return null;
};

try {
  // Pinned so the run means the same thing on any laptop. The interface is
  // English regardless — only the generated names follow the browser.
  const ctx = await browser.newContext({ locale: 'pt-BR' });
  const errors = [];
  ctx.on('weberror', (e) => errors.push(String(e.error())));

  console.log('\n== phone: compressed page loads and plays ==');
  const encodings = [];
  const phone = await ctx.newPage();
  phone.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  phone.on('response', (r) => {
    if (r.url().endsWith('/') || r.url().endsWith('/theme.css')) {
      encodings.push(r.headers()['content-encoding'] || 'identity');
    }
  });
  await phone.goto(B + '/', { waitUntil: 'networkidle' });
  ok(encodings.length > 0 && encodings.every((e) => e === 'br' || e === 'gzip'),
    `real browser received compressed assets (${encodings.join(', ')})`);
  await phone.waitForFunction(() => document.getElementById('name')?.textContent !== 'Connecting…', null, { timeout: 5000 });
  ok(true, 'phone got an identity');

  // The phone persists only its id, so everything else has to come back from
  // /state. It used to come back without `seq`, and the player's #number
  // vanished on every reload — the one thing that makes two Turbo Lions tellable
  // apart on the leaderboard.
  const seqBefore = (await phone.textContent('#seq')).trim();
  ok(/^#\d+$/.test(seqBefore), `phone shows its number (${seqBefore})`);
  await phone.reload({ waitUntil: 'networkidle' });
  await phone.waitForFunction(() => document.getElementById('name')?.textContent !== 'Connecting…', null, { timeout: 5000 });
  ok((await phone.textContent('#seq')).trim() === seqBefore, 'and still shows it after a reload');
  ok((await phone.textContent('#name')).trim().length > 1, 'along with the same name');

  const screen = await ctx.newPage();
  await screen.goto(B + '/screen', { waitUntil: 'domcontentloaded' });

  // A real browser configured in Spanish, so the Accept-Language path is
  // exercised by Chromium itself rather than by a synthetic header.
  console.log('\n== a Spanish phone gets a Spanish name ==');
  {
    const esCtx = await browser.newContext({ locale: 'es-AR' });
    const esPhone = await esCtx.newPage();
    await esPhone.goto(B + '/', { waitUntil: 'networkidle' });
    await esPhone.waitForFunction(() => document.getElementById('name')?.textContent !== 'Connecting…', null, { timeout: 5000 });
    const shown = (await esPhone.textContent('#name')).trim();
    ok(legalNames(esLocale).has(bare(shown)), `Chromium set to es-AR was named "${shown}"`);
    // Named in Spanish, framed in English — that split is the whole design, so
    // a Spanish browser is exactly where a regression would show up first.
    ok(await esPhone.evaluate(() => document.documentElement.lang) === 'en', 'the page still declares itself English');
    ok((await esPhone.textContent('.who')).trim() === 'You are', 'and the interface around the name stays English');
    await esCtx.close();
  }

  console.log('\n== ?lang= pins the name language on a shared link ==');
  {
    const deCtx = await browser.newContext({ locale: 'de-DE' });
    const forced = await deCtx.newPage();
    await forced.goto(B + '/?lang=it', { waitUntil: 'networkidle' });
    await forced.waitForFunction(() => document.getElementById('name')?.textContent !== 'Connecting…', null, { timeout: 5000 });
    const shownIt = (await forced.textContent('#name')).trim();
    ok(legalNames(itLocale).has(bare(shownIt)), `?lang=it beat the de-DE browser (named "${shownIt}")`);
    ok((await forced.textContent('#btnlabel')).trim() === 'WAIT', 'and the interface is still English');
    await deCtx.close();
  }

  // The host laptop is usually mirrored to the projector, so the real test is
  // not "can you log in" but "is the secret ever on screen or on disk".
  console.log('\n== host: the password is typed once and never kept ==');
  const host = await ctx.newPage();
  await host.goto(B + '/host', { waitUntil: 'domcontentloaded' });
  ok(await host.getAttribute('#token', 'type') === 'password', 'the field is masked by default');
  ok(await host.inputValue('#token') === '', 'the field starts empty (nothing prefilled)');

  await host.click('#peek');
  const peeked = await host.getAttribute('#token', 'type');
  await host.click('#peek');
  ok(peeked === 'text' && await host.getAttribute('#token', 'type') === 'password',
    'the peek button reveals, then re-masks');

  await host.click('#start');
  await sleep(250);
  ok((await host.textContent('#msg')).includes('Enter the admin password'), 'start with no password is refused client-side');

  await host.fill('#token', 'wrong');
  await host.click('#start');
  await sleep(600);
  ok((await host.textContent('#msg')).includes('Wrong admin password'), 'a wrong password is refused server-side');

  await host.fill('#token', TOKEN);
  await host.click('#start');
  await host.waitForSelector('#authok:not([hidden])', { timeout: 5000 });
  ok(await host.isHidden('#authbox'), 'a good password swaps the prompt for a session badge');
  ok(await host.inputValue('#token') === '', 'the field is wiped the moment it is accepted');
  ok((await host.textContent('#msg')).includes('Round started'), 'the same click also started the round');

  const stored = await host.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage));
  ok(!stored.includes(TOKEN), 'the password is in neither localStorage nor sessionStorage');
  ok(await host.evaluate(() => document.cookie) === '', 'the session cookie is invisible to page script');

  console.log('\n== the session, not the password, survives a reload ==');
  await fetch(B + '/admin/reset', { method: 'POST', headers: { 'x-admin-token': TOKEN } });
  await host.reload({ waitUntil: 'domcontentloaded' });
  await host.waitForSelector('#authok:not([hidden])', { timeout: 5000 });
  ok(await host.inputValue('#token') === '', 'nothing is re-typed and nothing is restored');

  await host.selectOption('#dur', '15000');
  await host.click('#start');
  await sleep(400);
  ok((await host.textContent('#msg')).includes('Round started'), 'the cookie alone drives a second round');

  await host.click('#logout');
  await host.waitForSelector('#authbox:not([hidden])', { timeout: 5000 });
  ok(await host.isHidden('#authok'), 'logout returns the page to the password prompt');
  await host.click('#start');
  await sleep(250);
  ok((await host.textContent('#msg')).includes('Enter the admin password'), 'after logout the buttons ask again');
  await fetch(B + '/admin/reset', { method: 'POST', headers: { 'x-admin-token': TOKEN } });

  console.log('\n== a full round still runs ==');
  // Drive the timing from the server's own timestamps rather than fixed sleeps,
  // which drift and then race the settle boundary.
  const admin = { 'content-type': 'application/json', 'x-admin-token': TOKEN };
  const r0 = await (await fetch(B + '/admin/start', {
    method: 'POST', headers: admin, body: JSON.stringify({ durationMs: 5000 }),
  })).json();
  const skew = Date.now() - r0.serverNow;
  const until = (t, pad = 0) => sleep(Math.max(0, t + skew - Date.now() + pad));

  await until(r0.startsAt, 250);
  ok(!(await phone.locator('#btn').getAttribute('class')).includes('disabled'), 'phone button is live once the round starts');

  const box = await phone.locator('#btn').boundingBox();
  for (let i = 0; i < 25; i++) {
    await phone.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await sleep(12);
  }
  const shown = Number((await phone.textContent('#count')).replace(/\D/g, ''));
  ok(shown >= 20, `taps registered locally (${shown})`);

  // The in-flight guard must not drop taps: whatever the phone shows must
  // survive the round and match the server once everything has flushed.
  await until(r0.settlesAt, 900);
  const phoneId = await phone.evaluate(() => localStorage.getItem('tapId'));
  const st = await (await fetch(B + '/state?id=' + phoneId)).json();
  ok(st.phase === 'ended' && st.settled, 'round ended and settled');
  const serverTaps = st.yourCount;
  ok(serverTaps >= 20, `server credited the taps despite the in-flight guard (${serverTaps})`);
  const finalShown = Number((await phone.textContent('#count')).replace(/\D/g, ''));
  ok(finalShown === serverTaps, `phone (${finalShown}) agrees with server (${serverTaps})`);
  ok((await screen.textContent('#champlabel')).includes('Champion'), 'screen revealed the champion');

  {
    // Titles made names longer (39 characters at worst, "Praktikant
    // Unerbittlicher Tyrannosaurus"). The champion card is the one place a
    // name is rendered at 84px, so it is the one place it can shove itself off
    // the projector. Measured, not eyeballed — with the worst name there is.
    const longest = [...legalNames(itLocale)].reduce((a, b) => (b.length > a.length ? b : a), '');
    const overflow = await screen.evaluate((name) => {
      const card = document.getElementById('champ');
      const nm = card.querySelector('.nm');
      if (!nm) return { skipped: true };
      nm.textContent = name;
      return { skipped: false, cardRight: card.getBoundingClientRect().right, vw: window.innerWidth };
    }, longest);
    ok(!overflow.skipped && overflow.cardRight <= overflow.vw,
      `the longest name (${longest.length} chars) stays on screen: card ends at ${Math.round(overflow.cardRight)} of ${overflow.vw}px`);
  }

  console.log('\n== reset clears the room and the phone finds its way back ==');
  {
    // Reset empties the roster, so every phone in the room is holding an id the
    // server has just forgotten. Nobody is told to reload: the page polls
    // /state, reads `known:false` and re-registers itself.
    const before = await phone.evaluate(() => localStorage.getItem('tapId'));
    await fetch(B + '/admin/reset', { method: 'POST', headers: { 'x-admin-token': TOKEN } });
    ok((await (await fetch(B + '/state?id=' + before)).json()).known === false,
      'the reset really did drop the player, ghosts and all');
    const back = await recoveredId(phone);
    ok(back !== null && back !== before, 'the phone noticed and re-registered under a new id');
    const name = (await phone.textContent('#name')).trim();
    ok(name.length > 0 && name !== 'Connecting…', `and it is showing a fresh name ("${name}")`);
    ok(Number((await phone.textContent('#count')).replace(/\D/g, '')) === 0, 'starting from zero taps');
  }

  console.log('\n== a refused beacon does not eat the last batch ==');
  {
    // sendBeacon returns false when the UA queue is full, and is missing
    // entirely on some in-app webviews. The taps are still ours either way.
    //
    // Its own context: two pages in one browser share localStorage and would
    // race each other re-registering after the reset above, each ending up
    // tapping as a different player than the key says.
    await fetch(B + '/admin/reset', { method: 'POST', headers: { 'x-admin-token': TOKEN } });
    const bctx = await browser.newContext({ locale: 'pt-BR' });
    const bp = await bctx.newPage();
    await bp.goto(B + '/', { waitUntil: 'networkidle' });
    await bp.waitForFunction(() => document.getElementById('name')?.textContent !== 'Connecting…', null, { timeout: 5000 });
    const bId = await recoveredId(bp);
    ok(bId !== null, 'the beacon phone is registered');
    await bp.evaluate(() => { navigator.sendBeacon = () => false; });

    const r1 = await (await fetch(B + '/admin/start', {
      method: 'POST', headers: admin, body: JSON.stringify({ durationMs: 4000 }),
    })).json();
    const skew1 = Date.now() - r1.serverNow;
    await sleep(Math.max(0, r1.startsAt + skew1 - Date.now() + 250));

    // One synchronous burst: tap, then hide the page before the flush timer can
    // run, so the batch is genuinely still pending when the beacon is refused.
    await bp.evaluate(() => {
      const btn = document.getElementById('btn');
      for (let i = 0; i < 10; i++) btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
      window.dispatchEvent(new Event('pagehide'));
    });

    await sleep(Math.max(0, r1.settlesAt + skew1 - Date.now() + 1200));
    const after = await (await fetch(B + '/state?id=' + bId)).json();
    ok(after.yourCount === 10, `all 10 taps survived the refused beacon (server has ${after.yourCount})`);
    await bctx.close();
  }

  console.log('\n== dashboard: a public page that watches the round ==');
  {
    await fetch(B + '/admin/reset', { method: 'POST', headers: { 'x-admin-token': TOKEN } });
    // No auth, no cookie — a fresh context proves the page needs neither.
    const anonCtx = await browser.newContext();
    const dashErrors = [];
    anonCtx.on('weberror', (e) => dashErrors.push(String(e.error())));
    const dash = await anonCtx.newPage();
    dash.on('console', (m) => { if (m.type() === 'error') dashErrors.push(m.text()); });
    // domcontentloaded, not networkidle: the page polls forever, so the network
    // is never idle and networkidle would simply time out.
    await dash.goto(B + '/dashboard', { waitUntil: 'domcontentloaded' });
    await dash.waitForFunction(() => Number(document.getElementById('players').textContent.replace(/\D/g, '')) > 0,
      null, { timeout: 6000 });
    const players0 = (await dash.textContent('#players')).trim();
    ok(true, `dashboard loaded with no credentials and shows ${players0} players`);
    ok((await dash.textContent('#phase')).trim() === 'LOBBY', 'phase pill reads the lobby');

    const bots = [];
    for (let i = 0; i < 6; i++) bots.push((await (await fetch(B + '/join', { method: 'POST' })).json()).id);
    const r2 = await (await fetch(B + '/admin/start', {
      method: 'POST', headers: admin, body: JSON.stringify({ durationMs: 9000 }),
    })).json();
    const skew2 = Date.now() - r2.serverNow;
    await sleep(Math.max(0, r2.startsAt + skew2 - Date.now() + 200));
    await dash.waitForFunction(() => document.getElementById('phase').textContent.trim() === 'RUNNING',
      null, { timeout: 6000 });
    ok(true, 'phase pill followed the round into RUNNING');

    for (let i = 0; i < 6; i++) {
      await Promise.all(bots.map((id) => fetch(B + '/tap', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, n: 20 }),
      })));
      await sleep(450);
    }
    // Tweened, so this asserts the animation is running as much as the poll.
    await dash.waitForFunction(() => Number(document.getElementById('taps').textContent.replace(/\D/g, '')) > 0,
      null, { timeout: 6000 });
    const tapsShown = Number((await dash.textContent('#taps')).replace(/\D/g, ''));
    ok(tapsShown > 0, `taps counter moved during the round (${tapsShown})`);
    // Tweened like the rest, so wait for it to arrive rather than reading mid-ease.
    await dash.waitForFunction(() => Number(document.getElementById('tapping').textContent.replace(/\D/g, '')) >= 6,
      null, { timeout: 6000 });
    ok(true, `the room split shows the bots as tapping, not idle (${(await dash.textContent('#tapping')).trim()})`);
    // Mid-tween the counter holds a fraction, and a single read almost never
    // lands on one. Arm a frame recorder that starts on the next change, then
    // push taps at it — `en` only ever puts a "." in a number as a decimal point.
    const recording = dash.evaluate(() => new Promise((res) => {
      const el = document.getElementById('taps');
      const start = el.textContent; const seen = []; let armed = false; let budget = 400;
      (function step() {
        if (armed || el.textContent !== start) { armed = true; seen.push(el.textContent); }
        // Always resolves: a hung recorder would stall the check, not fail it.
        if (seen.length < 30 && budget-- > 0) requestAnimationFrame(step); else res(seen);
      })();
    }));
    for (let i = 0; i < 3; i++) {
      await Promise.all(bots.map((id) => fetch(B + '/tap', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, n: 40 }),
      })));
      await sleep(500);
    }
    const frames = await recording;
    ok(frames.length === 30 && !frames.some((s) => s.includes('.')),
      `${frames.length} frames of a live tween, not one fractional value`);
    ok((await dash.locator('#rank li').count()) >= 6, 'the leaderboard filled in');
    ok(!(await dash.locator('#rank li').first().getAttribute('class') || '').includes('empty'),
      '…with real rows, not the placeholder');

    const pts = await dash.getAttribute('#spTaps polyline', 'points');
    ok(pts && pts.split(' ').length > 2, `the taps sparkline drew a series (${pts.split(' ').length} points)`);
    ok((await dash.getAttribute('#spPlayers polyline', 'points') || '').length > 0, 'so did the players sparkline');

    const lagClass = await dash.getAttribute('#lag >> xpath=..', 'class');
    ok(/\b(good|warn|bad)\b/.test(lagClass || ''), `loop lag is colour-coded (${lagClass})`);
    ok((await dash.textContent('#tapIv')).trim() !== '—', 'the server-dictated cadence is shown');

    await until(r2.settlesAt, 1400);
    await dash.waitForFunction(() => document.getElementById('clock').textContent.includes('final'),
      null, { timeout: 8000 });
    ok(true, 'the clock reached "final" once the grace window closed');

    ok(dashErrors.length === 0, dashErrors.length ? 'dashboard console errors: ' + dashErrors.join(' | ') : 'zero console errors on the dashboard');
    await anonCtx.close();
    await fetch(B + '/admin/reset', { method: 'POST', headers: { 'x-admin-token': TOKEN } });
  }

  console.log('\n== no console errors ==');
  const real = errors.filter((e) => !/favicon/i.test(e));
  ok(real.length === 0, real.length ? 'console errors: ' + real.join(' | ') : 'zero console errors');
} finally {
  await browser.close();
  srv.kill('SIGTERM');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
