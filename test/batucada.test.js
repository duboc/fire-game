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
    totalRounds: 3,
    memorizeLeadInMs: 0, // most tests want exact round arithmetic; lead-in has its own test
    symbolOnMs: 100,
    symbolGapMs: 50,
    symbolOnStepMs: 0, // no speed ramp unless a test asks for one
    symbolGapStepMs: 0,
    minSymbolOnMs: 0, // the default perceptual floors would clamp these tiny test speeds
    minSymbolGapMs: 0,
    bonusAfterRound: 0, // bonus off by default in tests — it has its own suite below
    recallBaseMs: 200,
    recallPerSymbolMs: 100,
    revealMs: 50,
    nameFactory: fixedNames(),
    rng: () => 0, // every symbol is color index 0 unless a test overrides it
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

test('a miss loses the round but never the game — the player keeps playing to the end', () => {
  const g = fresh({ totalRounds: 2 });
  g.join('p1');
  g.join('p2');

  g.start({ now: 0 });
  g.tick(1000); // -> round 1 MEMORIZE
  assert.equal(g.phase, PHASE.MEMORIZE);
  assert.equal(g.round, 1);
  assert.deepEqual(g.sequence, [0]);

  g.tick(g.memorizeEndsAt); // -> RECALL
  g.recall('p1', [0], g.recallStartsAt + 10); // correct
  g.recall('p2', [3], g.recallStartsAt + 20); // wrong — costs points, nothing else

  g.tick(g.recallEndsAt); // -> REVEAL
  const p2 = g.players.get('p2');
  assert.equal(p2.cleared, 0);
  assert.equal(p2.lastCleared, false);
  assert.equal(p2.lastPrefix, 0);

  g.tick(g.revealEndsAt); // -> round 2, NOT ended: p2 is still in
  assert.equal(g.phase, PHASE.MEMORIZE);
  assert.equal(g.round, 2);

  g.tick(g.memorizeEndsAt);
  g.recall('p2', [0, 0], g.recallStartsAt + 5); // p2 clears round 2 despite missing round 1
  g.tick(g.recallEndsAt);
  assert.equal(g.players.get('p2').cleared, 1);

  g.tick(g.revealEndsAt); // round 2 was the last -> ENDED
  assert.equal(g.phase, PHASE.ENDED);
});

test('the game always runs exactly totalRounds, even if nobody ever answers', () => {
  const g = fresh({ totalRounds: 3 });
  g.join('p1');
  g.start({ now: 0 });

  let now = 1000;
  for (let round = 1; round <= 3; round++) {
    g.tick(now); // MEMORIZE
    assert.equal(g.phase, PHASE.MEMORIZE);
    assert.equal(g.round, round);
    g.tick(g.memorizeEndsAt); // RECALL — nobody submits
    g.tick(g.recallEndsAt); // REVEAL
    now = g.revealEndsAt;
    g.tick(now); // next round or ENDED
  }
  assert.equal(g.phase, PHASE.ENDED);
  assert.equal(g.players.get('p1').cleared, 0);
});

test('score accumulates: full match bumps cleared and symbols, partial match banks the prefix', () => {
  const g = fresh({ totalRounds: 2 });
  g.join('p1');
  g.start({ now: 0 });

  g.tick(1000);
  g.tick(g.memorizeEndsAt);
  g.recall('p1', [0], g.recallStartsAt + 10); // round 1 (1 symbol): cleared
  g.tick(g.recallEndsAt);
  let p1 = g.players.get('p1');
  assert.equal(p1.cleared, 1);
  assert.equal(p1.symbols, 1);

  g.tick(g.revealEndsAt); // round 2 (2 symbols)
  g.tick(g.memorizeEndsAt);
  g.recall('p1', [0, 3], g.recallStartsAt + 10); // first right, second wrong
  g.tick(g.recallEndsAt);
  p1 = g.players.get('p1');
  assert.equal(p1.cleared, 1, 'a partial match does not count as a cleared round');
  assert.equal(p1.symbols, 2, 'but the matched prefix still banks a point');
});

