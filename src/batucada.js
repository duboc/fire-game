import { makeNameFactory } from './names.js';

/** Game phases. Loops MEMORIZE -> RECALL -> REVEAL once per round. */
export const PHASE = Object.freeze({
  LOBBY: 'lobby',
  COUNTDOWN: 'countdown',
  MEMORIZE: 'memorize', // the screen lights the round's sequence
  RECALL: 'recall', // phones collect taps
  REVEAL: 'reveal', // who cleared the round, live standings
  ENDED: 'ended',
});

// Plain colors, not a themed set of icons — classic Simon Says is instantly
// recognizable, and a percussion theme (tried first; see docs/BATUCADA_SPEC.md)
// added a layer of "what does this icon mean" on top of the actual task, which
// is just to remember a sequence. Order matters: the wire format is indices
// into this array, and both client pages must render the same index as the
// same color.
export const SYMBOLS = Object.freeze(['blue', 'red', 'yellow', 'green']);

export const DEFAULTS = Object.freeze({
  countdownMs: 3000,
  // The game always runs this many rounds — no elimination. A miss costs the
  // round's points, never the seat: the whole room plays start to finish,
  // which is what makes a fixed 10-round arc predictable for an event.
  totalRounds: 10,

  // Round-1 flash cadence. Difficulty ramps on two axes: the sequence grows
  // (+1 symbol per round) AND the flash speeds up per round, clamped at the
  // floors below so late rounds stay readable rather than subliminal.
  symbolOnMs: 900,
  symbolGapMs: 500,
  symbolOnStepMs: 50, // shaved off per round after the first
  symbolGapStepMs: 25,
  minSymbolOnMs: 450,
  minSymbolGapMs: 250,

  recallBaseMs: 1500,
  recallPerSymbolMs: 1200,
  revealMs: 2500,
});

/**
 * In-memory authoritative game state, pure with respect to time the same way
 * `Game` is: every method that depends on "now" takes it as an argument.
 *
 * A fresh sequence is dealt each round (length == round number) rather than
 * classic Simon Says' cumulative replay, so a round's duration depends only on
 * that round's length, not on the sum of every round before it — see
 * docs/BATUCADA_SPEC.md.
 *
 * Scoring, not elimination: every player plays every round. A full match
 * counts a cleared round; a partial match still banks the matched prefix as
 * points. Ranking: cleared desc, symbols desc, total elapsed asc, seq asc —
 * the same strict-order guarantee the elimination version had, without ever
 * benching anyone.
 */
