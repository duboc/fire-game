import { makeNameFactory } from './names.js';

/** Game phases. */
export const PHASE = Object.freeze({
  LOBBY: 'lobby',
  COUNTDOWN: 'countdown',
  RUNNING: 'running',
  ENDED: 'ended',
});

export const DEFAULTS = Object.freeze({
  countdownMs: 3000,
  durationMs: 30000,
  // Anti-accident bound (retry storms, buggy client loops), NOT anti-cheat.
  // Must comfortably exceed a whole round of taps, because a phone that fails
  // to flush all round and then succeeds once is legitimate, not abusive.
  maxTapsPerBatch: 400,
  topN: 10,

  // Taps that arrive within this window after endsAt are still credited: they
  // were made before the buzzer, the phone is just far away. Longer client
  // cadences (see tapIntervalMs) make this essential rather than cosmetic —
  // without it a distant player silently loses their last whole batch.
  //
  // The window has to outlast the buzzer herd: every phone flushes one last
  // time, so the server must absorb one request per player before it closes.
  // A fixed 1.500ms is right for a room and far too short for an event — 5.000
  // final flushes measured 2.107ms to drain (docs/SCALE.md, finding 8) — so it
  // is derived from the roster at start(), between these bounds.
  minGraceMs: 1500,
  maxGraceMs: 6000,
  lateArrivalMs: 500, // slack for the furthest player's one-way latency

  // Adaptive cadence. The server knows the player count, so it tells phones how
  // often to call instead of hardcoding a rate that is either wasteful for a
  // room of 300 or fatal for a global event of 5.000. See docs/SCALE.md.
  requestBudgetRps: 1500, // aggregate target; ~42% of measured single-core saturation
  minTapIntervalMs: 150, // responsiveness floor (small rooms behave exactly as before)
  maxTapIntervalMs: 3000, // sluggishness ceiling; paired with graceMs so nothing is lost
  minPollIntervalMs: 600, // lobby/countdown/ended polls are cheap and non-urgent
  maxPollIntervalMs: 5000,
});

/**
 * In-memory authoritative game state. Pure with respect to time: every method
 * that depends on "now" takes it as an argument, so behavior is fully
 * deterministic and unit-testable. The HTTP layer (server.js) is the only thing
 * that reads the real clock.
 */