test('a second /recall for the same player/round does not overwrite the first', () => {
  const g = fresh();
  g.join('p1');
  g.start({ now: 0 });
  g.tick(g.startsAt);
  g.tick(g.memorizeEndsAt);

  g.recall('p1', [0], g.recallStartsAt + 10);
  g.recall('p1', [3], g.recallStartsAt + 20); // ignored: already submitted

  g.tick(g.recallEndsAt);
  const p1 = g.players.get('p1');
  assert.equal(p1.cleared, 1);
  assert.equal(p1.elapsedTotalMs, 10);
});

test('never answering costs the full recall window on the elapsed tiebreak', () => {
  const g = fresh({ totalRounds: 1 });
  g.join('a');
  g.join('b');
  g.start({ now: 0 });
  g.tick(g.startsAt);
  g.tick(g.memorizeEndsAt);

  g.recall('a', [0], g.recallStartsAt + 10); // b never answers

  g.tick(g.recallEndsAt);
  const b = g.players.get('b');
  assert.equal(b.lastPrefix, 0);
  assert.equal(b.elapsedTotalMs, g.recallEndsAt - g.recallStartsAt);
});

test('joining mid-game just starts scoring from the current round — no spectator state', () => {
  const g = fresh({ totalRounds: 2 });
  g.join('p1');
  g.start({ now: 0 });
  g.tick(1000); // round 1 MEMORIZE

  const late = g.join('latecomer');
  assert.ok(late.seq > 0);
  g.tick(g.memorizeEndsAt); // RECALL
  const view = g.recall('latecomer', [0], g.recallStartsAt + 10);
  assert.equal(view.known, true);
  g.tick(g.recallEndsAt);
  assert.equal(g.players.get('latecomer').cleared, 1, 'a latecomer can clear the round they walked into');
});

test('difficulty ramps: the flash gets faster each round, clamped at the floor', () => {
  const g = fresh({
    totalRounds: 10,
    symbolOnMs: 900, symbolGapMs: 500,
    symbolOnStepMs: 100, symbolGapStepMs: 50,
    minSymbolOnMs: 450, minSymbolGapMs: 250,
  });
  assert.equal(g.symbolOnFor(1), 900);
  assert.equal(g.symbolGapFor(1), 500);
  assert.equal(g.symbolOnFor(3), 700);
  assert.equal(g.symbolGapFor(3), 400);
  assert.equal(g.symbolOnFor(10), 450, 'clamped, not 0');
  assert.equal(g.symbolGapFor(10), 250, 'clamped, not 50');

  // The round windows are built from the effective speeds, and publicState
  // reports them so the screen animates at the same pace the server timed.
  g.join('p1');
  g.start({ now: 0 });
  g.tick(g.startsAt);
  assert.equal(g.memorizeEndsAt - g.memorizeStartsAt, 1 * (900 + 500));
  const pub = g.publicState(g.startsAt);
  assert.equal(pub.symbolOnMs, 900);
  assert.equal(pub.symbolGapMs, 500);
});

test('final ranking tiebreaks cleared desc, then symbols desc, then total elapsed asc, then seq asc', () => {
  const g = fresh();
  g.join('a');
  g.join('b');
  g.join('c');
  g.join('d');
  const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((id) => g.players.get(id));
  Object.assign(a, { cleared: 3, symbols: 12, elapsedTotalMs: 500 });
  Object.assign(b, { cleared: 3, symbols: 12, elapsedTotalMs: 300 }); // same as a, faster
  Object.assign(c, { cleared: 3, symbols: 10, elapsedTotalMs: 100 }); // fewer symbols banked
  Object.assign(d, { cleared: 2, symbols: 20, elapsedTotalMs: 1 }); // fewer rounds cleared, loses regardless

  assert.deepEqual(g.results().map((r) => r.id), ['b', 'a', 'c', 'd']);
});

