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

test('taps only count while RUNNING and before endsAt (grace disabled)', () => {
  const g = freshGame({ graceMs: 0 });
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

test('grace window credits taps that left the phone before the buzzer', () => {
  const g = freshGame({ graceMs: 1500 }); // endsAt 13000, settlesAt 14500
  g.join('p1');
  g.start({ now: 0 });
  g.tap('p1', 7, 3500);

  // The round is over, but a batch already in flight from a distant phone lands.
  g.tap('p1', 9, 13001);
  assert.equal(g.phase, PHASE.ENDED);
  assert.equal(g.players.get('p1').count, 16);

  // Once the window closes it is genuinely too late.
  g.tap('p1', 5, 14500);
  assert.equal(g.players.get('p1').count, 16);
});

test('the champion is decided when the grace window closes, not at the buzzer', () => {
  let calls = 0;
  const g = freshGame({ graceMs: 1500, onEnded: () => { calls += 1; } });
  g.join('a'); g.join('b');
  g.start({ durationMs: 5000, now: 0 }); // startsAt 3000, endsAt 8000, settlesAt 9500
  g.tap('a', 30, 3500);
  g.tap('b', 10, 3500);

  g.tick(8000);
  assert.equal(g.phase, PHASE.ENDED);
  assert.equal(g.settled, false);
  assert.equal(g.winner, null, 'no champion while taps may still arrive');
  assert.equal(calls, 0, 'results must not be persisted mid-settle');

  // b's final batch was tapped before the buzzer but arrives late — it counts,
  // and it takes the lead. Deferring the reveal is what keeps that invisible.
  g.tap('b', 25, 8600);
  g.tick(9000);
  assert.equal(g.winner, null);

  g.tick(9500);
  assert.equal(g.settled, true);
  assert.equal(g.winner.id, 'b');
  assert.equal(g.winner.count, 35);
  assert.equal(calls, 1);
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
  assert.equal(g.players.get('c').rank, 1);
  assert.equal(g.players.get('a').rank, 2); // earlier seq wins the tie
  assert.equal(g.players.get('b').rank, 3);
  assert.equal(g.top[0].id, 'c');
});

test('_recount is skipped when nothing changed, and never skipped when it did', () => {
  const g = freshGame();
  g.join('a'); g.join('b');
  g.start({ now: 0 });
  g.tick(3500);

  // Instrument after the state has settled into a known-clean snapshot.
  let recounts = 0;
  const real = g._recount.bind(g);
  g._recount = () => { if (g._dirty) recounts += 1; real(); };

  g.tick(3600); g.tick(3700); g.tick(3800);
  assert.equal(recounts, 0, 'idle ticks must not re-sort every player');

  // A tap, a join and a reset each have to invalidate the snapshot.
  g.tap('b', 7, 3900);
  g.tick(4000);
  assert.equal(recounts, 1);
  assert.equal(g.players.get('b').rank, 1, 'ranks must reflect the tap, not a stale snapshot');

  g.join('c');
  g.tick(4100);
  assert.equal(recounts, 2);
  assert.equal(g.players.get('c').rank, 3);

  g.reset({ now: 4200 });
  assert.equal(recounts, 3);
});

test('the grace window is sized to drain one final flush per player', () => {
  // Small room: the herd is trivial, so the window stays at its floor and
  // behaves exactly as it did before it was made adaptive.
  const small = freshGame();
  small.join('a'); small.join('b');
  small.start({ now: 0 });
  assert.equal(small.graceMs, 1500);
  assert.equal(small.settlesAt, small.endsAt + 1500);

  // Event: 5.000 phones each flush once at the buzzer. At a 1.500 rps budget
  // that is 3,33s of draining, so a 1,5s window would drop the stragglers.
  const big = freshGame();
  for (let i = 0; i < 5000; i++) big.join('p' + i);
  big.start({ now: 0 });
  assert.equal(big.graceMs, Math.ceil(5000 / 1500 * 1000) + 500); // 3834
  assert.ok(big.graceMs > 1500, 'must grow beyond the floor for a real event');

  // ...but never without bound, or the big screen stalls on "Apurando…".
  const huge = freshGame({ maxGraceMs: 4000 });
  for (let i = 0; i < 50000; i++) huge.join('p' + i);
  huge.start({ now: 0 });
  assert.equal(huge.graceMs, 4000);

  // The latency slack is a knob too: a room that is all in one building needs
  // less of it than a globally distributed one.
  const local = freshGame({ lateArrivalMs: 0 });
  for (let i = 0; i < 5000; i++) local.join('p' + i);
  local.start({ now: 0 });
  assert.equal(local.graceMs, Math.ceil(5000 / 1500 * 1000)); // 3334, no slack

  // An explicit value still pins it, so GRACE_MS=0 keeps disabling the window.
  const pinned = freshGame({ graceMs: 0 });
  for (let i = 0; i < 5000; i++) pinned.join('p' + i);
  pinned.start({ now: 0 });
  assert.equal(pinned.graceMs, 0);
  assert.equal(pinned.settlesAt, pinned.endsAt);
});

test('a player who joins mid-round ranks last until the next tick', () => {
  const g = freshGame();
  g.join('a');
  g.start({ now: 0 });
  g.tap('a', 5, 3500);
  g.tick(3600);
  // No tick between join and read: rank is still 0 internally, but the view
  // must show a real position rather than leaking the sentinel.
  g.join('late');
  assert.equal(g.players.get('late').rank, 0);
  assert.equal(g.playerView('late', 3650).yourRank, 2);
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

test('playerView carries seq, so a phone that reloads keeps its number', () => {
  const g = freshGame();
  g.join('p1');
  // The phone stores only its id; name, emoji and seq all come back from the
  // server on the next /state. Dropping seq here blanked the "#142" on every
  // reload — visible to the player, invisible to every other assertion.
  const v = g.playerView('p1', 0);
  assert.equal(v.seq, 1);
  assert.equal(v.label, 'Alfa #1');
});

test('round length is clamped to something a round could plausibly be', () => {
  const g = freshGame();
  // Not anti-cheat — only the host can reach this — but a fat-fingered or
  // replayed durationMs must not park the game in RUNNING until the year 33715,
  // which no reset-less client can recover from.
  const s = g.start({ durationMs: 1e15, now: 0 });
  assert.equal(s.durationMs, Game.MAX_DURATION_MS);
  assert.equal(s.endsAt, s.startsAt + Game.MAX_DURATION_MS);

  const tiny = g.start({ durationMs: 1, now: 0 });
  assert.equal(tiny.durationMs, Game.MIN_DURATION_MS);
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
  g.tick(8001); // crosses endsAt — settling, not yet final
  assert.equal(calls, 0);
  g.tick(9500); // grace window closes -> fires
  g.tick(9600); // should NOT fire again
  g.tick(20000);
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

test('reset during the grace window abandons the round without persisting it', () => {
  let calls = 0;
  const g = freshGame({ graceMs: 1500, onEnded: () => { calls += 1; } });
  g.join('a');
  g.start({ durationMs: 5000, now: 0 }); // endsAt 8000, settlesAt 9500
  g.tap('a', 12, 3500);
  g.tick(8100); // ended, settling
  g.reset({ now: 8200 });
  g.tick(9500); // the settle deadline passes with the round abandoned
  assert.equal(g.phase, PHASE.LOBBY);
  assert.equal(calls, 0);
  assert.equal(g.winner, null);
});

test('cadence adapts to the room and stays inside its clamps', () => {
  const g = freshGame({
    requestBudgetRps: 1000,
    minTapIntervalMs: 150,
    maxTapIntervalMs: 3000,
    minPollIntervalMs: 600,
    maxPollIntervalMs: 5000,
  });
  assert.equal(g.tapIntervalMs(), 150, 'empty room sits at the floor');

  for (let i = 0; i < 100; i++) g.join(`p${i}`);
  assert.equal(g.tapIntervalMs(), 150, '100 players still fit under the floor');
  assert.equal(g.pollIntervalMs(), 600);

  for (let i = 100; i < 1000; i++) g.join(`p${i}`);
  assert.equal(g.tapIntervalMs(), 1000, '1.000 players against a 1.000 rps budget -> 1s');
  assert.equal(g.pollIntervalMs(), 1000);

  for (let i = 1000; i < 5000; i++) g.join(`p${i}`);
  assert.equal(g.tapIntervalMs(), 3000, 'clamped at the ceiling');
  assert.equal(g.pollIntervalMs(), 5000);

  // ...and it is actually published to the phones, not just computable.
  assert.equal(g.playerView(null, 0).tapIntervalMs, 3000);
  assert.equal(g.publicState(0).pollIntervalMs, 5000);
});

test('playerView is a pure read — it neither advances nor re-ranks', () => {
  const g = freshGame();
  g.join('a'); g.join('b');
  g.start({ now: 0 }); // startsAt 3000, endsAt 13000
  g.tap('a', 5, 3500);
  g.tick(3500); // snapshot: a=1, b=2
  g.tap('b', 99, 3600); // b now leads, but nothing has re-ranked yet

  // The snapshot is deliberately stale until the 100ms loop refreshes it —
  // this is the O(n log n) sort that must never run on a request path.
  assert.equal(g.playerView('a', 3600).yourRank, 1);

  // Reading state must not advance the phase machine either, however late the
  // clock it is handed. (Guards the /state fix in server.js against regression.)
  g.playerView(null, 999999);
  g.playerView('a', 999999);
  assert.equal(g.phase, PHASE.RUNNING, 'playerView must not end the round');
  assert.equal(g.winner, null);

  g.tick(3700);
  assert.equal(g.playerView('b', 3700).yourRank, 1);
});

test('leaderboard(n) goes deeper than top without sorting a second time', () => {
  const g = freshGame();
  for (let i = 0; i < 30; i++) g.join('p' + i);
  g.start({ now: 0 });
  for (let i = 0; i < 30; i++) g.tap('p' + i, i + 1, 3500); // p29 leads, p0 last

  // Instrument the sort itself: the dashboard's deeper slice must be free,
  // reading the snapshot the 100ms tick already left behind in _sortBuf.
  const realSort = Array.prototype.sort;
  let sorts = 0;
  g.tick(3600);
  Array.prototype.sort = function (...a) { sorts += 1; return realSort.apply(this, a); };
  let board;
  try {
    board = g.leaderboard(25);
  } finally {
    Array.prototype.sort = realSort;
  }
  assert.equal(sorts, 0, 'leaderboard must not re-sort the roster');

  assert.equal(board.length, 25);
  assert.equal(g.top.length, 10, 'the SSE frame the big screen gets must not grow');
  assert.deepEqual(board.slice(0, 10).map((r) => r.seq), g.top.map((r) => r.seq));
  assert.equal(board[0].seq, 30); // p29 joined 30th
  assert.equal(board[0].count, 30);

  // No player id: /metrics is public and an id is the only credential /tap
  // has. seq identifies a row without handing anyone a way to tap as them.
  assert.ok(!('id' in board[0]), 'leaderboard rows must not carry a player id');
  assert.ok('id' in g.top[0], '…but the SSE frame still needs one to key its FLIP animation');
  assert.equal(board[24].rank, 25);
  assert.ok(board[0].count > board[24].count);

  // Asking for more than there are players yields the roster, not holes.
  assert.equal(g.leaderboard(500).length, 30);
  assert.equal(g.leaderboard(0).length, 0);
});

test('leaderboard reads the same snapshot as top — stale between ticks, by design', () => {
  const g = freshGame();
  g.join('a'); g.join('b');
  g.start({ now: 0 });
  g.tap('a', 5, 3500);
  g.tick(3500);
  g.tap('b', 99, 3600); // b leads now, but nothing has re-ranked

  assert.equal(g.leaderboard(2)[0].seq, 1, 'must not recompute on read'); // a
  g.tick(3700);
  assert.equal(g.leaderboard(2)[0].seq, 2); // b
});

test('stats splits the roster into tapping vs idle and tallies languages', () => {
  const g = new Game({ countdownMs: 3000, durationMs: 10000 }); // real names -> real locales
  g.join('a', 'pt-BR');
  g.join('b', 'pt');
  g.join('c', 'de-AT');
  g.join('d', 'zh-CN'); // unsupported -> counted as the English fallback
  g.start({ now: 0 });

  let s = g.stats();
  assert.equal(s.tapping, 0);
  assert.equal(s.idle, 4, 'a lobby full of nobody tapping is the interesting case');
  assert.deepEqual(s.locales, [{ code: 'pt', n: 2 }, { code: 'de', n: 1 }, { code: 'en', n: 1 }]);

  g.tap('a', 3, 3500);
  g.tap('c', 1, 3500);
  s = g.stats();
  assert.equal(s.tapping, 2);
  assert.equal(s.idle, 2);

  // A new round zeroes the counts, so everyone is idle again until they tap.
  g.start({ now: 100000 });
  assert.equal(g.stats().tapping, 0);
});

test('countdown -> running transition is driven purely by now', () => {
  const g = freshGame();
  g.join('a');
  g.start({ now: 1000 }); // startsAt = 4000
  assert.equal(g.tick(3999).phase, PHASE.COUNTDOWN);
  assert.equal(g.tick(4000).phase, PHASE.RUNNING);
});