export class Game {
  /**
   * @param {object} [opts]
   * @param {number} [opts.countdownMs]
   * @param {number} [opts.durationMs] default round length (overridable per start)
   * @param {number} [opts.maxTapsPerBatch]
   * @param {number} [opts.topN]
   * @param {number} [opts.graceMs] post-buzzer window in which late taps still count
   * @param {number} [opts.requestBudgetRps] aggregate request target used to derive cadence
   * @param {number} [opts.minTapIntervalMs]
   * @param {number} [opts.maxTapIntervalMs]
   * @param {number} [opts.minPollIntervalMs]
   * @param {number} [opts.maxPollIntervalMs]
   * @param {() => {name,emoji,seq,label}} [opts.nameFactory] injectable for tests
   * @param {(result: object) => void} [opts.onEnded] called once when a round ends
   */
  constructor(opts = {}) {
    this.countdownMs = opts.countdownMs ?? DEFAULTS.countdownMs;
    this.defaultDurationMs = opts.durationMs ?? DEFAULTS.durationMs;
    this.maxTapsPerBatch = opts.maxTapsPerBatch ?? DEFAULTS.maxTapsPerBatch;
    this.topN = opts.topN ?? DEFAULTS.topN;
    // An explicit graceMs pins the window (GRACE_MS=0 disables it, tests fix it);
    // otherwise every round sizes its own from the roster.
    this.fixedGraceMs = opts.graceMs === undefined ? null : Math.max(0, opts.graceMs);
    this.minGraceMs = Math.max(0, opts.minGraceMs ?? DEFAULTS.minGraceMs);
    this.maxGraceMs = Math.max(this.minGraceMs, opts.maxGraceMs ?? DEFAULTS.maxGraceMs);
    this.lateArrivalMs = Math.max(0, opts.lateArrivalMs ?? DEFAULTS.lateArrivalMs);
    this.graceMs = this.fixedGraceMs ?? this.minGraceMs;
    this.requestBudgetRps = Math.max(1, opts.requestBudgetRps ?? DEFAULTS.requestBudgetRps);
    this.minTapIntervalMs = opts.minTapIntervalMs ?? DEFAULTS.minTapIntervalMs;
    this.maxTapIntervalMs = opts.maxTapIntervalMs ?? DEFAULTS.maxTapIntervalMs;
    this.minPollIntervalMs = opts.minPollIntervalMs ?? DEFAULTS.minPollIntervalMs;
    this.maxPollIntervalMs = opts.maxPollIntervalMs ?? DEFAULTS.maxPollIntervalMs;
    this._nextName = opts.nameFactory ?? makeNameFactory();
    this._onEnded = opts.onEnded ?? null;

    /** @type {Map<string, {id, name, emoji, seq, count, rank}>} */
    this.players = new Map();
    /** @type {Array<{rank, id, name, emoji, count}>} cached top-N */
    this.top = [];
    // Set whenever anything that affects ranking changes. _recount() is the
    // single most expensive thing this process does (1,673ms at 5.000 players =
    // 16,7% of the only core, 10x a second), and in LOBBY or after settling
    // nothing can possibly have changed. See docs/SCALE.md.
    this._dirty = true;
    /** Reused scratch buffer for the sort; avoids a 5.000-element array 10x/s. */
    this._sortBuf = [];

    this.phase = PHASE.LOBBY;
    this.startsAt = null; // epoch ms the round goes live (countdown -> running)
    this.endsAt = null; // epoch ms the round ends
    this.settlesAt = null; // epoch ms the grace window closes and the winner is final
    // False only while a round is in flight or still settling. The big screen
    // withholds the champion (and the confetti) until this is true, so a late
    // but legitimate batch can never be seen changing the result.
    this.settled = true;
    this.durationMs = this.defaultDurationMs;
    this.winner = null;
    this.totalTaps = 0;
    this.roundId = 0;
  }

  /**
   * Registers a new player and returns its identity.
   * @param {string} id stable client id (uuid) generated by caller
   * @param {string} [locale] raw language preference; normalised by the factory
   */
  join(id, locale) {
    if (this.players.has(id)) return this._identity(this.players.get(id));
    const ident = this._nextName(locale);
    // rank 0 = "not ranked yet"; playerView falls back to last place until the
    // next tick, which is what an unranked newcomer is anyway.
    const player = {
      id, name: ident.name, emoji: ident.emoji, seq: ident.seq, locale: ident.locale, count: 0, rank: 0,
    };
    this.players.set(id, player);
    this._dirty = true;
    return this._identity(player);
  }

  /** Returns true if the id is a known player. */
  has(id) {
    return this.players.has(id);
  }

  /**
   * Records a batch of taps. Counts while the round is RUNNING, and keeps
   * counting through the post-buzzer grace window (see graceMs) so a batch that
   * left the phone before endsAt is not thrown away for being far from the
   * server. The batch is clamped to maxTapsPerBatch as accident protection.
   * @returns {object} the player's view (see playerView)
   */
  tap(id, n, now) {
    this._advance(now);
    const player = this.players.get(id);
    if (!player) return null;
    // _advance has already flipped RUNNING -> ENDED if now >= endsAt, so the
    // grace window is exactly "ENDED but not yet settled".
    if (this.phase === PHASE.RUNNING || (this.phase === PHASE.ENDED && !this.settled)) {
      let count = Number(n);
      if (!Number.isFinite(count) || count <= 0) count = 0;
      count = Math.min(Math.floor(count), this.maxTapsPerBatch);
      if (count > 0) {
        player.count += count;
        this.totalTaps += count;
        this._dirty = true;
      }
    }
    return this.playerView(id, now);
  }

