import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, PHASE } from '../src/game.js';

// Deterministic name factory for stable assertions.
const fixedNames = () => {
  let i = 0;
  const list = ['Alfa', 'Bravo', 'Charlie', 'Delta', 'Echo'];
  return () => {
    const name = list[i % list.length];
    i += 1;
    return { name, emoji: '⭐', seq: i, label: `${name} #${i}` };
  };
};

function freshGame(opts = {}) {
  return new Game({ countdownMs: 3000, durationMs: 10000, nameFactory: fixedNames(), ...opts });
}

test('join issues stable identity and is idempotent per id', () => {
  const g = freshGame();
  const a = g.join('id-1');
  assert.equal(a.seq, 1);
  const again = g.join('id-1');
  assert.equal(again.seq, 1); // same player, no new identity
  assert.equal(g.players.size, 1);
});

test('taps only count while RUNNING and before endsAt', () => {
  const g = freshGame();
  g.join('p1');
  let now = 0;

  // lobby: ignored
  g.tap('p1', 5, now);
  assert.equal(g.players.get('p1').count, 0);

  // start -> countdown
  g.start({ durationMs: 10000, now });
  assert.equal(g.phase, PHASE.COUNTDOWN);
  g.tap('p1', 5, now + 1000); // still countdown
  assert.equal(g.players.get('p1').count, 0);

  // running
  g.tap('p1', 7, now + 3500);
  assert.equal(g.phase, PHASE.RUNNING);
  assert.equal(g.players.get('p1').count, 7);

  // after endsAt -> ended, no more counting
  g.tap('p1', 9, now + 13001);
  assert.equal(g.phase, PHASE.ENDED);
  assert.equal(g.players.get('p1').count, 7);
});

test('batch is clamped to maxTapsPerBatch (anti-accident)', () => {
  const g = freshGame({ maxTapsPerBatch: 100 });
  g.join('p1');
  g.start({ now: 0 });
  g.tap('p1', 1e9, 3500); // absurd batch (retry storm / bug)
  assert.equal(g.players.get('p1').count, 100);
});

test('negative / NaN / non-numeric taps are ignored', () => {
  const g = freshGame();
  g.join('p1');
  g.start({ now: 0 });
  g.tap('p1', -50, 3500);
  g.tap('p1', NaN, 3500);
  g.tap('p1', 'abc', 3500);
  assert.equal(g.players.get('p1').count, 0);
});

test('ranking is by count desc, ties broken by join order', () => {
  const g = freshGame();
  g.join('a'); g.join('b'); g.join('c');
  g.start({ now: 0 });
  g.tap('a', 10, 3500);
  g.tap('b', 10, 3500); // tie with a, but a joined first
  g.tap('c', 20, 3500);
  g.tick(3600);
  assert.equal(g.ranks.get('c'), 1);
  assert.equal(g.ranks.get('a'), 2); // earlier seq wins the tie
  assert.equal(g.ranks.get('b'), 3);
  assert.equal(g.top[0].id, 'c');
});

test('playerView reports rank, count and total', () => {
  const g = freshGame();
  g.join('a'); g.join('b');
  g.start({ now: 0 });
  g.tap('a', 5, 3500);
  const view = g.tap('b', 9, 3500);
  // count + total are immediate; rank comes from the 100ms snapshot (decoupled
  // from tap for O(1) responses), so refresh it the way the server loop does.
  assert.equal(view.total, 2);
  assert.equal(view.yourCount, 9);
  assert.equal(view.phase, PHASE.RUNNING);
  g.tick(3500);
  assert.equal(g.playerView('b', 3500).yourRank, 1);
  assert.equal(g.playerView('a', 3500).yourRank, 2);
});

test('start zeroes counts for a new round and increments roundId', () => {
  const g = freshGame();
  g.join('a');
  g.start({ now: 0 });
  g.tap('a', 50, 3500);
  assert.equal(g.players.get('a').count, 50);
  const r1 = g.roundId;
  g.start({ now: 100000 });
  assert.equal(g.players.get('a').count, 0);
  assert.equal(g.roundId, r1 + 1);
  assert.equal(g.totalTaps, 0);
});

test('onEnded fires exactly once with results', () => {
  let calls = 0; let captured = null;
  const g = freshGame({ onEnded: (r) => { calls++; captured = r; } });
  g.join('a');
  g.start({ durationMs: 5000, now: 0 });
  g.tap('a', 30, 3500);
  g.tick(8001); // crosses endsAt
  g.tick(8500); // should NOT fire again
  g.tick(9000);
  assert.equal(calls, 1);
  assert.equal(captured.winner.name, 'Alfa');
  assert.equal(captured.winner.count, 30);
  assert.equal(captured.totalPlayers, 1);
});

test('unknown id tap returns null (server then re-joins)', () => {
  const g = freshGame();
  g.start({ now: 0 });
  assert.equal(g.tap('ghost', 5, 3500), null);
});

test('reset returns to lobby keeping players but zeroing counts', () => {
  const g = freshGame();
  g.join('a');
  g.start({ now: 0 });
  g.tap('a', 12, 3500);
  g.reset({ now: 4000 });
  assert.equal(g.phase, PHASE.LOBBY);
  assert.equal(g.players.size, 1);
  assert.equal(g.players.get('a').count, 0);
  assert.equal(g.winner, null);
});

test('countdown -> running transition is driven purely by now', () => {
  const g = freshGame();
  g.join('a');
  g.start({ now: 1000 }); // startsAt = 4000
  assert.equal(g.tick(3999).phase, PHASE.COUNTDOWN);
  assert.equal(g.tick(4000).phase, PHASE.RUNNING);
});
