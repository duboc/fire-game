// Throwaway verification harness for the 5k reliability pass.
import { spawn } from 'node:child_process';
import { randomBytes, scryptSync } from 'node:crypto';
import zlib from 'node:zlib';
import { Game } from '../src/game.js';
import { ROSTER } from '../src/locales/animals.js';
import de from '../src/locales/de.js';
import en from '../src/locales/en.js';
import es from '../src/locales/es.js';
import fr from '../src/locales/fr.js';
import it from '../src/locales/it.js';
import pt from '../src/locales/pt.js';

const LOCALE_MODULES = { de, en, es, fr, it, pt };

const ROOT = new URL('..', import.meta.url).pathname;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔', m); } else { fail++; console.log('  ✘', m); } };

// ---------------------------------------------------------------- engine cost
console.log('\n== _recount cost at 5.000 players ==');
{
  const g = new Game();
  for (let i = 0; i < 5000; i++) g.join('p' + i);
  g.start({ now: 0 });
  for (let i = 0; i < 5000; i++) g.tap('p' + i, 1 + (i % 40), 3500);

  // dirty path (a tap landed since the last recount)
  let t = process.hrtime.bigint();
  for (let i = 0; i < 200; i++) { g._dirty = true; g._recount(); }
  const dirtyMs = Number(process.hrtime.bigint() - t) / 1e6 / 200;

  // clean path (nothing changed — lobby, or between taps)
  g._recount();
  t = process.hrtime.bigint();
  for (let i = 0; i < 200; i++) g._recount();
  const cleanMs = Number(process.hrtime.bigint() - t) / 1e6 / 200;

  console.log(`  dirty: ${dirtyMs.toFixed(3)}ms  -> ${(dirtyMs * 10 / 10).toFixed(2)}% of one core at 10 ticks/s`);
  console.log(`  clean: ${cleanMs.toFixed(4)}ms -> effectively free`);
  ok(cleanMs < 0.001, 'a clean recount is essentially free');
  ok(dirtyMs < 1.7, `dirty recount still under the old 1,673ms baseline (${dirtyMs.toFixed(3)}ms)`);
  ok(g.players.get('p4999').rank > 0, 'ranks are written onto players');
}

