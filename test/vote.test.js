import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vote, PHASE, LIMITS } from '../src/vote.js';
import { SEED_NAMES, SEED_CATEGORIES } from '../src/vote-seed.js';

const NAMES = ['Ana Souza', 'Bruno Lima', 'Carla Dias', 'Diego Rocha', 'Élio Santos'];
const CATS = [{ title: 'MVP', picks: 2 }, { title: 'Helpful', picks: 1 }];

function fresh() {
  return new Vote({ names: NAMES, categories: CATS });
}
// A valid ballot for category `cat` of vote `v`.
const ballot = (v, cat, picks) => ({ categoryId: cat.id, roundId: cat.roundId, listVersion: v.listVersion, picks });

test('the default categories are the event’s five, pick 3 each', () => {
  assert.deepEqual(SEED_CATEGORIES.map((c) => [c.title, c.picks]), [
    ['CUSTOMER FOCUS', 3],
    ['COLLABORATOR CROSS-REGIONAL', 3],
    ['COMPETITIVENESS CHAMPION', 3],
    ['TOP "SCALER" FOR THE BUSINESS', 3],
    ['NEW WAYS OF GROWTH (Catch the Opportunity)', 3],
  ]);
});

test('the baked-in seed is valid: 120 names, 5 categories of 3 picks', () => {
  const v = new Vote({ names: SEED_NAMES, categories: SEED_CATEGORIES });
  assert.equal(v.candidates.length, 120);
  assert.equal(v.categories.length, 5);
  assert.ok(v.categories.every((c) => c.picks === 3 && c.phase === PHASE.SETUP));
  assert.equal(v.listVersion, 1);
});

test('configure rejects duplicates after accent/case folding, naming both lines', () => {
  const v = fresh();
  const r = v.configure({ names: ['Élio Santos', 'Ana', 'elio  SANTOS'], categories: CATS });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /line 3.*line 1/);
  assert.equal(v.candidates.length, NAMES.length, 'a rejected save changes nothing');
});

test('configure enforces name length, list bounds, category bounds, titles and N range', () => {
  const v = fresh();
  const long = 'x'.repeat(LIMITS.maxNameLen + 1);
  const bad = (names, categories) => v.configure({ names, categories }).ok;
  assert.equal(bad([long, 'Ana'], CATS), false);
  assert.equal(bad(['Ana'], CATS), false); // < 2 names
  assert.equal(bad(Array.from({ length: 301 }, (_, i) => `P${i}`), CATS), false);
  assert.equal(bad(NAMES, []), false);
  assert.equal(bad(NAMES, Array.from({ length: 7 }, (_, i) => ({ title: `C${i}`, picks: 1 }))), false);
  assert.equal(bad(NAMES, [{ title: '  ', picks: 1 }]), false);
  assert.equal(bad(NAMES, [{ title: 'MVP', picks: 0 }]), false);
  assert.equal(bad(NAMES, [{ title: 'MVP', picks: 6 }]), false); // N > names
  assert.equal(bad(NAMES, [{ title: 'MVP', picks: 1.5 }]), false);
  assert.equal(bad(['  Ana   Souza ', '', 'Bruno'], [{ title: 'MVP', picks: 1 }]), true);
  assert.equal(v.candidates[0].name, 'Ana Souza', 'whitespace collapsed, blanks dropped');
});

test('configure is refused while any category is open', () => {
  const v = fresh();
  v.open([v.categories[0].id], undefined, 0);
  const r = v.configure({ names: NAMES, categories: CATS });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /Close every open category/);
});