test('playerView reports yourRank once ENDED and the per-round result for the phone', () => {
  const g = fresh({ totalRounds: 1 });
  g.join('a');
  g.join('b');
  g.start({ now: 0 });
  g.tick(g.startsAt);
  g.tick(g.memorizeEndsAt);

  g.recall('a', [0], g.recallStartsAt + 50);
  g.recall('b', [0], g.recallStartsAt + 10); // faster

  g.tick(g.recallEndsAt); // -> REVEAL
  const midView = g.playerView('a', g.recallEndsAt);
  assert.equal(midView.lastCleared, true);
  assert.equal(midView.cleared, 1);

  g.tick(g.revealEndsAt); // -> ENDED
  assert.equal(g.phase, PHASE.ENDED);
  assert.equal(g.playerView('b', g.revealEndsAt).yourRank, 1);
  assert.equal(g.playerView('a', g.revealEndsAt).yourRank, 2);
});

test('default ramp lands on a floor the eye can still follow', () => {
  const g = new Batucada({ nameFactory: fixedNames() });
  assert.equal(g.totalRounds, 12);
  assert.equal(g.symbolOnFor(1), 1200);
  assert.equal(g.symbolGapFor(1), 700);
  assert.equal(g.symbolOnFor(12), 750, 'even round 12 stays comfortably readable');
  assert.equal(g.symbolGapFor(12), 450);
  assert.ok(g.memorizeLeadInMs >= 1000, 'a breath before the first flash, or the phase transition eats it');
  assert.ok(g.revealMs >= 4000, 'the reveal carries spotlights and standings — it must be readable, not a flash');
});

test('the lead-in delays the first flash and is published so the screen can offset its animation', () => {
  const g = fresh({ memorizeLeadInMs: 1000 });
  g.join('p1');
  g.start({ now: 0 });
  g.tick(1000); // -> round 1 MEMORIZE
  // 1000 lead-in + 1 symbol * (100 on + 50 gap)
  assert.equal(g.memorizeEndsAt - g.memorizeStartsAt, 1000 + 150);
  const pub = g.publicState(1000);
  assert.equal(pub.memorizeLeadInMs, 1000);
  assert.equal(g.playerView('p1', 1000).memorizeLeadInMs, 1000);
});

test('all answers in → the round closes early, no dead air', () => {
  const g = fresh({ totalRounds: 2 });
  g.join('a');
  g.join('b');
  g.start({ now: 0 });
  g.tick(1000);
  g.tick(g.memorizeEndsAt);
  g.recall('a', [0], g.recallStartsAt + 10);
  g.recall('b', [0], g.recallStartsAt + 20);

  const early = g.recallStartsAt + 30; // way before recallEndsAt
  assert.ok(early < g.recallEndsAt);
  g.tick(early);
  assert.equal(g.phase, PHASE.REVEAL, 'everyone answered — no reason to sit out the window');
  assert.equal(g.revealEndsAt, early + 50);
});

function freshWithBonus(opts = {}) {
  return fresh({
    totalRounds: 2,
    bonusAfterRound: 1,
    bonusArmMinMs: 100,
    bonusArmJitterMs: 0,
    bonusHitWindowMs: 1000,
    bonusMaxPts: 10,
    ...opts,
  });
}

/** Plays round 1 (both players clear it) and advances into BONUS_ARM. */
function playIntoBonus(g) {
  g.start({ now: 0 });
  g.tick(1000);
  g.tick(g.memorizeEndsAt);
  g.recall('a', [0], g.recallStartsAt + 10);
  g.recall('b', [0], g.recallStartsAt + 20);
  g.tick(g.recallEndsAt);
  g.tick(g.revealEndsAt);
  assert.equal(g.phase, PHASE.BONUS_ARM);
}

test('the bonus round arms after the configured round, hides its color, then flashes it', () => {
  const g = freshWithBonus();
  g.join('a');
  g.join('b');
  playIntoBonus(g);

  const armPub = g.publicState(g.revealEndsAt);
  assert.ok(!('bonusColor' in armPub) || armPub.bonusColor == null,
    'the color must not leak while everyone is waiting for it');

  g.tick(g.bonusArmEndsAt);
  assert.equal(g.phase, PHASE.BONUS_HIT);
  const hitPub = g.publicState(g.bonusArmEndsAt);
  assert.equal(hitPub.bonusColor, 0, 'rng()=>0 pins the bonus color');
});

