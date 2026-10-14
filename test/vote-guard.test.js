import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VoteGuard, CODE_ALPHABET, clientIp, sameOrigin } from '../src/vote-guard.js';
import { Vote } from '../src/vote.js';

const SECRET = Buffer.from('test-secret-test-secret-test-sec');
const guard = (opts = {}) => new VoteGuard({ secret: SECRET, ...opts });
const enter = (g, now, extra = {}) =>
  g.enter({ code: g.roomCode(now), ip: '10.0.0.1', ua: 'UA', now, ...extra });

test('room code: 5 chars from the unambiguous alphabet, rotating every epoch', () => {
  const g = guard();
  const c = g.roomCode(0);
  assert.equal(c.length, 5);
  assert.ok([...c].every((ch) => CODE_ALPHABET.includes(ch)));
  assert.ok(!/[01OIL]/.test(CODE_ALPHABET));
  assert.equal(CODE_ALPHABET.length, 31);
  assert.equal(g.roomCode(29_999), c);
  assert.notEqual(g.roomCode(30_000), c);
  assert.equal(g.codeRotatesAt(12_345), 30_000);
});

test('a code is accepted for its epoch and the next one only (30–60 s), case/space-insensitive', () => {
  const g = guard();
  const c = g.roomCode(10_000);
  assert.equal(g.checkCode(c, 10_000), true);
  assert.equal(g.checkCode(` ${c.toLowerCase()} `, 10_000), true);
  assert.equal(g.checkCode(c, 59_999), true);
  assert.equal(g.checkCode(c, 60_000), false);
  assert.equal(g.checkCode('', 10_000), false);
  assert.equal(g.checkCode('ABC', 10_000), false);
});

test('a different secret yields different codes and rejects foreign cookies', () => {
  const a = guard();
  const b = new VoteGuard({ secret: Buffer.from('another-secret-another-secret-ab') });
  assert.notEqual(a.roomCode(0), b.roomCode(0));
  const r = enter(a, 0);
  assert.equal(b.verify(r.cookie), null);
});

test('enter mints a device with a signed cookie; tampering and unknown ids fail', () => {
  const g = guard();
  const r = enter(g, 0);
  assert.equal(r.ok, true);
  assert.equal(g.verify(r.cookie), r.voterId);
  assert.equal(g.verify(r.cookie.slice(0, -1) + (r.cookie.endsWith('A') ? 'B' : 'A')), null);
  assert.equal(g.verify(`someone-else.${r.cookie.split('.')[1]}`), null);
  assert.equal(g.verify(undefined), null);
  assert.equal(g.verify('x'.repeat(500)), null);
});

test('an entered device stays in: old code or closed entry do not matter', () => {
  const g = guard();
  const r = enter(g, 0);
  g.setEntry(false);
  const again = g.enter({ code: 'WRONG', existing: r.cookie, ip: '10.0.0.1', ua: 'UA', now: 999_999 });
  assert.deepEqual([again.ok, again.already, again.voterId], [true, true, r.voterId]);
  assert.equal(g.devices.size, 1);
});

test('entry lock refuses new devices even with a valid code', () => {
  const g = guard();
  g.setEntry(false);
  assert.equal(enter(g, 0).reason, 'entry_closed');
});

test('wrong codes are throttled per IP after 20 in a minute; right codes never count', () => {
  const g = guard();
  for (let i = 0; i < 100; i++) assert.equal(enter(g, 0).ok, true, 'a whole NAT can enter');
  for (let i = 0; i < 19; i++) g.enter({ code: 'ZZZZZ', ip: '1.1.1.1', ua: 'x', now: 1000 });
  assert.equal(g.enter({ code: 'ZZZZZ', ip: '1.1.1.1', ua: 'x', now: 1000 }).reason, 'bad_code');
  assert.equal(enter(g, 1000, { ip: '1.1.1.1' }).reason, 'throttled', 'blocked even with a right code');
  assert.equal(enter(g, 1000, { ip: '2.2.2.2' }).ok, true, 'other IPs unaffected');
  assert.equal(enter(g, 61_001, { ip: '1.1.1.1' }).ok, true, 'block lifts after a minute');
});

test('device cap', () => {
  const g = guard({ maxDevices: 2 });
  enter(g, 0);
  enter(g, 0);
  assert.equal(enter(g, 0).reason, 'full');
});

test('cookie header: HttpOnly, SameSite=Strict, scoped to /vote, Secure only on TLS', () => {
  const g = guard();
  assert.match(g.cookieHeader('v', false), /^tv_voter=v; Path=\/vote; HttpOnly; SameSite=Strict; Max-Age=43200$/);
  assert.match(g.cookieHeader('v', true), /; Secure$/);
});

test('submit limits: one per second and 30 per round, per device and category', () => {
  const g = guard();
  assert.equal(g.allowSubmit('a', 'c1', 1, 0).ok, true);
  assert.equal(g.allowSubmit('a', 'c1', 1, 999).reason, 'too_fast');
  assert.equal(g.allowSubmit('a', 'c2', 1, 999).ok, true, 'other categories are separate');
  let t = 1000;
  for (let i = 1; i < 30; i++, t += 1000) assert.equal(g.allowSubmit('a', 'c1', 1, t).ok, true);
  assert.equal(g.allowSubmit('a', 'c1', 1, t).reason, 'too_many');
  assert.equal(g.allowSubmit('a', 'c1', 2, t).ok, true, 'a new round starts fresh');
});