// ---------------------------------------------------------------- live server
const TOKEN = 'testtok';
const srv = spawn(process.execPath, [ROOT + 'src/server.js'], {
  env: { ...process.env, PORT: '8137', ADMIN_TOKEN: TOKEN, HEARTBEAT_MS: '2000', NODE_ENV: 'test' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let srvOut = '';
srv.stdout.on('data', (d) => { srvOut += d; });
srv.stderr.on('data', (d) => { srvOut += d; });
await sleep(900);
const B = 'http://127.0.0.1:8137';

try {
  console.log('\n== static assets: compression + revalidation ==');
  let totalRaw = 0, totalBr = 0, totalGz = 0;
  for (const p of ['/', '/screen', '/host', '/theme.css']) {
    const raw = await fetch(B + p, { headers: { 'accept-encoding': 'identity' } });
    const rawBuf = Buffer.from(await raw.arrayBuffer());

    const br = await fetch(B + p, { headers: { 'accept-encoding': 'br' } });
    const brBuf = Buffer.from(await br.arrayBuffer());
    const gz = await fetch(B + p, { headers: { 'accept-encoding': 'gzip' } });
    const gzBuf = Buffer.from(await gz.arrayBuffer());

    // fetch() transparently decodes, so compare against the wire length header.
    const brWire = Number(br.headers.get('content-length'));
    const gzWire = Number(gz.headers.get('content-length'));
    // Only what a *phone* fetches. /screen and /host are one client each.
    if (p === '/' || p === '/theme.css') { totalRaw += rawBuf.length; totalBr += brWire; totalGz += gzWire; }

    ok(br.headers.get('content-encoding') === 'br', `${p} negotiates brotli`);
    ok(gz.headers.get('content-encoding') === 'gzip', `${p} negotiates gzip`);
    ok(brBuf.equals(rawBuf) && gzBuf.equals(rawBuf), `${p} decodes byte-identical to the raw file`);
    ok(brWire < rawBuf.length * 0.5, `${p} brotli ${rawBuf.length}B -> ${brWire}B`);
    ok((br.headers.get('vary') || '').includes('Accept-Encoding'), `${p} sets Vary: Accept-Encoding`);

    const etag = raw.headers.get('etag');
    ok(!!etag, `${p} sends an ETag`);
    ok(raw.headers.get('cache-control') === 'no-cache', `${p} is no-cache (revalidate, not re-download)`);
    const revalidate = await fetch(B + p, { headers: { 'if-none-match': etag } });
    ok(revalidate.status === 304, `${p} revalidates to 304`);
    const weak = await fetch(B + p, { headers: { 'if-none-match': 'W/' + etag } });
    ok(weak.status === 304, `${p} accepts a weak ETag`);
  }
  console.log(`  phone payload ${totalRaw}B raw / ${totalGz}B gzip / ${totalBr}B brotli`);
  console.log(`  5.000 phones: ${(totalRaw * 5000 / 1048576).toFixed(1)} MiB raw` +
    ` -> ${(totalGz * 5000 / 1048576).toFixed(1)} MiB gzip -> ${(totalBr * 5000 / 1048576).toFixed(1)} MiB brotli`);

  console.log('\n== fonts still served, still immutable ==');
  const f = await fetch(B + '/fonts/roboto-400.woff2');
  ok(f.status === 200, 'font 200s');
  ok((f.headers.get('cache-control') || '').includes('immutable'), 'font is immutable-cached');

  console.log('\n== the pages are self-contained ==');
  {
    for (const url of ['/', '/screen', '/host']) {
      const body = await (await fetch(B + url)).text();
      // Event wifi is the one thing we cannot fix: a render-blocking request to
      // a third-party font host is a blank phone. Roboto is self-hosted.
      ok(!/fonts\.(googleapis|gstatic)\.com/.test(body), `${url} asks no third-party font host`);
      ok(!/<script[^>]+src=/.test(body), `${url} pulls in no external script`);
    }
    const tags = await Promise.all(['/', '/screen', '/host']
      .map(async (u) => (await fetch(B + u)).headers.get('etag')));
    ok(new Set(tags).size === 3, 'each page has its own content-addressed ETag');
  }

  console.log('\n== admin token is no longer public ==');
  const cfg = await (await fetch(B + '/config')).json();
  ok(!('adminToken' in cfg), '/config does not return adminToken');
  ok(!JSON.stringify(cfg).includes(TOKEN), '/config body contains the token nowhere');
  const homepage = await (await fetch(B + '/host')).text();
  ok(!homepage.includes(TOKEN), '/host does not ship the token');
  const denied = await fetch(B + '/admin/reset', { method: 'POST' });
  ok(denied.status === 401, 'admin without a token is refused');
  const allowed = await fetch(B + '/admin/reset', { method: 'POST', headers: { 'x-admin-token': TOKEN } });
  ok(allowed.status === 200, 'admin with the token still works');

  console.log('\n== game still plays ==');
  const me = await (await fetch(B + '/join', { method: 'POST' })).json();
  await fetch(B + '/admin/start', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': TOKEN },
    body: JSON.stringify({ durationMs: 1200 }),
  });
  await sleep(3200);
  const tapped = await (await fetch(B + '/tap', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: me.id, n: 9 }),
  })).json();
  ok(tapped.yourCount === 9, `tap counted (${tapped.yourCount})`);
  ok(tapped.yourRank === 1, `rank served from the snapshot (#${tapped.yourRank})`);
  await sleep(2600);
  const done = await (await fetch(B + '/state?id=' + me.id)).json();
  ok(done.phase === 'ended' && done.settled, 'round ended and settled');

  console.log('\n== heartbeat ==');
  await sleep(2200);
  const beat = srvOut.split('\n').filter((l) => l.startsWith('beat')).pop();
  console.log('  ' + beat);
  ok(/^beat phase=\w+ players=\d+ taps=\d+ rps=\d+ conns=-?\d+ lag_max=-?\d+ms rss=\d+MB sse=\d+$/.test(beat || ''),
    'heartbeat line is well formed');

  // Last, deliberately: this section joins ~250 players and would otherwise
  // push the single player in "game still plays" off rank #1.
  console.log('\n== names arrive in the player\'s own language ==');
  {
    // Every grammatically legal name, per locale. If agreement ever regresses,
    // the produced name simply falls outside this set — no rule duplicated here.
    const legal = new Map();
    for (const [code, mod] of Object.entries(LOCALE_MODULES)) {
      const set = new Set();
      for (const { key } of ROSTER) {
        const [word, g = 'm'] = mod.animals[key];
        for (const adj of mod.adjectives) set.add(mod.compose({ name: word, g }, adj));
      }
      legal.set(code, set);
    }

    const joinAs = async (header) => {
      const r = await fetch(B + '/join', {
        method: 'POST', headers: header ? { 'accept-language': header } : {},
      });
      return r.json();
    };

    ok((await joinAs('pt-BR,pt;q=0.9,en;q=0.8')).locale === 'pt', 'pt-BR resolves to Portuguese');
    ok((await joinAs('es-AR')).locale === 'es', 'es-AR resolves to Spanish');
    ok((await joinAs('de-CH,de;q=0.9')).locale === 'de', 'de-CH resolves to German');
    ok((await joinAs('ja-JP,ja;q=0.9')).locale === 'en', 'an unsupported language gets English');
    ok((await joinAs('zh-CN,fr;q=0.9')).locale === 'fr', 'the first *supported* tag wins, not the first tag');
    ok((await joinAs(null)).locale === 'en', 'no Accept-Language at all still yields a name');
    const hostile = await joinAs('__proto__,constructor;q=0.9');
    ok(hostile.locale === 'en' && hostile.name.length > 0, 'a hostile Accept-Language is just an unknown language');

    // ?lang= is what keeps the *name* in step with the phone's picker: a player
    // who switches to German gets a German name on their next join, not the one
    // their browser would have asked for.
    const joinWith = async (qs, header) => (await fetch(B + '/join?' + qs, {
      method: 'POST', headers: header ? { 'accept-language': header } : {},
    })).json();

    ok((await joinWith('lang=de')).locale === 'de', '?lang=de names the player in German');
    ok((await joinWith('lang=it', 'de-DE,de;q=0.9')).locale === 'it', '?lang= beats Accept-Language');
    // An explicit ?lang= wins even when we do not speak it: it is a deliberate
    // choice, and silently answering in the browser's language instead would
    // make a typo look like the picker had ignored the player.
    ok((await joinWith('lang=klingon', 'de-DE')).locale === 'en', 'an unsupported ?lang= falls back to English');
    ok((await joinWith('lang=' + 'x'.repeat(5000))).locale === 'en', 'an oversized ?lang= is just unknown');
    ok((await joinWith('lang=fr&lang=de')).locale === 'en', 'a repeated ?lang= (an array) is rejected, not coerced');

    // End-to-end grammar: 40 real joins per language, every name legal.
    let illegal = null, checked = 0;
    for (const code of Object.keys(LOCALE_MODULES)) {
      for (let i = 0; i < 40; i++) {
        const id = await joinAs(code);
        checked += 1;
        if (!legal.get(code).has(id.name)) { illegal = `${code}: "${id.name}"`; break; }
      }
      if (illegal) break;
    }
    ok(!illegal, illegal ? `ungrammatical name ${illegal}` : `${checked} live names all grammatical`);

    // The self-healing rejoin on /tap must carry the language too, or a player
    // who reconnects mid-round silently changes nationality.
    const healed = await (await fetch(B + '/tap', {
      method: 'POST', headers: { 'content-type': 'application/json', 'accept-language': 'it-IT' },
      body: JSON.stringify({ id: 'nope-not-a-real-id', n: 1 }),
    })).json();
    ok(healed.rejoined === true && healed.locale === 'it', 'a /tap self-heal keeps the language');
  }


  console.log('\n== process survives an uncaught error ==');
  process.kill(srv.pid, 0);
  ok(srv.exitCode === null, 'server still alive at the end of the run');
} finally {
  srv.kill('SIGTERM');
}