test('bonus scoring: fast correct tap earns speed-scaled points into symbols, never into cleared', () => {
  const g = freshWithBonus();
  g.join('a');
  g.join('b');
  playIntoBonus(g);
  g.tick(g.bonusArmEndsAt); // -> BONUS_HIT

  g.recall('a', [0], g.bonusHitStartsAt + 100); // correct, 10% into the window
  const a = g.players.get('a');
  assert.equal(a.lastBonusOutcome, 'hit');
  assert.equal(a.lastBonusPts, 9); // round(10 * 0.9)
  assert.equal(a.symbols, 1 + 9, 'round-1 symbol plus the bonus');
  assert.equal(a.cleared, 1, 'the bonus never counts as a cleared round');

  g.recall('b', [1], g.bonusHitStartsAt + 100); // wrong color
  assert.equal(g.players.get('b').lastBonusOutcome, 'wrong');
  assert.equal(g.players.get('b').lastBonusPts, 0);

  g.tick(g.bonusHitStartsAt + 200); // both answered -> early close into REVEAL
  assert.equal(g.phase, PHASE.REVEAL);
  const pub = g.publicState(g.bonusHitStartsAt + 200);
  assert.equal(pub.bonusReveal, true);
  assert.equal(pub.roundClearedCount, 1, 'one reflex hit');
  const phoneView = g.playerView('a', g.bonusHitStartsAt + 200);
  assert.equal(phoneView.bonusReveal, true,
    'the phone must know this reveal is the bonus, or it renders the memory-round card');

  g.tick(g.revealEndsAt); // -> round 2, the game resumes where it left off
  assert.equal(g.phase, PHASE.MEMORIZE);
  assert.equal(g.round, 2);
});

test('the flash still gets its own tick even if everyone already burned during the suspense', () => {
  // If ARM -> HIT -> REVEAL collapse into a single _advance() call, the color
  // is never broadcast: the screen would jump straight from suspense to the
  // reveal, having never shown what the room was supposed to react to.
  const g = freshWithBonus();
  g.join('a');
  g.join('b');
  playIntoBonus(g);

  g.recall('a', [0], g.revealEndsAt + 10); // both jump the gun during ARM
  g.recall('b', [0], g.revealEndsAt + 20);

  g.tick(g.bonusArmEndsAt); // everyone is already "submitted" the instant HIT could open
  assert.equal(g.phase, PHASE.BONUS_HIT, 'the flash phase must be observable for at least one tick');
  assert.equal(g.publicState(g.bonusArmEndsAt).bonusColor, g.bonusColor,
    'and the color must be published on that tick — the whole point of showing it');

  g.tick(g.bonusArmEndsAt + 1); // now it's allowed to close
  assert.equal(g.phase, PHASE.REVEAL);
});

test('tapping during the suspense burns the start — locked out with zero points', () => {
  const g = freshWithBonus();
  g.join('a');
  g.join('b');
  playIntoBonus(g);

  g.recall('b', [0], g.revealEndsAt + 10); // jumped the gun during ARM
  const b = g.players.get('b');
  assert.equal(b.lastBonusOutcome, 'early');
  assert.equal(b.lastBonusPts, 0);

  g.tick(g.bonusArmEndsAt); // -> BONUS_HIT
  g.recall('b', [0], g.bonusHitStartsAt + 50); // locked: the burn was final
  assert.equal(g.players.get('b').lastBonusOutcome, 'early');
  assert.equal(g.players.get('b').symbols, 1, 'still only the round-1 symbol');
});

test('never tapping the bonus scores nothing and the game moves on', () => {
  const g = freshWithBonus();
  g.join('a');
  playIntoBonus(g);
  g.tick(g.bonusArmEndsAt);
  g.tick(g.bonusHitEndsAt); // window expires untouched
  assert.equal(g.phase, PHASE.REVEAL);
  assert.equal(g.players.get('a').lastBonusOutcome, 'none');
  assert.equal(g.publicState(g.bonusHitEndsAt).roundClearedCount, 0);
});