test('what a save clears: names → every category; N → that category; title → nothing', () => {
  const v = fresh();
  const [mvp, helpful] = v.categories;
  v.open([mvp.id, helpful.id], undefined, 0);
  v.submit('a', ballot(v, mvp, [0, 1]), 1);
  v.submit('a', ballot(v, helpful, [2]), 1);
  v.close([mvp.id, helpful.id], 2);

  v.configure({ names: NAMES, categories: [{ id: mvp.id, title: 'MVP 2026', picks: 2 }, { id: helpful.id, title: 'Helpful', picks: 1 }] });
  assert.equal(v.categories[0].ballotCount, 1, 'title edit keeps ballots');
  assert.equal(v.categories[0].phase, PHASE.CLOSED);

  v.configure({ names: NAMES, categories: [{ id: mvp.id, title: 'MVP 2026', picks: 3 }, { id: helpful.id, title: 'Helpful', picks: 1 }] });
  assert.equal(v.categories[0].ballotCount, 0, 'N change clears that category');
  assert.equal(v.categories[0].phase, PHASE.SETUP);
  assert.equal(v.categories[1].ballotCount, 1, '…and only that one');

  const lv = v.listVersion;
  v.configure({ names: [...NAMES, 'Fábio Moura'], categories: [{ id: mvp.id, title: 'MVP 2026', picks: 3 }, { id: helpful.id, title: 'Helpful', picks: 1 }] });
  assert.equal(v.listVersion, lv + 1);
  assert.equal(v.categories[1].ballotCount, 0, 'names change clears every category');
  assert.equal(v.categories[1].counts.length, 6);
});

test('categories keep stable ids across saves; new ones get fresh ids; removed pins drop off the stage', () => {
  const v = fresh();
  const [mvp, helpful] = v.categories;
  v.setStage({ mode: 'pinned', categoryIds: [helpful.id] });
  v.configure({ names: NAMES, categories: [{ id: mvp.id, title: 'MVP', picks: 2 }, { title: 'New', picks: 1 }] });
  assert.equal(v.categories[0].id, mvp.id);
  assert.notEqual(v.categories[1].id, helpful.id);
  assert.equal(v.stage.mode, 'auto', 'pinned stage with nothing left falls back to auto');
});

test('open starts a fresh round per category with its own deadline; default 3 min', () => {
  const v = fresh();
  const [mvp, helpful] = v.categories;
  assert.equal(v.open([mvp.id], undefined, 1000).ok, true);
  assert.equal(mvp.endsAt, 1000 + 180_000);
  assert.equal(v.open([helpful.id], 60_000, 5000).ok, true);
  assert.equal(helpful.endsAt, 65_000);
  assert.deepEqual(v.tick(65_000), [helpful.id]);
  assert.equal(helpful.phase, PHASE.CLOSED);
  assert.equal(mvp.phase, PHASE.OPEN, 'deadlines are independent');
  assert.deepEqual(v.tick(181_000), [mvp.id]);
});

test('open validates duration and category ids', () => {
  const v = fresh();
  assert.equal(v.open([v.categories[0].id], 10_000, 0).ok, false);
  assert.equal(v.open([v.categories[0].id], 5 * 3600_000, 0).ok, false);
  assert.equal(v.open(['nope'], 60_000, 0).ok, false);
  assert.equal(v.open([], 60_000, 0).ok, false);
});

test('minDurationMs is overridable (test harnesses only)', () => {
  const v = new Vote({ names: NAMES, categories: CATS, minDurationMs: 1000 });
  assert.equal(v.open([v.categories[0].id], 2000, 0).ok, true);
  assert.equal(fresh().open([fresh().categories[0].id], 2000, 0).ok, false);
});