export class Batucada {
  /**
   * @param {object} [opts]
   * @param {number} [opts.countdownMs]
   * @param {number} [opts.totalRounds]
   * @param {number} [opts.symbolOnMs] round-1 flash duration
   * @param {number} [opts.symbolGapMs] round-1 gap duration
   * @param {number} [opts.symbolOnStepMs] flash speedup per round
   * @param {number} [opts.symbolGapStepMs] gap speedup per round
   * @param {number} [opts.minSymbolOnMs] readability floor
   * @param {number} [opts.minSymbolGapMs]
   * @param {number} [opts.recallBaseMs]
   * @param {number} [opts.recallPerSymbolMs]
   * @param {number} [opts.revealMs]
   * @param {ReadonlyArray<string>} [opts.symbols]
   * @param {(n: number) => number} [opts.rng] returns an integer in [0,n); injectable for tests
   * @param {() => {name,emoji,seq,label}} [opts.nameFactory] injectable for tests
   */
  constructor(opts = {}) {
    this.countdownMs = opts.countdownMs ?? DEFAULTS.countdownMs;
    this.totalRounds = Math.max(1, opts.totalRounds ?? DEFAULTS.totalRounds);
    this.symbolOnMs = opts.symbolOnMs ?? DEFAULTS.symbolOnMs;
    this.symbolGapMs = opts.symbolGapMs ?? DEFAULTS.symbolGapMs;
    this.symbolOnStepMs = opts.symbolOnStepMs ?? DEFAULTS.symbolOnStepMs;
    this.symbolGapStepMs = opts.symbolGapStepMs ?? DEFAULTS.symbolGapStepMs;
    this.minSymbolOnMs = opts.minSymbolOnMs ?? DEFAULTS.minSymbolOnMs;
    this.minSymbolGapMs = opts.minSymbolGapMs ?? DEFAULTS.minSymbolGapMs;
    this.recallBaseMs = opts.recallBaseMs ?? DEFAULTS.recallBaseMs;
    this.recallPerSymbolMs = opts.recallPerSymbolMs ?? DEFAULTS.recallPerSymbolMs;
    this.revealMs = opts.revealMs ?? DEFAULTS.revealMs;
    this.symbols = opts.symbols ?? SYMBOLS;
    this._nextIndex = opts.rng ?? ((n) => Math.floor(Math.random() * n));
    // Kept so reset() can tell an injected factory (tests pin one) from the
    // default one, which it re-deals — same reasoning as Game.
    this._injectedNameFactory = opts.nameFactory ?? null;
    this._nextName = this._injectedNameFactory ?? makeNameFactory();

    /** @type {Map<string, object>} */
    this.players = new Map();

    this.phase = PHASE.LOBBY;
    this.round = 0;
    this.sequence = [];
    this.startsAt = null; // epoch ms countdown -> round 1 MEMORIZE
    this.memorizeStartsAt = null;
    this.memorizeEndsAt = null;
    this.recallStartsAt = null;
    this.recallEndsAt = null;
    this.revealEndsAt = null;
    this.roundClearedCount = 0; // how many players fully matched the round just graded
    this.winner = null;
    this.roundId = 0;
  }

  /** Effective flash duration for a round — the per-round speed ramp, clamped. */
  symbolOnFor(round) {
    return Math.max(this.minSymbolOnMs, this.symbolOnMs - (round - 1) * this.symbolOnStepMs);
  }

  symbolGapFor(round) {
    return Math.max(this.minSymbolGapMs, this.symbolGapMs - (round - 1) * this.symbolGapStepMs);
  }

  /**
   * Registers a new player. A latecomer simply starts scoring from the round
   * they walked into — no spectator state, no special casing: rounds they
   * missed are rounds they scored zero on, which the ranking already handles.
   * @param {string} id stable client id (uuid) generated by caller
   * @param {string} [locale]
   */
  join(id, locale) {
    if (this.players.has(id)) return this._identity(this.players.get(id));
    const ident = this._nextName(locale);
    const player = {
      id,
      name: ident.name,
      emoji: ident.emoji,
      seq: ident.seq,
      locale: ident.locale,
      cleared: 0, // rounds fully matched
      symbols: 0, // cumulative matched symbols (partial credit included)
      elapsedTotalMs: 0, // cumulative recall latency — final tiebreak
      submitted: false,
      lastPrefix: null, // last graded round's matched prefix, for the phone
      lastCleared: null,
    };
    this.players.set(id, player);
    return this._identity(player);
  }

  /** Returns true if the id is a known player. */
  has(id) {
    return this.players.has(id);
  }

  /**
   * Records one player's attempt at the current round's sequence. Only the
   * first submission per round counts — a retry (flaky network) is a no-op —
   * and only while RECALL is open.
   * @param {string} id
   * @param {number[]} sequence what the player tapped, in order
   * @param {number} now
   * @returns {object|null} the player's view (see playerView), or null if unknown
   */
  recall(id, sequence, now) {
    const player = this.players.get(id);
    if (!player) return null;
    if (this.phase === PHASE.RECALL && !player.submitted) {
      player.submitted = true;
      player.elapsedTotalMs += Math.max(0, now - this.recallStartsAt);
      this._grade(player, sequence);
    }
    return this.playerView(id, now);
  }

