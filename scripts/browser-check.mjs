// Browser + crash-guard verification for the 5k reliability pass.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { ROSTER } from '../src/locales/animals.js';
import esLocale from '../src/locales/es.js';
import { UI } from '../src/locales/ui.js';

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
  // Pinned rather than inherited: every Portuguese assertion below is now a
  // statement about *this* locale, and the run means the same thing on a laptop
  // configured in German.
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
    // The name and the chrome around it are resolved by two different pieces of
    // code — normalizeLocale on the server, pick() on the phone. This is the
    // assertion that they agree: a Spanish name inside an English page was the
    // whole reason for this work.
    ok(await esPhone.evaluate(() => document.documentElement.lang) === 'es', 'and the page around the name is Spanish too');
    ok((await esPhone.textContent('.who')).trim() === UI.phone.es.whoLabel, `es-AR sees "${UI.phone.es.whoLabel}"`);
    await esCtx.close();
  }

  console.log('\n== the chrome follows the browser, and ?lang= overrules it ==');
  {
    const deCtx = await browser.newContext({ locale: 'de-DE' });
    const dePhone = await deCtx.newPage();
    await dePhone.goto(B + '/', { waitUntil: 'networkidle' });
    ok(await dePhone.evaluate(() => document.documentElement.lang) === 'de', 'a German browser gets a German page');
    ok((await dePhone.textContent('.who')).trim() === UI.phone.de.whoLabel, `de-DE sees "${UI.phone.de.whoLabel}"`);
    ok((await dePhone.textContent('#btnlabel')).trim() === UI.phone.de.btnWait, `the button says "${UI.phone.de.btnWait}"`);

    // A shared link with a language on it: the projector at a venue whose wifi
    // router is in the wrong country, or a host handing out /screen?lang=fr.
    const forced = await deCtx.newPage();
    await forced.goto(B + '/?lang=it', { waitUntil: 'networkidle' });
    ok(await forced.evaluate(() => document.documentElement.lang) === 'it', '?lang=it beats a de-DE browser');
    ok((await forced.textContent('#btnlabel')).trim() === UI.phone.it.btnWait, `the button says "${UI.phone.it.btnWait}"`);

    // domcontentloaded, not networkidle: the projector holds an SSE stream open
    // for the whole event, so the network is never idle.
    const deScreen = await deCtx.newPage();
    await deScreen.goto(B + '/screen', { waitUntil: 'domcontentloaded' });
    ok((await deScreen.title()) === UI.screen.de.title, 'the projector titles its own tab in German');
    // The counted phrase is the one string whose *word order* moves with the
    // language, and the number inside it carries the green mono styling. Assert
    // both: right plural form, and the number still wrapped in its <b>.
    const ready = await deScreen.evaluate(() => {
      const el = document.getElementById('lobbyReady');
      return { text: el.textContent.trim(), bold: (el.querySelector('b') || {}).textContent || '' };
    });
    const count = Number(ready.bold.replace(/\D/g, ''));
    const want = UI.screen.de.playersReady[new Intl.PluralRules('de').select(count)]
      .replace('{n}', new Intl.NumberFormat('de').format(count));
    ok(ready.text === want, `the counted phrase reads "${ready.text}"`);
    ok(ready.bold !== '', 'the number is still wrapped for styling after translation');
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
  ok((await host.textContent('#msg')).includes(UI.host.pt.msgNeedPw), 'start with no password is refused client-side');

  await host.fill('#token', 'wrong');
  await host.click('#start');
  await sleep(600);
  ok((await host.textContent('#msg')).includes(UI.host.pt.msgBadPw), 'a wrong password is refused server-side');

  await host.fill('#token', TOKEN);
  await host.click('#start');
  await host.waitForSelector('#authok:not([hidden])', { timeout: 5000 });
  ok(await host.isHidden('#authbox'), 'a good password swaps the prompt for a session badge');
  ok(await host.inputValue('#token') === '', 'the field is wiped the moment it is accepted');
  ok((await host.textContent('#msg')).includes(UI.host.pt.msgStarted), 'the same click also started the round');

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
  ok((await host.textContent('#msg')).includes(UI.host.pt.msgStarted), 'the cookie alone drives a second round');

  await host.click('#logout');
  await host.waitForSelector('#authbox:not([hidden])', { timeout: 5000 });
  ok(await host.isHidden('#authok'), 'logout returns the page to the password prompt');
  await host.click('#start');
  await sleep(250);
  ok((await host.textContent('#msg')).includes(UI.host.pt.msgNeedPw), 'after logout the buttons ask again');
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
  ok((await screen.textContent('#champlabel')).includes(UI.screen.pt.champLabel), 'screen revealed the champion');

  // Switching language is a re-render, never a reload. A player who fixes the
  // language mid-event must not lose the taps they already banked.
  console.log('\n== the picker switches chrome without costing identity ==');
  {
    const nameBefore = (await phone.textContent('#name')).trim();
    const idBefore = await phone.evaluate(() => localStorage.getItem('tapId'));
    ok((await phone.textContent('#btnlabel')).trim() === UI.phone.pt.btnOver, `pt-BR phone says "${UI.phone.pt.btnOver}"`);

    await phone.selectOption('#lang', 'de');
    await phone.waitForFunction(
      (want) => document.getElementById('btnlabel').textContent.trim() === want,
      UI.phone.de.btnOver, { timeout: 3000 },
    );
    ok(true, `the picker switched the button to "${UI.phone.de.btnOver}"`);
    ok((await phone.textContent('.who')).trim() === UI.phone.de.whoLabel, 'the static chrome switched with it');
    ok(await phone.evaluate(() => document.documentElement.lang) === 'de', '<html lang> followed the picker');
    ok((await phone.textContent('#name')).trim() === nameBefore,
      `the name minted in Portuguese is left alone ("${nameBefore}")`);
    ok(Number((await phone.textContent('#count')).replace(/\D/g, '')) === serverTaps,
      `the ${serverTaps} banked taps survived the switch`);
    ok(await phone.evaluate(() => localStorage.getItem('tapId')) === idBefore, 'the player id is untouched');

    // Remembered, so the next round does not start in the wrong language again.
    await phone.reload({ waitUntil: 'networkidle' });
    ok(await phone.evaluate(() => localStorage.getItem('tapLang')) === 'de', 'the choice is remembered');
    ok((await phone.textContent('.who')).trim() === UI.phone.de.whoLabel, 'and it survives a reload');
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