test('bonusAfterRound 0 disables the bonus entirely', () => {
  const g = freshWithBonus({ bonusAfterRound: 0 });
  g.join('a');
  g.start({ now: 0 });
  g.tick(1000);
  g.tick(g.memorizeEndsAt);
  g.recall('a', [0], g.recallStartsAt + 10);
  g.tick(g.recallEndsAt);
  g.tick(g.revealEndsAt);
  assert.equal(g.phase, PHASE.MEMORIZE, 'straight into round 2, no bonus');
  assert.equal(g.round, 2);
});

test('a new game re-arms the bonus', () => {
  const g = freshWithBonus();
  g.join('a');
  playIntoBonus(g);
  assert.equal(g.bonusPlayed, true);
  g.start({ now: 99000 });
  assert.equal(g.bonusPlayed, false);
});

test('submittedCount pulses up as answers land and resets each round', () => {
  const g = fresh({ totalRounds: 2 });
  g.join('a');
  g.join('b');
  g.join('c');
  g.start({ now: 0 });
  g.tick(1000);
  g.tick(g.memorizeEndsAt);
  assert.equal(g.publicState(g.recallStartsAt).submittedCount, 0);

  g.recall('a', [0], g.recallStartsAt + 10);
  assert.equal(g.publicState(g.recallStartsAt + 10).submittedCount, 1);
  g.recall('b', [3], g.recallStartsAt + 20);
  assert.equal(g.publicState(g.recallStartsAt + 20).submittedCount, 2);

  g.tick(g.recallEndsAt); // c timed out — graded, so everyone counts
  assert.equal(g.publicState(g.recallEndsAt).submittedCount, 3);

  g.tick(g.revealEndsAt); // round 2 wipes the pulse
  assert.equal(g.publicState(g.revealEndsAt).submittedCount, 0);
});

test('the spotlight names the fastest correct answer and the longest streak, during REVEAL only', () => {
  const g = fresh({ totalRounds: 3 });
  g.join('a');
  g.join('b');
  g.start({ now: 0 });

  // round 1: both clear, b faster
  g.tick(1000);
  g.tick(g.memorizeEndsAt);
  g.recall('a', [0], g.recallStartsAt + 400);
  g.recall('b', [0], g.recallStartsAt + 150);
  g.tick(g.recallEndsAt);
  let spot = g.publicState(g.recallEndsAt).spotlight;
  assert.equal(spot.fastest.seq, g.players.get('b').seq);
  assert.equal(spot.fastest.ms, 150);
  assert.equal(spot.bestStreak, null, 'a 1-round streak is not news');

  // round 2: only a clears — b's streak dies, a's reaches 2
  g.tick(g.revealEndsAt);
  g.tick(g.memorizeEndsAt);
  g.recall('a', [0, 0], g.recallStartsAt + 500);
  g.recall('b', [1, 1], g.recallStartsAt + 100);
  g.tick(g.recallEndsAt);
  spot = g.publicState(g.recallEndsAt).spotlight;
  assert.equal(spot.fastest.seq, g.players.get('a').seq, 'fastest counts only correct answers');
  assert.equal(spot.bestStreak.seq, g.players.get('a').seq);
  assert.equal(spot.bestStreak.n, 2);
  assert.equal(g.players.get('b').streak, 0);

  // outside REVEAL there is no spotlight
  g.tick(g.revealEndsAt);
  assert.equal(g.publicState(g.revealEndsAt).spotlight, null);
});

test('the spotlight crowns the round\'s biggest climber — someone who cleared and jumped the standings', () => {
  const g = fresh({ totalRounds: 3 });
  g.join('a');
  g.join('b');
  g.join('c');

  g.start({ now: 0 });

  // round 1: a and b clear, c misses -> c sits last
  g.tick(1000);
  g.tick(g.memorizeEndsAt);
  g.recall('a', [0], g.recallStartsAt + 10);
  g.recall('b', [0], g.recallStartsAt + 20);
  g.recall('c', [1], g.recallStartsAt + 30);
  g.tick(g.recallEndsAt);
  assert.equal(g.publicState(g.recallEndsAt).spotlight.climber, null,
    'nobody climbed in round 1 — the order only settled');

  // round 2: only c clears -> c leaps over at least one of them
  g.tick(g.revealEndsAt);
  g.tick(g.memorizeEndsAt);
  g.recall('a', [1, 1], g.recallStartsAt + 10);
  g.recall('b', [1, 1], g.recallStartsAt + 20);
  g.recall('c', [0, 0], g.recallStartsAt + 30);
  g.tick(g.recallEndsAt);
  const climber = g.publicState(g.recallEndsAt).spotlight.climber;
  assert.equal(climber.seq, g.players.get('c').seq);
  assert.ok(climber.up >= 1);
});

