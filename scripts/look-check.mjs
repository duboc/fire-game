// Visual check for Live Vote's Google Cloud look — every page, in its key states,
// served the way the `live-vote` service runs it (APPS=vote).
//
//   npm run check:look        # screenshots to /tmp/look-check/, contrast audit
//
// Drives the phone, big screen and admin through real states in Chromium
// and, at every capture, audits each visible piece of text against the
// background it actually sits on (WCAG: 4.5:1, or 3:1 for large text), and
// flags any large dark surface left over from the old black theme. Text over
// gradients or images is skipped — those get the screenshot review.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium, devices } from 'playwright';

const ROOT = new URL('..', import.meta.url).pathname;
const SHOTS = '/tmp/look-check';
const PORT = 8150;
const B = `http://127.0.0.1:${PORT}`;
const TOKEN = 'looktok';
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const ok = (c, m) => {
  if (c) { pass++; console.log('  ✔', m); } else { fail++; console.log('  ✘', m); }
};

// Runs in the page. Effective background = the element's own and ancestors'
// background colours, alpha-blended down to the canvas.
function auditInPage() {
  const parse = (c) => {
    const m = c && c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const blend = (t, u) => ({ r: t.r * t.a + u.r * (1 - t.a), g: t.g * t.a + u.g * (1 - t.a), b: t.b * t.a + u.b * (1 - t.a), a: 1 });
  const bgOf = (el) => {
    const stack = [];
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null; // gradient/image: screenshot review
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; }
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) base = blend(stack[i], base);
    return base;
  };
  const shown = (el) => {
    if (el.closest('[hidden]')) return false;
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.15) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  };
  const contrast = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const t = walker.currentNode;
    const el = t.parentElement;
    // .gwm is the multi-colour "Google Cloud" wordmark: logotypes are exempt
    // from contrast requirements (WCAG 2.x SC 1.4.3).
    if (!t.textContent.trim() || !el || seen.has(el) || el.closest('svg, canvas, script, style, .gwm')) continue;
    seen.add(el);
    if (!shown(el)) continue;
    const cs = getComputedStyle(el);
    if ((cs.webkitTextFillColor || '').includes('rgba(0, 0, 0, 0)')) continue; // gradient-filled text
    const fg = parse(cs.color);
    const bg = bgOf(el);
    if (!fg || !bg) continue;
    const f = fg.a < 1 ? blend(fg, bg) : fg;
    const L1 = lum(f);
    const L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(cs.fontSize);
    const need = size >= 24 || (parseInt(cs.fontWeight, 10) >= 700 && size >= 18.66) ? 3 : 4.5;
    if (ratio < need) {
      const cls = typeof el.className === 'string' && el.className ? `.${el.className.split(' ')[0]}` : '';
      contrast.push(`${ratio.toFixed(2)}<${need} "${t.textContent.trim().slice(0, 32)}" <${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${cls}>`);
    }
  }
  const dark = [];
  for (const e of document.querySelectorAll('body *')) {
    const r = e.getBoundingClientRect();
    if (r.width * r.height < innerWidth * innerHeight * 0.12 || !shown(e)) continue;
    const c = parse(getComputedStyle(e).backgroundColor);
    if (c && c.a > 0.5 && lum(c) < 0.2) dark.push(`<${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}>`);
  }
  return { contrast, dark };
}

async function capture(page, name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  const { contrast, dark } = await page.evaluate(auditInPage);
  ok(contrast.length === 0, `${name}: text contrast${contrast.length ? '\n      ' + contrast.slice(0, 8).join('\n      ') : ''}`);
  ok(dark.length === 0, `${name}: no large dark surfaces${dark.length ? ' — ' + dark.join(' ') : ''}`);
}

const srv = spawn(process.execPath, [ROOT + 'src/server.js'], {
  env: {
    ...process.env, PORT: String(PORT), ADMIN_TOKEN: TOKEN, NODE_ENV: 'test', HEARTBEAT_MS: '60000',
    APPS: 'vote', VOTE_CODE_MS: '3000', VOTE_MIN_DURATION_MS: '2000',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const browser = await chromium.launch();
const adminPost = (path, body) => fetch(B + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': TOKEN }, body: JSON.stringify(body ?? {}) });
const loggedIn = async (opts) => {
  const ctx = await browser.newContext(opts);
  await ctx.request.post(B + '/admin/login', { data: { token: TOKEN } });
  return ctx;
};

try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/livez')).ok) break; } catch { /* booting */ } await sleep(100); }
  const PHONE = devices['iPhone 13'];
  const SCREEN = { viewport: { width: 1920, height: 1080 } };
  const DESK = { viewport: { width: 1366, height: 900 } };

  console.log('\n== Live Vote ==');
  const live = await (await fetch(B + '/vote/live')).json();
  const [c1, c2] = live.categories;
  const vscreenCtx = await loggedIn(SCREEN);
  const vscreen = await vscreenCtx.newPage();
  await vscreen.goto(B + '/vote/screen');
  await vscreen.waitForSelector('#lobby:not([hidden])');
  await sleep(800);
  await capture(vscreen, 'vote-screen-lobby');
  const code = (await vscreen.textContent('#lobbyCode')).trim();
  const vphone = await (await browser.newContext(PHONE)).newPage();
  await vphone.goto(B + '/vote');
  await vphone.waitForSelector('#gate:not([hidden])');
  await capture(vphone, 'vote-phone-gate');
  await adminPost('/vote/admin/open', { categoryIds: [c1.id, c2.id] });
  await vphone.goto(`${B}/vote?k=${code}`);
  await vphone.waitForSelector('#home:not([hidden]), #ballot:not([hidden])');
  await sleep(600);
  await capture(vphone, 'vote-phone-home');
  await vphone.click(`#cards .cat-card[data-id="${c1.id}"]`);
  await vphone.fill('#q', 'joao');
  await capture(vphone, 'vote-phone-search');
  for (const q of ['joao pedro', 'ana souza', 'bruno lima']) { await vphone.fill('#q', q); await vphone.press('#q', 'Enter'); }
  await vphone.click('#submit');
  await vphone.waitForSelector('#tray.submitted');
  await capture(vphone, 'vote-phone-submitted');
  await sleep(1200);
  await capture(vscreen, 'vote-screen-live');
  const vadmin = await (await loggedIn(DESK)).newPage();
  await vadmin.goto(B + '/vote/admin');
  await vadmin.waitForSelector('#app:not([hidden])');
  await sleep(800);
  await capture(vadmin, 'vote-admin');
  await adminPost('/vote/admin/close', { categoryIds: [c1.id, c2.id] });
  await sleep(2500);
  await capture(vscreen, 'vote-screen-podium');
} finally {
  await browser.close();
  srv.kill();
}
console.log(`\n${pass} passed, ${fail} failed — screenshots in ${SHOTS}`);
process.exit(fail ? 1 : 0);