  /**
   * Starts a new round: zeroes all counts, enters COUNTDOWN, then RUNNING.
   * @param {object} [opts] { durationMs, now }
   */
  start({ durationMs, now } = {}) {
    const dur = Number.isFinite(durationMs) && durationMs > 0 ? Math.floor(durationMs) : this.defaultDurationMs;
    for (const p of this.players.values()) p.count = 0;
    this.totalTaps = 0;
    this.winner = null;
    this._dirty = true;
    this.durationMs = dur;
    this.graceMs = this._graceFor(this.players.size);
    this.startsAt = now + this.countdownMs;
    this.endsAt = this.startsAt + dur;
    this.settlesAt = this.endsAt + this.graceMs;
    this.settled = false;
    this.phase = PHASE.COUNTDOWN;
    this.roundId += 1;
    this._recount();
    return this.publicState(now);
  }

  /** Resets back to LOBBY, zeroing counts but keeping joined players & names. */
  reset({ now } = {}) {
    for (const p of this.players.values()) p.count = 0;
    this.totalTaps = 0;
    this.winner = null;
    this._dirty = true;
    this.startsAt = null;
    this.endsAt = null;
    this.settlesAt = null;
    this.settled = true; // nothing pending; an abandoned round never settles
    this.phase = PHASE.LOBBY;
    this._recount();
    return this.publicState(now ?? 0);
  }

  /**
   * Advances the phase machine and refreshes rank/top snapshots. Belongs on the
   * 100ms loop and nowhere else: request handlers must read the snapshot it
   * leaves behind rather than recompute it (docs/SCALE.md, finding 1).
   */
  tick(now) {
    this._advance(now);
    this._recount();
    return this.publicState(now);
  }

  // --- internals -----------------------------------------------------------

  _advance(now) {
    if (this.phase === PHASE.COUNTDOWN && now >= this.startsAt) {
      this.phase = PHASE.RUNNING;
    }
    // The buzzer stops the clock, but not the counting: taps keep landing until
    // settlesAt. Deliberately not `else if` — a zero grace window must be able
    // to end and settle within a single call.
    if (this.phase === PHASE.RUNNING && now >= this.endsAt) {
      this.phase = PHASE.ENDED;
    }
    if (this.phase === PHASE.ENDED && !this.settled && now >= this.settlesAt) {
      this.settled = true;
      this._recount();
      this.winner = this.top[0] ?? null;
      if (this._onEnded) {
        try {
          this._onEnded(this.results());
        } catch {
          /* persistence failures must never crash the game loop */
        }
      }
    }
  }

  /**
   * How often a phone should POST /tap while the round is running. Derived from
   * the live player count against an aggregate request budget, so the room sets
   * its own pace: 300 players stay at the responsiveness floor, 5.000 back off
   * automatically. Clamped at both ends; see docs/SCALE.md for the numbers.
   */
  tapIntervalMs() {
    return this._interval(this.minTapIntervalMs, this.maxTapIntervalMs);
  }

  /** Same idea for the cheap lobby/countdown/ended polls, which tolerate far more lag. */
  pollIntervalMs() {
    return this._interval(this.minPollIntervalMs, this.maxPollIntervalMs);
  }

  /**
   * How long the post-buzzer window has to be for this roster. At the buzzer
   * every phone flushes once, so the window must outlast draining one request
   * per player at the request budget, plus the furthest player's one-way trip.
   * 300 players land inside the floor; 5.000 need several seconds — which the
   * big screen spends holding "Apurando…", so the cost is suspense, not lag.
   */
  _graceFor(players) {
    if (this.fixedGraceMs !== null) return this.fixedGraceMs;
    const drainMs = Math.ceil((Math.max(1, players) / this.requestBudgetRps) * 1000);
    return Math.min(this.maxGraceMs, Math.max(this.minGraceMs, drainMs + this.lateArrivalMs));
  }