test('the bonus reveal spotlights the fastest reflex', () => {
  const g = freshWithBonus();
  g.join('a');
  g.join('b');
  playIntoBonus(g);
  g.tick(g.bonusArmEndsAt);
  g.recall('a', [0], g.bonusHitStartsAt + 300);
  g.recall('b', [0], g.bonusHitStartsAt + 120);
  g.tick(g.bonusHitStartsAt + 400);
  const spot = g.publicState(g.bonusHitStartsAt + 400).spotlight;
  assert.equal(spot.fastest.seq, g.players.get('b').seq);
  assert.equal(spot.fastest.ms, 120);
});

test('the host can pick the round count per game; reset restores the default', () => {
  const g = fresh({ totalRounds: 12 });
  g.join('p1');
  g.start({ now: 0, totalRounds: 6 });
  assert.equal(g.totalRounds, 6);
  assert.equal(g.publicState(0).totalRounds, 6);

  // a nonsense ask falls back to the configured default, an absurd one clamps
  g.start({ now: 0, totalRounds: NaN });
  assert.equal(g.totalRounds, 12);
  g.start({ now: 0, totalRounds: 999 });
  assert.equal(g.totalRounds, 30);
  g.start({ now: 0, totalRounds: -3 });
  assert.equal(g.totalRounds, 12);

  g.start({ now: 0, totalRounds: 6 });
  g.reset({ now: 0 });
  assert.equal(g.totalRounds, 12, 'reset forgets the per-game override');
});

test('unless pinned, the bonus lands mid-game whatever the round count', () => {
  // bonusAfterRound omitted entirely -> auto (the default)
  const g = new Batucada({
    countdownMs: 1000,
    memorizeLeadInMs: 0,
    symbolOnMs: 100, symbolGapMs: 50, symbolOnStepMs: 0, symbolGapStepMs: 0,
    minSymbolOnMs: 0, minSymbolGapMs: 0,
    recallBaseMs: 200, recallPerSymbolMs: 100, revealMs: 50,
    bonusArmMinMs: 100, bonusArmJitterMs: 0,
    nameFactory: fixedNames(), rng: () => 0,
  });
  g.join('a');
  g.start({ now: 0, totalRounds: 4 }); // auto: bonus after round floor(4/2) = 2

  let now = 1000;
  for (let round = 1; round <= 2; round++) {
    g.tick(now);
    assert.equal(g.round, round);
    g.tick(g.memorizeEndsAt);
    g.recall('a', [0].concat(Array(round - 1).fill(0)), g.recallStartsAt + 10);
    g.tick(g.recallEndsAt);
    now = g.revealEndsAt;
    g.tick(now);
  }
  assert.equal(g.phase, PHASE.BONUS_ARM, 'a 4-round game gets its surprise after round 2');
});

test('reset clears the roster and returns to LOBBY', () => {
  const g = fresh();
  g.join('p1');
  g.start({ now: 0 });
  g.reset({ now: 5000 });
  assert.equal(g.phase, PHASE.LOBBY);
  assert.equal(g.players.size, 0);
});

test('default rng produces sequences of valid color indices', () => {
  const g = new Batucada({ countdownMs: 0, nameFactory: fixedNames() });
  g.join('p1');
  g.start({ now: 0 });
  g.tick(0); // countdown is 0ms: round 1 MEMORIZE starts immediately
  assert.equal(g.sequence.length, 1);
  assert.ok(g.sequence[0] >= 0 && g.sequence[0] < g.symbols.length);
});
