// Browser + crash-guard verification for the 5k reliability pass.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { ROSTER } from '../src/locales/animals.js';
import esLocale from '../src/locales/es.js';

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

try {
  const ctx = await browser.newContext();
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
  await phone.waitForFunction(() => document.getElementById('name')?.textContent !== '—', null, { timeout: 5000 });
  ok(true, 'phone got an identity');

  const screen = await ctx.newPage();
  await screen.goto(B + '/screen', { waitUntil: 'domcontentloaded' });

  // A real browser configured in Spanish, so the Accept-Language path is
  // exercised by Chromium itself rather than by a synthetic header.
  console.log('\n== a Spanish phone gets a Spanish name ==');
  {
    const esCtx = await browser.newContext({ locale: 'es-AR' });
    const esPhone = await esCtx.newPage();
    await esPhone.goto(B + '/', { waitUntil: 'networkidle' });
    await esPhone.waitForFunction(() => document.getElementById('name')?.textContent !== '—', null, { timeout: 5000 });
    const shown = (await esPhone.textContent('#name')).trim();
    const legal = new Set();
    for (const { key } of ROSTER) {
      const [word, g = 'm'] = esLocale.animals[key];
      for (const adj of esLocale.adjectives) legal.add(esLocale.compose({ name: word, g }, adj));
    }
    ok(legal.has(shown.replace(/\s*#\d+\s*$/, '')), `Chromium set to es-AR was named "${shown}"`);
    await esCtx.close();
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
  ok((await host.textContent('#msg')).includes('Informe a senha'), 'start with no password is refused client-side');

  await host.fill('#token', 'wrong');
  await host.click('#start');
  await sleep(600);
  ok((await host.textContent('#msg')).includes('incorreta'), 'a wrong password is refused server-side');

  await host.fill('#token', TOKEN);
  await host.click('#start');
  await host.waitForSelector('#authok:not([hidden])', { timeout: 5000 });
  ok(await host.isHidden('#authbox'), 'a good password swaps the prompt for a session badge');
  ok(await host.inputValue('#token') === '', 'the field is wiped the moment it is accepted');
  ok((await host.textContent('#msg')).includes('iniciada'), 'the same click also started the round');

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
  ok((await host.textContent('#msg')).includes('iniciada'), 'the cookie alone drives a second round');

  await host.click('#logout');
  await host.waitForSelector('#authbox:not([hidden])', { timeout: 5000 });
  ok(await host.isHidden('#authok'), 'logout returns the page to the password prompt');
  await host.click('#start');
  await sleep(250);
  ok((await host.textContent('#msg')).includes('Informe a senha'), 'after logout the buttons ask again');
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
  ok((await screen.textContent('#champlabel')).includes('Campeão'), 'screen revealed the champion');

  console.log('\n== no console errors ==');
  const real = errors.filter((e) => !/favicon/i.test(e));
  ok(real.length === 0, real.length ? 'console errors: ' + real.join(' | ') : 'zero console errors');
} finally {
  await browser.close();
  srv.kill('SIGTERM');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