  /**
   * Starts a new game: resets every player's score, re-enters COUNTDOWN.
   * @param {object} [opts] { now }
   */
  start({ now } = {}) {
    for (const p of this.players.values()) {
      p.cleared = 0;
      p.symbols = 0;
      p.elapsedTotalMs = 0;
      p.submitted = false;
      p.lastPrefix = null;
      p.lastCleared = null;
    }
    this.round = 0;
    this.sequence = [];
    this.roundClearedCount = 0;
    this.winner = null;
    this.startsAt = now + this.countdownMs;
    this.memorizeStartsAt = null;
    this.memorizeEndsAt = null;
    this.recallStartsAt = null;
    this.recallEndsAt = null;
    this.revealEndsAt = null;
    this.phase = PHASE.COUNTDOWN;
    this.roundId += 1;
    return this.publicState(now);
  }

  /** Resets back to an empty LOBBY: roster cleared, names re-dealt. */
  reset({ now } = {}) {
    this.players.clear();
    if (!this._injectedNameFactory) this._nextName = makeNameFactory();
    this.phase = PHASE.LOBBY;
    this.round = 0;
    this.sequence = [];
    this.roundClearedCount = 0;
    this.startsAt = null;
    this.memorizeStartsAt = null;
    this.memorizeEndsAt = null;
    this.recallStartsAt = null;
    this.recallEndsAt = null;
    this.revealEndsAt = null;
    this.winner = null;
    return this.publicState(now ?? 0);
  }

  /** Advances the phase machine. Belongs on the driving tick loop. */
  tick(now) {
    this._advance(now);
    return this.publicState(now);
  }

  /** Final ranking, sorted by the tiebreak chain described in the spec. Meaningful once ENDED, but well-defined any time. */
  results() {
    return this._ranking().map((p, i) => ({
      rank: i + 1,
      id: p.id,
      name: p.name,
      emoji: p.emoji,
      seq: p.seq,
      cleared: p.cleared,
      symbols: p.symbols,
      elapsedTotalMs: p.elapsedTotalMs,
    }));
  }

  // --- internals -----------------------------------------------------------

  _advance(now) {
    if (this.phase === PHASE.COUNTDOWN && now >= this.startsAt) {
      this._startRound(1, now);
    }
    if (this.phase === PHASE.MEMORIZE && now >= this.memorizeEndsAt) {
      this.phase = PHASE.RECALL;
    }
    if (this.phase === PHASE.RECALL && now >= this.recallEndsAt) {
      // Anyone silent ran out the clock: graded as a miss, and the full
      // window lands on their elapsed tiebreak — answering late must never
      // rank better than answering at all.
      for (const p of this.players.values()) {
        if (!p.submitted) {
          p.submitted = true;
          p.elapsedTotalMs += this.recallEndsAt - this.recallStartsAt;
          this._grade(p, []);
        }
      }
      this.roundClearedCount = 0;
      for (const p of this.players.values()) {
        if (p.lastCleared) this.roundClearedCount += 1;
      }
      this.phase = PHASE.REVEAL;
      this.revealEndsAt = now + this.revealMs;
    }
    if (this.phase === PHASE.REVEAL && now >= this.revealEndsAt) {
      if (this.round >= this.totalRounds) {
        this.phase = PHASE.ENDED;
        this.winner = this._ranking()[0] ?? null;
      } else {
        this._startRound(this.round + 1, now);
      }
    }
  }

  _startRound(round, now) {
    this.round = round;
    this.sequence = this._nextSequence(round);
    for (const p of this.players.values()) p.submitted = false;
    this.phase = PHASE.MEMORIZE;
    this.memorizeStartsAt = now;
    this.memorizeEndsAt = now + round * (this.symbolOnFor(round) + this.symbolGapFor(round));
    this.recallStartsAt = this.memorizeEndsAt;
    this.recallEndsAt = this.recallStartsAt + this.recallBaseMs + round * this.recallPerSymbolMs;
  }

  _nextSequence(round) {
    const n = this.symbols.length;
    const seq = [];
    for (let i = 0; i < round; i++) seq.push(this._nextIndex(n));
    return seq;
  }