// A Vote with one open 3-pick category, plus a guard with devices entered.
function scene({ devices, sameUa = true, ballots }) {
  const v = new Vote({ names: ['A', 'B', 'C', 'D', 'E', 'F'], categories: [{ title: 'MVP', picks: 3 }] });
  const cat = v.categories[0];
  v.open([cat.id], undefined, 0);
  const g = guard();
  const ids = [];
  for (let i = 0; i < devices; i++) {
    const r = enter(g, 1000, { ua: sameUa ? 'iPhone' : `UA${i}` });
    ids.push(r.voterId);
    v.submit(r.voterId, { categoryId: cat.id, roundId: cat.roundId, listVersion: v.listVersion, picks: ballots(i) }, 2000);
  }
  return { v, g, cat, ids };
}

test('cluster: ≥5 identical ballots from one network+browser+entry window are flagged', () => {
  const { v, g, cat } = scene({ devices: 6, ballots: () => [0, 1, 2] });
  g.detect(v.categories, 3000);
  const flags = g.listFlags(v.categories);
  assert.equal(flags.length, 1);
  assert.deepEqual([flags[0].kind, flags[0].devices, flags[0].candidateIds, flags[0].weak], ['cluster', 6, [0, 1, 2], false]);
  assert.equal(flags[0].categoryId, cat.id);
  assert.equal('voterIds' in flags[0], false, 'voter ids never leave the server');
});

test('cluster: a diverse NAT group is NOT flagged', () => {
  const sets = [[0, 1, 2], [0, 1, 3], [0, 2, 4], [1, 3, 5], [2, 4, 5], [0, 3, 5], [1, 2, 4], [3, 4, 5]];
  const { v, g } = scene({ devices: 8, ballots: (i) => sets[i] });
  g.detect(v.categories, 3000);
  assert.equal(g.listFlags(v.categories).length, 0);
});

test('cluster: identical ballots from different browsers are NOT one group', () => {
  const { v, g } = scene({ devices: 6, sameUa: false, ballots: () => [0, 1, 2] });
  g.detect(v.categories, 3000);
  assert.equal(g.listFlags(v.categories).length, 0);
});

test('burst: ≥20 gains in 10 s while on ≥60% of that window’s ballots', () => {
  const g = guard();
  const cats = [{ id: 'c1', roundId: 1, picks: 3, ballots: new Map() }];
  for (let i = 0; i < 20; i++) g.noteSubmit('c1', `v${i}`, [4], [4, i % 3, 5], 1000 + i);
  for (let i = 0; i < 5; i++) g.noteSubmit('c1', `w${i}`, [1], [1, 2, 3], 1500);
  g.detect(cats, 2000);
  const f = g.listFlags(cats);
  assert.equal(f.length, 1);
  assert.deepEqual([f[0].kind, f[0].candidateIds, f[0].gained, f[0].sharePct], ['burst', [4], 20, 80]);
  g.detect(cats, 20_000);
  assert.equal(g.recent.get('c1').length, 0, 'the window slides');
});

test('void sticks: new members of an already-voided flag come back for auto-void', () => {
  const { v, g, cat } = scene({ devices: 5, ballots: () => [0, 1, 2] });
  g.detect(v.categories, 3000);
  const [flag] = g.listFlags(v.categories);
  g.markVoided(flag.id, true);
  const r = enter(g, 1000, { ua: 'iPhone' });
  v.submit(r.voterId, { categoryId: cat.id, roundId: cat.roundId, listVersion: v.listVersion, picks: [0, 1, 2] }, 4000);
  assert.deepEqual(g.detect(v.categories, 5000), [{ categoryId: cat.id, voterIds: [r.voterId] }]);
});

test('restorable skips voters another voided flag still holds', () => {
  const g = guard();
  g.flags.set('a', { id: 'a', categoryId: 'c1', roundId: 1, voided: true, voterIds: ['x', 'y'] });
  g.flags.set('b', { id: 'b', categoryId: 'c1', roundId: 1, voided: true, voterIds: ['y', 'z'] });
  assert.deepEqual(g.restorable('a'), ['x']);
});

test('flags from an earlier round of a category are hidden', () => {
  const { v, g, cat } = scene({ devices: 5, ballots: () => [0, 1, 2] });
  g.detect(v.categories, 3000);
  v.close([cat.id], 4000);
  v.open([cat.id], undefined, 5000);
  assert.equal(g.listFlags(v.categories).length, 0);
});

test('clientIp takes the rightmost X-Forwarded-For entry, else the socket', () => {
  assert.equal(clientIp('6.6.6.6, 203.0.113.9', '::1'), '203.0.113.9');
  assert.equal(clientIp('203.0.113.9', '::1'), '203.0.113.9');
  assert.equal(clientIp(undefined, '::1'), '::1');
  assert.equal(clientIp(' , ', '::1'), '::1');
});

test('sameOrigin: Sec-Fetch-Site wins, then Origin vs Host; no headers passes', () => {
  assert.equal(sameOrigin({ 'sec-fetch-site': 'same-origin' }), true);
  assert.equal(sameOrigin({ 'sec-fetch-site': 'cross-site' }), false);
  assert.equal(sameOrigin({ 'sec-fetch-site': 'same-site' }), false);
  assert.equal(sameOrigin({ origin: 'https://vote.example', host: 'vote.example' }), true);
  assert.equal(sameOrigin({ origin: 'https://evil.example', host: 'vote.example' }), false);
  assert.equal(sameOrigin({ origin: 'null', host: 'vote.example' }), false);
  assert.equal(sameOrigin({ host: 'vote.example' }), true);
});