test('submit: exactly N distinct valid ids, replace with ±1 deltas, identical is a no-op', () => {
  const v = fresh();
  const mvp = v.categories[0];
  v.open([mvp.id], undefined, 0);
  assert.equal(v.submit('a', ballot(v, mvp, [0]), 1).reason, 'wrong_count');
  assert.equal(v.submit('a', ballot(v, mvp, [0, 0]), 1).reason, 'bad_picks');
  assert.equal(v.submit('a', ballot(v, mvp, [0, 99]), 1).reason, 'bad_picks');
  assert.equal(v.submit('a', ballot(v, mvp, [0, '1']), 1).reason, 'bad_picks');

  let r = v.submit('a', ballot(v, mvp, [1, 0]), 1);
  assert.deepEqual([r.ok, r.ballot, r.added], [true, [0, 1], [0, 1]]);
  assert.deepEqual(mvp.counts, [1, 1, 0, 0, 0]);
  assert.equal(mvp.ballotCount, 1);

  r = v.submit('a', ballot(v, mvp, [1, 2]), 2);
  assert.deepEqual(r.added, [2]);
  assert.deepEqual(mvp.counts, [0, 1, 1, 0, 0], 'dropped −1, added +1, kept unchanged');
  assert.equal(mvp.ballotCount, 1, 'a replacement is not a second ballot');

  const before = v.version;
  r = v.submit('a', ballot(v, mvp, [2, 1]), 3);
  assert.deepEqual([r.ok, r.changed], [true, false]);
  assert.equal(v.version, before, 'identical resubmit changes nothing');
});

test('submit refuses at the deadline even before tick runs, and after close', () => {
  const v = fresh();
  const mvp = v.categories[0];
  v.open([mvp.id], 60_000, 0);
  assert.equal(v.submit('a', ballot(v, mvp, [0, 1]), 60_000).reason, 'closed');
  assert.equal(mvp.phase, PHASE.OPEN, 'tick has not run yet');
  assert.equal(v.submit('a', ballot(v, mvp, [0, 1]), 59_999).ok, true);
  v.close([mvp.id], 59_999);
  assert.equal(v.submit('b', ballot(v, mvp, [0, 1]), 59_999).reason, 'closed');
});

test('submit catches a stale list and a stale round', () => {
  const v = fresh();
  const mvp = v.categories[0];
  v.open([mvp.id], undefined, 0);
  assert.equal(v.submit('a', { ...ballot(v, mvp, [0, 1]), listVersion: 0 }, 1).reason, 'stale_list');
  const oldRound = mvp.roundId;
  v.close([mvp.id], 2);
  v.open([mvp.id], undefined, 3);
  assert.equal(v.submit('a', { ...ballot(v, mvp, [0, 1]), roundId: oldRound }, 4).reason, 'stale_round');
});

test('reopening clears ballots; reset returns to setup without reusing a roundId', () => {
  const v = fresh();
  const mvp = v.categories[0];
  v.open([mvp.id], undefined, 0);
  v.submit('a', ballot(v, mvp, [0, 1]), 1);
  v.close([mvp.id], 2);
  const r1 = mvp.roundId;
  v.open([mvp.id], undefined, 3);
  assert.equal(mvp.ballotCount, 0);
  assert.equal(mvp.roundId, r1 + 1);
  v.reset([mvp.id]);
  assert.equal(mvp.phase, PHASE.SETUP);
  v.open([mvp.id], undefined, 4);
  assert.equal(mvp.roundId, r1 + 2);
});

test('void and restore keep counts and ballotCount consistent and bar the voter', () => {
  const v = fresh();
  const mvp = v.categories[0];
  v.open([mvp.id], undefined, 0);
  v.submit('a', ballot(v, mvp, [0, 1]), 1);
  v.submit('b', ballot(v, mvp, [0, 2]), 1);
  assert.equal(v.void(mvp.id, ['a', 'ghost']), 1);
  assert.deepEqual(mvp.counts, [1, 0, 1, 0, 0]);
  assert.equal(mvp.ballotCount, 1);
  assert.equal(v.submit('a', ballot(v, mvp, [3, 4]), 2).reason, 'voided');
  assert.equal(v.void(mvp.id, ['a']), 0, 'voiding twice is harmless');
  assert.equal(v.restore(mvp.id, ['a']), 1);
  assert.deepEqual(mvp.counts, [2, 1, 1, 0, 0]);
  assert.equal(mvp.ballotCount, 2);
  assert.deepEqual(v.voterView('a').voided, []);
});

