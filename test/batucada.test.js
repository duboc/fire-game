import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Batucada, PHASE } from '../src/batucada.js';

// Deterministic name factory for stable assertions (same shape as game.test.js).
const fixedNames = () => {
  let i = 0;
  const list = ['Alfa', 'Bravo', 'Charlie', 'Delta'];
  return () => {
    const name = list[i % list.length];
    i += 1;
    return { name, emoji: '⭐', seq: i, label: `${name} #${i}` };
  };
};

function fresh(opts = {}) {
  return new Batucada({
    countdownMs: 1000,
    symbolOnMs: 100,
    symbolGapMs: 50,
    recallBaseMs: 200,
    recallPerSymbolMs: 100,
    revealMs: 50,
    nameFactory: fixedNames(),
    rng: () => 0, // every symbol is instrument index 0 unless a test overrides it
    ...opts,
  });
}

test('join issues stable identity and is idempotent per id', () => {
  const g = fresh();
  const a = g.join('id-1');
  assert.equal(a.seq, 1);
  const again = g.join('id-1');
  assert.equal(again.seq, 1);
  assert.equal(g.players.size, 1);
});

test('joining after COUNTDOWN makes a spectator immediately, never injected into the round in progress', () => {
  const g = fresh();
  g.join('p1');
  g.start({ now: 0 });
  g.tick(g.startsAt); // -> MEMORIZE round 1
  assert.equal(g.phase, PHASE.MEMORIZE);

  g.join('latecomer');
  const p = g.players.get('latecomer');
  assert.equal(p.alive, false);
  assert.equal(p.roundsCleared, 0);
});

test('phase machine advances through rounds, sequence length grows, and the game ends at aliveCount <= 1', () => {
  const g = fresh();
  g.join('p1');
  g.join('p2');

  g.start({ now: 0 });
  assert.equal(g.phase, PHASE.COUNTDOWN);
  assert.equal(g.startsAt, 1000);

  g.tick(999);
  assert.equal(g.phase, PHASE.COUNTDOWN);

  g.tick(1000); // -> round 1 MEMORIZE
  assert.equal(g.phase, PHASE.MEMORIZE);
  assert.equal(g.round, 1);
  assert.deepEqual(g.sequence, [0]);
  assert.equal(g.memorizeEndsAt, 1150); // 1000 + 1*(100+50)
  assert.equal(g.recallEndsAt, 1450); // memorizeEndsAt + 200 + 1*100

  g.tick(1150); // -> RECALL
  assert.equal(g.phase, PHASE.RECALL);
  g.recall('p1', [0], 1200); // correct: clears round 1
  g.recall('p2', [0], 1210); // also correct: both survive to round 2

  g.tick(1450); // RECALL ends -> REVEAL
  assert.equal(g.phase, PHASE.REVEAL);
  assert.equal(g.revealEndsAt, 1500);

  g.tick(1500); // REVEAL ends, both alive -> round 2 MEMORIZE
  assert.equal(g.phase, PHASE.MEMORIZE);
  assert.equal(g.round, 2);
  assert.deepEqual(g.sequence, [0, 0]);
  assert.equal(g.memorizeEndsAt, 1800); // 1500 + 2*150
  assert.equal(g.recallEndsAt, 2200); // memorizeEndsAt + 200 + 2*100

  g.tick(1800); // -> RECALL
  g.recall('p1', [0, 0], 1850); // correct
  g.recall('p2', [0, 1], 1860); // wrong second symbol: eliminated, prefixMatched 1

  g.tick(2200); // -> REVEAL
  const p2 = g.players.get('p2');
  assert.equal(p2.alive, false);
  assert.equal(p2.eliminatedRound, 2);
  assert.equal(p2.prefixMatched, 1);

  g.tick(2250); // REVEAL ends (revealEndsAt = 2200+50); aliveCount 1 -> ENDED
  assert.equal(g.phase, PHASE.ENDED);
  assert.equal(g.winner.id, 'p1');
  assert.equal(g.players.get('p1').roundsCleared, 2);
});

test('a second /recall for the same player/round does not overwrite the first', () => {
  const g = fresh();
  g.join('p1');
  g.start({ now: 0 });
  g.tick(g.startsAt);
  g.tick(g.memorizeEndsAt);

  g.recall('p1', [0], g.recallStartsAt + 10);
  g.recall('p1', [9], g.recallStartsAt + 20); // ignored: already submitted

  const p1 = g.players.get('p1');
  assert.equal(p1.roundsCleared, 1);
  assert.equal(p1.elapsedMs, 10);
});