  /**
   * Grades one submission against `this.sequence`. A full match counts a
   * cleared round; either way the matched prefix banks into `symbols`, so two
   * players who both missed still rank apart by how far each got.
   */
  _grade(player, submitted) {
    const seq = this.sequence;
    const arr = Array.isArray(submitted) ? submitted : [];
    let prefix = 0;
    while (prefix < seq.length && arr[prefix] === seq[prefix]) prefix += 1;
    player.lastPrefix = prefix;
    player.lastCleared = prefix === seq.length;
    player.symbols += prefix;
    if (player.lastCleared) player.cleared += 1;
  }

  _ranking() {
    return [...this.players.values()].sort(
      (a, b) =>
        b.cleared - a.cleared ||
        b.symbols - a.symbols ||
        a.elapsedTotalMs - b.elapsedTotalMs ||
        a.seq - b.seq,
    );
  }

  _identity(p) {
    return { id: p.id, name: p.name, emoji: p.emoji, seq: p.seq, locale: p.locale, label: `${p.name} #${p.seq}` };
  }

  /** Per-player view returned to a phone after /recall or /state. */
  playerView(id, now) {
    const base = {
      phase: this.phase,
      serverNow: now,
      round: this.round,
      totalRounds: this.totalRounds,
      startsAt: this.startsAt,
      memorizeStartsAt: this.memorizeStartsAt,
      memorizeEndsAt: this.memorizeEndsAt,
      recallEndsAt: this.recallEndsAt,
      revealEndsAt: this.revealEndsAt,
      countdownMs: this.countdownMs,
      symbolOnMs: this.round > 0 ? this.symbolOnFor(this.round) : this.symbolOnMs,
      symbolGapMs: this.round > 0 ? this.symbolGapFor(this.round) : this.symbolGapMs,
      total: this.players.size,
      roundId: this.roundId,
    };
    const p = this.players.get(id);
    if (!p) return { ...base, known: false };
    const view = {
      ...base,
      known: true,
      id: p.id,
      name: p.name,
      emoji: p.emoji,
      seq: p.seq,
      label: `${p.name} #${p.seq}`,
      cleared: p.cleared,
      symbols: p.symbols,
      submitted: p.submitted,
      lastPrefix: p.lastPrefix,
      lastCleared: p.lastCleared,
    };
    // Only meaningful once ENDED, and cheap only there: ranking the whole
    // roster per request would be the same mistake /state's old tick() call
    // was (docs/SCALE.md, finding 1) if this ran on every poll instead.
    if (this.phase === PHASE.ENDED) {
      const rank = this._ranking().findIndex((x) => x.id === id);
      view.yourRank = rank >= 0 ? rank + 1 : null;
    }
    return view;
  }

  /** Aggregate state broadcast to the big screen via SSE. */
  publicState(now) {
    const showStandings = this.phase === PHASE.REVEAL || this.phase === PHASE.ENDED;
    return {
      phase: this.phase,
      serverNow: now,
      round: this.round,
      totalRounds: this.totalRounds,
      sequence: this.sequence,
      startsAt: this.startsAt,
      memorizeStartsAt: this.memorizeStartsAt,
      memorizeEndsAt: this.memorizeEndsAt,
      recallEndsAt: this.recallEndsAt,
      revealEndsAt: this.revealEndsAt,
      countdownMs: this.countdownMs,
      symbolOnMs: this.round > 0 ? this.symbolOnFor(this.round) : this.symbolOnMs,
      symbolGapMs: this.round > 0 ? this.symbolGapFor(this.round) : this.symbolGapMs,
      total: this.players.size,
      roundClearedCount: this.roundClearedCount,
      // Standings only in the phases that show them: sorting the roster on
      // every 100ms broadcast would be _recount()-shaped work for frames the
      // screen renders as a countdown or a flash anyway.
      top: showStandings ? this.results().slice(0, 10) : [],
      winner: this.winner ? this._identity(this.winner) : null,
      roundId: this.roundId,
    };
  }
}