test('feed records one +1 per newly added pick, capped', () => {
  const v = fresh();
  const mvp = v.categories[0];
  v.open([mvp.id], undefined, 0);
  v.submit('a', ballot(v, mvp, [0, 1]), 1);
  v.submit('a', ballot(v, mvp, [1, 2]), 2);
  assert.deepEqual(v.feed.map((e) => e.candidateId), [0, 1, 2]);
  for (let i = 0; i < 40; i++) v.submit(`v${i}`, ballot(v, mvp, [3, 4]), 3);
  assert.equal(v.feed.length, LIMITS.feedSize);
  assert.ok(v.feed.every((e, i, a) => i === 0 || e.seq > a[i - 1].seq));
});

test('stage: auto shows open categories, else the ones that closed together, else the lobby; pinned wins', () => {
  const v = fresh();
  const [mvp, helpful] = v.categories;
  assert.deepEqual(v.resolveStage(), []);
  v.open([mvp.id, helpful.id], 60_000, 0);
  assert.deepEqual(v.resolveStage(), [mvp.id, helpful.id]);
  v.tick(60_000); // both close in the same tick
  assert.deepEqual(v.resolveStage(), [mvp.id, helpful.id]);
  v.open([mvp.id], 60_000, 70_000);
  v.close([mvp.id], 80_000);
  assert.deepEqual(v.resolveStage(), [mvp.id], 'only the most recent close');
  v.setStage({ mode: 'pinned', categoryIds: [helpful.id] });
  assert.deepEqual(v.resolveStage(), [helpful.id]);
  assert.equal(v.setStage({ mode: 'pinned', categoryIds: [] }).ok, false);
});

test('phone-facing views never carry counts', () => {
  const v = fresh();
  const mvp = v.categories[0];
  v.open([mvp.id], undefined, 0);
  v.submit('a', ballot(v, mvp, [0, 1]), 1);
  const json = JSON.stringify([v.phoneState(), v.voterView('a')]);
  assert.doesNotMatch(json, /counts|ballotCount|votes/);
  assert.deepEqual(v.voterView('a').ballots[mvp.id], { roundId: mvp.roundId, picks: [0, 1] });
});

test('versions: votes bump version only; phases and config bump phoneVersion too', () => {
  const v = fresh();
  const mvp = v.categories[0];
  const p0 = v.phoneVersion;
  v.open([mvp.id], undefined, 0);
  assert.equal(v.phoneVersion, p0 + 1);
  const p1 = v.phoneVersion;
  const s1 = v.version;
  v.submit('a', ballot(v, mvp, [0, 1]), 1);
  assert.equal(v.phoneVersion, p1);
  assert.equal(v.version, s1 + 1);
});

// ---- final-review fixes -----------------------------------------------------

test('listVersionBase makes list versions unique per boot (a restart never reuses one)', () => {
  const a = new Vote({ names: NAMES, categories: CATS, listVersionBase: 1_700_000_000_000 });
  assert.equal(a.listVersion, 1_700_000_000_001);
  a.configure({ names: [...NAMES, 'Fábio Moura'], categories: CATS });
  assert.equal(a.listVersion, 1_700_000_000_002);
});

test('seeded is true until the first admin save', () => {
  const v = fresh();
  assert.equal(v.screenState().seeded, true);
  v.configure({ names: NAMES, categories: [{ ...CATS[0], id: v.categories[0].id, title: 'MVP 2026' }, { ...CATS[1], id: v.categories[1].id }] });
  assert.equal(v.screenState().seeded, false);
});

test('rev moves only when a category’s ballots change', () => {
  const v = fresh();
  const mvp = v.categories[0];
  v.open([mvp.id], undefined, 0);
  const r0 = mvp.rev;
  v.submit('a', ballot(v, mvp, [0, 1]), 1);
  assert.equal(mvp.rev, r0 + 1);
  v.submit('a', ballot(v, mvp, [1, 0]), 2); // identical
  assert.equal(mvp.rev, r0 + 1);
  v.reset([mvp.id]);
  assert.ok(mvp.rev > r0 + 1, 'a cleared round is a change');
});