test('a player who never submits is eliminated with prefixMatched 0 when RECALL ends', () => {
  const g = fresh();
  g.join('p1');
  g.join('p2');
  g.start({ now: 0 });
  g.tick(g.startsAt);
  g.tick(g.memorizeEndsAt);

  g.recall('p1', [0], g.recallStartsAt + 10); // p2 never answers

  g.tick(g.recallEndsAt);
  const p2 = g.players.get('p2');
  assert.equal(p2.alive, false);
  assert.equal(p2.prefixMatched, 0);
  assert.equal(p2.eliminatedRound, 1);
});

test('hitting maxRounds ends the game even with multiple perfect survivors, ranked by elapsedMs', () => {
  const g = fresh({ maxRounds: 1 });
  g.join('a');
  g.join('b');
  g.start({ now: 0 });
  g.tick(g.startsAt);
  g.tick(g.memorizeEndsAt);

  g.recall('a', [0], g.recallStartsAt + 50);
  g.recall('b', [0], g.recallStartsAt + 10); // faster

  g.tick(g.recallEndsAt); // -> REVEAL
  g.tick(g.revealEndsAt); // round >= maxRounds -> ENDED despite both alive

  assert.equal(g.phase, PHASE.ENDED);
  assert.deepEqual(g.results().map((r) => r.id), ['b', 'a']);
});

test('final ranking tiebreaks roundsCleared desc, then prefixMatched desc, then elapsedMs asc, then seq asc', () => {
  const g = fresh();
  g.join('a');
  g.join('b');
  g.join('c');
  g.join('d');
  const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((id) => g.players.get(id));
  Object.assign(a, { alive: false, roundsCleared: 3, prefixMatched: 2, elapsedMs: 500 });
  Object.assign(b, { alive: false, roundsCleared: 3, prefixMatched: 2, elapsedMs: 300 }); // same as a, faster
  Object.assign(c, { alive: false, roundsCleared: 3, prefixMatched: 1, elapsedMs: 100 }); // matched fewer symbols
  Object.assign(d, { alive: false, roundsCleared: 2, prefixMatched: 5, elapsedMs: 1 }); // fewer rounds cleared, loses regardless

  assert.deepEqual(g.results().map((r) => r.id), ['b', 'a', 'c', 'd']);
});

test('playerView reports yourRank once ENDED, and publicState exposes the per-symbol timing the screen needs to animate', () => {
  const g = fresh({ maxRounds: 1 });
  g.join('a');
  g.join('b');
  g.start({ now: 0 });
  g.tick(g.startsAt); // -> MEMORIZE round 1

  const pub = g.publicState(g.startsAt);
  assert.equal(pub.memorizeStartsAt, g.startsAt);
  assert.equal(pub.symbolOnMs, 100);
  assert.equal(pub.symbolGapMs, 50);

  g.tick(g.memorizeEndsAt);
  g.recall('a', [0], g.recallStartsAt + 50);
  g.recall('b', [0], g.recallStartsAt + 10); // faster: ranks first on the maxRounds tiebreak

  g.tick(g.recallEndsAt);
  g.tick(g.revealEndsAt); // -> ENDED (maxRounds: 1)

  assert.equal(g.playerView('b', g.revealEndsAt).yourRank, 1);
  assert.equal(g.playerView('a', g.revealEndsAt).yourRank, 2);
});

test('reset clears the roster and returns to LOBBY', () => {
  const g = fresh();
  g.join('p1');
  g.start({ now: 0 });
  g.reset({ now: 5000 });
  assert.equal(g.phase, PHASE.LOBBY);
  assert.equal(g.players.size, 0);
});

test('default rng produces sequences of valid instrument indices', () => {
  const g = new Batucada({ countdownMs: 0, nameFactory: fixedNames() });
  g.join('p1');
  g.start({ now: 0 });
  g.tick(0); // countdown is 0ms: round 1 MEMORIZE starts immediately
  assert.equal(g.sequence.length, 1);
  assert.ok(g.sequence[0] >= 0 && g.sequence[0] < g.instruments.length);
});