  _interval(min, max) {
    const ideal = Math.ceil((Math.max(1, this.players.size) / this.requestBudgetRps) * 1000);
    return Math.min(max, Math.max(min, ideal));
  }

  /**
   * Rebuilds the rank snapshot. O(n log n) over every player, so it runs on the
   * 100ms loop and never on a request path — and only when something actually
   * changed. Ranks are written onto the player objects rather than into a fresh
   * Map: the old Map cost 5.000 allocations + 5.000 inserts ten times a second
   * for information the player object could just carry.
   */
  _recount() {
    if (!this._dirty) return;
    this._dirty = false;

    const sorted = this._sortBuf;
    sorted.length = 0;
    for (const p of this.players.values()) sorted.push(p);
    sorted.sort((a, b) => b.count - a.count || a.seq - b.seq); // ties: earlier joiner ranks higher

    const top = [];
    for (let i = 0; i < sorted.length; i++) {
      const p = sorted[i];
      p.rank = i + 1;
      if (i < this.topN) {
        top.push({ rank: i + 1, id: p.id, name: p.name, emoji: p.emoji, seq: p.seq, count: p.count });
      }
    }
    this.top = top;
  }

  _identity(p) {
    // `locale` is what the server actually resolved, not what was asked for.
    // Only sent on join (once per player), never on the /tap hot path.
    return { id: p.id, name: p.name, emoji: p.emoji, seq: p.seq, locale: p.locale, label: `${p.name} #${p.seq}` };
  }

  /** Per-player view returned to a phone after /tap or /state. */
  playerView(id, now) {
    const p = this.players.get(id);
    const base = {
      phase: this.phase,
      serverNow: now,
      startsAt: this.startsAt,
      endsAt: this.endsAt,
      settlesAt: this.settlesAt,
      settled: this.settled,
      graceMs: this.graceMs,
      countdownMs: this.countdownMs,
      durationMs: this.durationMs,
      total: this.players.size,
      tapIntervalMs: this.tapIntervalMs(), // server-driven cadence — the phone obeys this
      pollIntervalMs: this.pollIntervalMs(),
      roundId: this.roundId, // lets the phone reset optimistic state on a new round
    };
    if (!p) return { ...base, known: false };
    return {
      ...base,
      known: true,
      id: p.id,
      name: p.name,
      emoji: p.emoji,
      // The phone persists only its id, so identity has to be re-derivable from
      // this view alone — without seq, every reload blanked the player's #number.
      seq: p.seq,
      label: `${p.name} #${p.seq}`,
      yourRank: p.rank || this.players.size, // 0 = joined since the last tick ⇒ last place
      yourCount: p.count,
    };
  }

  /** Aggregate state broadcast to the big screen via SSE. */
  publicState(now) {
    return {
      phase: this.phase,
      serverNow: now,
      startsAt: this.startsAt,
      endsAt: this.endsAt,
      settlesAt: this.settlesAt,
      settled: this.settled,
      graceMs: this.graceMs,
      countdownMs: this.countdownMs,
      durationMs: this.durationMs,
      total: this.players.size,
      totalTaps: this.totalTaps,
      tapIntervalMs: this.tapIntervalMs(),
      pollIntervalMs: this.pollIntervalMs(),
      top: this.top,
      winner: this.winner, // stays null until settled
      roundId: this.roundId,
    };
  }

  /** Final results, used for persistence at round end. */
  results() {
    const sorted = [...this.players.values()]
      .sort((a, b) => b.count - a.count || a.seq - b.seq)
      .map((p, i) => ({ rank: i + 1, name: p.name, seq: p.seq, count: p.count }));
    return {
      roundId: this.roundId,
      durationMs: this.durationMs,
      endedAt: this.endsAt,
      totalPlayers: this.players.size,
      totalTaps: this.totalTaps,
      winner: sorted[0] ?? null,
      leaderboard: sorted.slice(0, 50),
    };
  }
}
