import { makeNameFactory } from './names.js';

/** Game phases. Loops MEMORIZE -> RECALL -> REVEAL once per round. */
export const PHASE = Object.freeze({
  LOBBY: 'lobby',
  COUNTDOWN: 'countdown',
  MEMORIZE: 'memorize', // the screen lights the round's sequence
  RECALL: 'recall', // phones collect taps
  REVEAL: 'reveal', // who cleared the round, live standings
  BONUS_ARM: 'bonus_arm', // mid-game reflex round: suspense, color not yet shown
  BONUS_HIT: 'bonus_hit', // the color is lit — fastest correct tap wins the most
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
  // which is what makes a fixed arc predictable for an event.
  totalRounds: 12,

  // Round-1 flash cadence. Difficulty ramps on two axes: the sequence grows
  // (+1 symbol per round) AND the flash speeds up per round, clamped at the
  // floors below. The floors are perceptual, not aesthetic: this is a
  // projector read from across a room, and played-by-hand feedback was that
  // a 900/500→550/300 glide still felt rushed — the game is about attention,
  // so the whole band moved up. Round 1 is a deliberate 1,9s per symbol;
  // round 12 still gives 1,2s. The steps are sized so the glide reaches the
  // floor exactly at the final round instead of plateauing early.
  symbolOnMs: 1200,
  symbolGapMs: 700,
  symbolOnStepMs: 41, // shaved off per round after the first
  symbolGapStepMs: 23,
  minSymbolOnMs: 750,
  minSymbolGapMs: 450,
  // A breath between "the stage appeared" and the first flash. Without it the
  // first symbol fires during the phase transition itself and gets half-seen
  // — the exact "I never saw it blink" complaint.
  memorizeLeadInMs: 1200,

  recallBaseMs: 1500,
  recallPerSymbolMs: 1200,
  // Long enough to actually read: the reveal carries a cleared-count, up to
  // two spotlights and a top-5 — at 2.500ms it flashed past like a slide
  // nobody asked to skip. The screen staggers the elements in over ~2s, so
  // this is "unhurried", not "waiting".
  revealMs: 4500,

  // Mid-game bonus: a pure-reflex palate cleanser. The screen holds a
  // suspense beat of unpredictable length, then lights ONE color — tap it on
  // the phone, fastest tap scores most. Tapping during the suspense burns
  // your start: locked out, zero points.
  //
  // null = auto: the bonus always plays, halfway through whatever round
  // count the host picked (floor(totalRounds/2)). 0 disables it; a positive
  // number pins it after that round.
  bonusAfterRound: null,
  bonusArmMinMs: 2000, // suspense floor…
  bonusArmJitterMs: 3000, // …plus up to this much unpredictability
  bonusHitWindowMs: 2500, // how long the lit color accepts taps
  bonusMaxPts: 10, // an instant tap is worth this many symbols-points
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
  // Bounds for a host-picked round count. Same reasoning as Game's duration
  // clamp: the host panel is authenticated, so this guards against a typo or
  // a replayed request, not an attacker — an unclamped 999 parks the room in
  // a two-hour game nobody asked for.
  static MIN_ROUNDS = 1;
  static MAX_ROUNDS = 30;

  /**
   * @param {object} [opts]
   * @param {number} [opts.countdownMs]
   * @param {number} [opts.totalRounds] default round count (overridable per start)
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
    this.defaultTotalRounds = Math.max(1, opts.totalRounds ?? DEFAULTS.totalRounds);
    this.totalRounds = this.defaultTotalRounds;
    this.symbolOnMs = opts.symbolOnMs ?? DEFAULTS.symbolOnMs;
    this.symbolGapMs = opts.symbolGapMs ?? DEFAULTS.symbolGapMs;
    this.symbolOnStepMs = opts.symbolOnStepMs ?? DEFAULTS.symbolOnStepMs;
    this.symbolGapStepMs = opts.symbolGapStepMs ?? DEFAULTS.symbolGapStepMs;
    this.minSymbolOnMs = opts.minSymbolOnMs ?? DEFAULTS.minSymbolOnMs;
    this.minSymbolGapMs = opts.minSymbolGapMs ?? DEFAULTS.minSymbolGapMs;
    this.memorizeLeadInMs = Math.max(0, opts.memorizeLeadInMs ?? DEFAULTS.memorizeLeadInMs);
    this.recallBaseMs = opts.recallBaseMs ?? DEFAULTS.recallBaseMs;
    this.recallPerSymbolMs = opts.recallPerSymbolMs ?? DEFAULTS.recallPerSymbolMs;
    this.revealMs = opts.revealMs ?? DEFAULTS.revealMs;
    this.bonusAfterRound = opts.bonusAfterRound ?? DEFAULTS.bonusAfterRound;
    this.bonusArmMinMs = opts.bonusArmMinMs ?? DEFAULTS.bonusArmMinMs;
    this.bonusArmJitterMs = opts.bonusArmJitterMs ?? DEFAULTS.bonusArmJitterMs;
    this.bonusHitWindowMs = opts.bonusHitWindowMs ?? DEFAULTS.bonusHitWindowMs;
    this.bonusMaxPts = opts.bonusMaxPts ?? DEFAULTS.bonusMaxPts;
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
    this.submittedCount = 0; // answers in so far this round — the screen's live pulse
    this.spotlight = null; // { fastest, bestStreak } — set entering REVEAL, wiped at the next round
    this.winner = null;
    this.roundId = 0;

    // Bonus-round state. bonusColor stays server-side until BONUS_HIT — see
    // publicState, which deliberately withholds it (and the arm deadline)
    // while the room is waiting for the flash.
    this.bonusPlayed = false;
    this.bonusReveal = false; // the REVEAL on screen is the bonus result, not a memory round's
    this.bonusRound = 0; // resolved at start() from bonusAfterRound (null = mid-game auto)
    this.bonusColor = null;
    this.bonusArmEndsAt = null;
    this.bonusHitStartsAt = null;
    this.bonusHitEndsAt = null;
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
      lastElapsedMs: null, // this round's own latency — feeds the spotlight
      streak: 0, // consecutive memory rounds cleared — feeds the spotlight
      lastBonusOutcome: null, // 'early' | 'hit' | 'wrong' | 'none'
      lastBonusPts: 0,
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
      this.submittedCount += 1;
      player.lastElapsedMs = Math.max(0, now - this.recallStartsAt);
      player.elapsedTotalMs += player.lastElapsedMs;
      this._grade(player, sequence);
    } else if (this.phase === PHASE.BONUS_ARM && !player.submitted) {
      // Jumped the gun: the tap during the suspense IS the answer, and it is
      // wrong by definition. Locked out of the flash — that sting is the
      // whole tension of a reflex round.
      player.submitted = true;
      this.submittedCount += 1;
      player.lastBonusOutcome = 'early';
      player.lastBonusPts = 0;
      player.lastElapsedMs = this.bonusHitWindowMs;
      player.elapsedTotalMs += this.bonusHitWindowMs;
    } else if (this.phase === PHASE.BONUS_HIT && !player.submitted) {
      player.submitted = true;
      this.submittedCount += 1;
      const arr = Array.isArray(sequence) ? sequence : [];
      if (arr.length === 1 && arr[0] === this.bonusColor) {
        const elapsed = Math.max(0, now - this.bonusHitStartsAt);
        const frac = Math.min(1, elapsed / this.bonusHitWindowMs);
        player.lastBonusOutcome = 'hit';
        player.lastBonusPts = Math.max(1, Math.round(this.bonusMaxPts * (1 - frac)));
        player.symbols += player.lastBonusPts;
        player.lastElapsedMs = elapsed;
        player.elapsedTotalMs += elapsed;
      } else {
        player.lastBonusOutcome = 'wrong';
        player.lastBonusPts = 0;
        player.lastElapsedMs = this.bonusHitWindowMs;
        player.elapsedTotalMs += this.bonusHitWindowMs;
      }
    }
    return this.playerView(id, now);
  }

  /**
   * Starts a new game: resets every player's score, re-enters COUNTDOWN.
   * @param {object} [opts] { now, totalRounds } — totalRounds is the host's
   *   per-game pick; anything non-numeric falls back to the default, anything
   *   absurd is clamped.
   */
  start({ now, totalRounds } = {}) {
    const asked = Number.isFinite(totalRounds) && totalRounds > 0 ? Math.floor(totalRounds) : this.defaultTotalRounds;
    this.totalRounds = Math.min(Batucada.MAX_ROUNDS, Math.max(Batucada.MIN_ROUNDS, asked));
    // The surprise round always plays, halfway through whatever length the
    // host picked — unless it was explicitly pinned (tests, env) or disabled.
    this.bonusRound = this.bonusAfterRound === null
      ? Math.max(1, Math.floor(this.totalRounds / 2))
      : this.bonusAfterRound;
    for (const p of this.players.values()) {
      p.cleared = 0;
      p.symbols = 0;
      p.elapsedTotalMs = 0;
      p.submitted = false;
      p.lastPrefix = null;
      p.lastCleared = null;
      p.lastElapsedMs = null;
      p.streak = 0;
      p.lastBonusOutcome = null;
      p.lastBonusPts = 0;
    }
    this.round = 0;
    this.sequence = [];
    this.roundClearedCount = 0;
    this.submittedCount = 0;
    this.spotlight = null;
    this.winner = null;
    this.startsAt = now + this.countdownMs;
    this.memorizeStartsAt = null;
    this.memorizeEndsAt = null;
    this.recallStartsAt = null;
    this.recallEndsAt = null;
    this.revealEndsAt = null;
    this._resetBonus();
    this.phase = PHASE.COUNTDOWN;
    this.roundId += 1;
    return this.publicState(now);
  }

  /** Resets back to an empty LOBBY: roster cleared, names re-dealt. */
  reset({ now } = {}) {
    this.players.clear();
    if (!this._injectedNameFactory) this._nextName = makeNameFactory();
    this.totalRounds = this.defaultTotalRounds; // a per-game pick dies with the game
    this.phase = PHASE.LOBBY;
    this.round = 0;
    this.sequence = [];
    this.roundClearedCount = 0;
    this.submittedCount = 0;
    this.spotlight = null;
    this.startsAt = null;
    this.memorizeStartsAt = null;
    this.memorizeEndsAt = null;
    this.recallStartsAt = null;
    this.recallEndsAt = null;
    this.revealEndsAt = null;
    this.winner = null;
    this._resetBonus();
    return this.publicState(now ?? 0);
  }

  _resetBonus() {
    this.bonusPlayed = false;
    this.bonusReveal = false;
    this.bonusColor = null;
    this.bonusArmEndsAt = null;
    this.bonusHitStartsAt = null;
    this.bonusHitEndsAt = null;
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
    // The window also closes the moment the last player has answered — a
    // round-12 window is ~16s, and a room that answered in 5 should not
    // stare at a frozen screen for the other 11. Attention is the product.
    if (this.phase === PHASE.RECALL && (now >= this.recallEndsAt || this._allSubmitted())) {
      // Anyone silent ran out the clock: graded as a miss, and the full
      // window lands on their elapsed tiebreak — answering late must never
      // rank better than answering at all.
      for (const p of this.players.values()) {
        if (!p.submitted) {
          p.submitted = true;
          p.lastElapsedMs = this.recallEndsAt - this.recallStartsAt;
          p.elapsedTotalMs += p.lastElapsedMs;
          this._grade(p, []);
        }
      }
      this.submittedCount = this.players.size;
      this.roundClearedCount = 0;
      for (const p of this.players.values()) {
        if (p.lastCleared) this.roundClearedCount += 1;
      }
      this.spotlight = this._spotlight((p) => p.lastCleared);
      this.phase = PHASE.REVEAL;
      this.bonusReveal = false;
      this.revealEndsAt = now + this.revealMs;
    }
    if (this.phase === PHASE.BONUS_ARM && now >= this.bonusArmEndsAt) {
      this.phase = PHASE.BONUS_HIT;
      this.bonusHitStartsAt = now;
      this.bonusHitEndsAt = now + this.bonusHitWindowMs;
    }
    if (this.phase === PHASE.BONUS_HIT && (now >= this.bonusHitEndsAt || this._allSubmitted())) {
      for (const p of this.players.values()) {
        if (!p.submitted) {
          p.submitted = true;
          p.lastBonusOutcome = 'none';
          p.lastBonusPts = 0;
          p.lastElapsedMs = this.bonusHitWindowMs;
          p.elapsedTotalMs += this.bonusHitWindowMs;
        }
      }
      this.submittedCount = this.players.size;
      this.roundClearedCount = 0;
      for (const p of this.players.values()) {
        if (p.lastBonusOutcome === 'hit') this.roundClearedCount += 1;
      }
      this.spotlight = this._spotlight((p) => p.lastBonusOutcome === 'hit');
      this.phase = PHASE.REVEAL;
      this.bonusReveal = true;
      this.revealEndsAt = now + this.revealMs;
    }
    if (this.phase === PHASE.REVEAL && now >= this.revealEndsAt) {
      if (!this.bonusReveal && this.bonusRound > 0 && !this.bonusPlayed
          && this.round === this.bonusRound && this.round < this.totalRounds) {
        this._startBonus(now);
      } else if (this.round >= this.totalRounds) {
        this.phase = PHASE.ENDED;
        this.winner = this._ranking()[0] ?? null;
      } else {
        this._startRound(this.round + 1, now);
      }
    }
  }

  _allSubmitted() {
    if (this.players.size === 0) return false;
    for (const p of this.players.values()) {
      if (!p.submitted) return false;
    }
    return true;
  }

  _startBonus(now) {
    this.bonusPlayed = true;
    this.bonusReveal = false;
    this.bonusColor = this._nextIndex(this.symbols.length);
    // Suspense of unpredictable length, drawn from the same injectable rng as
    // the sequences — a fixed delay would make the "reflex" a metronome.
    const jitter = this.bonusArmJitterMs > 0 ? this._nextIndex(this.bonusArmJitterMs + 1) : 0;
    this.bonusArmEndsAt = now + this.bonusArmMinMs + jitter;
    this.bonusHitStartsAt = null;
    this.bonusHitEndsAt = null;
    for (const p of this.players.values()) {
      p.submitted = false;
      p.lastBonusOutcome = null;
      p.lastBonusPts = 0;
    }
    this.submittedCount = 0;
    this.spotlight = null;
    this.phase = PHASE.BONUS_ARM;
  }

  _startRound(round, now) {
    this.round = round;
    this.sequence = this._nextSequence(round);
    for (const p of this.players.values()) p.submitted = false;
    this.submittedCount = 0;
    this.spotlight = null;
    this.phase = PHASE.MEMORIZE;
    this.memorizeStartsAt = now;
    this.memorizeEndsAt = now + this.memorizeLeadInMs + round * (this.symbolOnFor(round) + this.symbolGapFor(round));
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
    player.streak = player.lastCleared ? player.streak + 1 : 0;
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

  /**
   * The round's bragging rights, computed once entering REVEAL: the fastest
   * player among those `won` selects, and the longest active streak (2+ —
   * a 1-round streak is not news). Ties go to the earlier joiner, matching
   * every other tiebreak in this file.
   */
  _spotlight(won) {
    let fastest = null;
    let best = null;
    for (const p of this.players.values()) {
      if (won(p) && (fastest === null || p.lastElapsedMs < fastest.lastElapsedMs
          || (p.lastElapsedMs === fastest.lastElapsedMs && p.seq < fastest.seq))) fastest = p;
      if (p.streak >= 2 && (best === null || p.streak > best.streak
          || (p.streak === best.streak && p.seq < best.seq))) best = p;
    }
    return {
      fastest: fastest ? { name: fastest.name, emoji: fastest.emoji, seq: fastest.seq, ms: fastest.lastElapsedMs } : null,
      bestStreak: best ? { name: best.name, emoji: best.emoji, seq: best.seq, n: best.streak } : null,
    };
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
      memorizeLeadInMs: this.memorizeLeadInMs,
      total: this.players.size,
      bonusReveal: this.bonusReveal,
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
      lastBonusOutcome: p.lastBonusOutcome,
      lastBonusPts: p.lastBonusPts,
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
    // Withheld on purpose during BONUS_ARM: publishing the color (or the arm
    // deadline) ahead of the flash would let a phone reading /batucada/state
    // script the "reflex". The screen learns the color the same instant the
    // room does — on the phase flip to BONUS_HIT.
    const bonus = this.phase === PHASE.BONUS_HIT
      ? { bonusColor: this.bonusColor, bonusHitStartsAt: this.bonusHitStartsAt, bonusHitEndsAt: this.bonusHitEndsAt }
      : {};
    return {
      ...bonus,
      bonusReveal: this.bonusReveal,
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
      memorizeLeadInMs: this.memorizeLeadInMs,
      total: this.players.size,
      roundClearedCount: this.roundClearedCount,
      submittedCount: this.submittedCount,
      spotlight: this.phase === PHASE.REVEAL ? this.spotlight : null,
      // Standings only in the phases that show them: sorting the roster on
      // every 100ms broadcast would be _recount()-shaped work for frames the
      // screen renders as a countdown or a flash anyway.
      top: showStandings ? this.results().slice(0, 10) : [],
      winner: this.winner ? this._identity(this.winner) : null,
      roundId: this.roundId,
    };
  }
}