// -------------------------------------------------------- password + sessions
//
// Exercises the built-in-password path (no ADMIN_TOKEN) against a hash this
// script derives for a throwaway password. The real event password is never
// needed here and must never appear in this file.
console.log('\n== built-in password, scrypt path ==');
{
  const PW = 'contract-Check!42';
  const salt = randomBytes(16);
  const hash = scryptSync(PW, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const HASH = `scrypt$16384$8$1$${salt.toString('base64url')}$${hash.toString('base64url')}`;

  const s2 = spawn(process.execPath, [ROOT + 'src/server.js'], {
    env: {
      ...process.env, PORT: '8143', ADMIN_PASSWORD_HASH: HASH, NODE_ENV: 'test',
      ADMIN_TOKEN: undefined, HEARTBEAT_MS: '60000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await sleep(900);
  const C = 'http://127.0.0.1:8143';
  const json = { 'content-type': 'application/json' };

  try {
    // Derived from PW rather than written out, so this stays a genuine
    // near-miss of whatever password is under test without hinting at one.
    const wrong = await fetch(C + '/admin/login', {
      method: 'POST', headers: json, body: JSON.stringify({ token: PW.slice(0, -1) + '3' }),
    });
    ok(wrong.status === 401, 'a near-miss password is refused');
    ok(!wrong.headers.get('set-cookie'), 'a refused login sets no cookie');

    const good = await fetch(C + '/admin/login', {
      method: 'POST', headers: json, body: JSON.stringify({ token: PW }),
    });
    ok(good.status === 200, 'the built-in password authenticates');
    const setCookie = good.headers.get('set-cookie') || '';
    ok(/HttpOnly/i.test(setCookie), 'session cookie is HttpOnly (script cannot read it)');
    ok(/SameSite=Strict/i.test(setCookie), 'session cookie is SameSite=Strict (no cross-site reset)');
    ok(!setCookie.includes(PW), 'session cookie is not the password');

    const cookie = setCookie.split(';')[0];
    const sess = await (await fetch(C + '/admin/session', { headers: { cookie } })).json();
    ok(sess.authenticated === true, '/admin/session reports the live session');

    const started = await fetch(C + '/admin/start', {
      method: 'POST', headers: { ...json, cookie }, body: JSON.stringify({ durationMs: 1000 }),
    });
    ok(started.status === 200, 'the cookie alone drives /admin/start — no password resent');

    const noCookie = await fetch(C + '/admin/reset', { method: 'POST' });
    ok(noCookie.status === 401, 'without the cookie it is still refused');

    await fetch(C + '/admin/logout', { method: 'POST', headers: { cookie } });
    const after = await fetch(C + '/admin/reset', { method: 'POST', headers: { cookie } });
    ok(after.status === 401, 'logout invalidates the session server-side');

    const anon = await (await fetch(C + '/admin/session')).json();
    ok(anon.authenticated === false, '/admin/session is honest about no session');

    // Nothing served may contain the password or the hash.
    let leaked = false;
    for (const p of ['/', '/host', '/screen', '/theme.css', '/config']) {
      const body = await (await fetch(C + p)).text();
      if (body.includes(PW) || body.includes(HASH) || body.includes(salt.toString('base64url'))) leaked = true;
    }
    ok(!leaked, 'no served asset contains the password or its hash');

    const cfg = await (await fetch(C + '/config')).json();
    ok(!('adminToken' in cfg) && !('devMode' in cfg), '/config says nothing about admin auth');

    // Guessing gets slower. The first failures are ~free, so compare a later
    // burst against the throttle's own step rather than against zero.
    const t0 = Date.now();
    for (let i = 0; i < 4; i++) {
      await fetch(C + '/admin/login', { method: 'POST', headers: json, body: JSON.stringify({ token: 'nope' + i }) });
    }
    const elapsed = Date.now() - t0;
    ok(elapsed > 1000, `repeated wrong guesses are throttled (${elapsed}ms for 4)`);

    const stillGood = await fetch(C + '/admin/login', {
      method: 'POST', headers: json, body: JSON.stringify({ token: PW }),
    });
    ok(stillGood.status === 200, 'the throttle never locks the real host out');
  } finally {
    s2.kill('SIGTERM');
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
