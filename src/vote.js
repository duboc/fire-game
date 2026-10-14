import { fold } from '../public/vote/search.js';

/** Each category runs its own SETUP -> OPEN -> CLOSED machine. */
export const PHASE = Object.freeze({ SETUP: 'setup', OPEN: 'open', CLOSED: 'closed' });

export const LIMITS = Object.freeze({
  minNames: 2,
  maxNames: 300,
  maxNameLen: 60,
  maxCategories: 6, // what the screen's 3x2 grid can hold
  maxTitleLen: 60,
  maxPicks: 10, // what the phone's tray can hold
  minDurationMs: 30_000,
  maxDurationMs: 4 * 3600_000,
  defaultDurationMs: 180_000,
  feedSize: 24,
  // Categories that close within this long of the latest close count as
  // "closed together" for the auto stage.
  closedTogetherMs: 1000,
});

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * Live Vote engine — see docs/VOTE_SPEC.md. Pure with respect to time the same
 * way `Game` and `Batucada` are: every method that depends on "now" takes it.
 *
 * One shared candidate list runs in every category; a ballot is exactly N
 * distinct candidate ids for one category, keyed by an opaque voter id that
 * src/vote-guard.js vouches for. Candidate ids are positions in the current
 * list, so `listVersion` travels with every ballot to catch a stale phone.
 */
export class Vote {
  constructor({ names, categories, minDurationMs, listVersionBase } = {}) {
    // Overridable only so browser checks can watch a deadline pass in seconds.
    this.minDurationMs = minDurationMs ?? LIMITS.minDurationMs;
    this.candidates = []; // [{id, name}], id === index
    // Candidate ids are list positions, and a phone can sleep through a
    // restart: if versions restarted at 1, a "v2" from before would match a
    // different "v2" after and votes would land on the wrong names. The server
    // passes a per-boot base so a version is never reused.
    this.listVersion = listVersionBase ?? 0;
    this.seeded = false; // true until the first admin save — the admin page's restore cue
    this.categories = [];
    this.stage = { mode: 'auto', categoryIds: [] };
    this.feed = []; // [{seq, categoryId, candidateId, at}] — newest last
    this.version = 0; // bumps on anything the screen shows
    this.phoneVersion = 0; // bumps only on what phones need (phases, config)
    this._nextCat = 1;
    this._feedSeq = 0;
    if (names || categories) {
      const r = this.configure({ names: names ?? [], categories: categories ?? [] });
      if (!r.ok) throw new Error(`bad seed: ${r.errors.join(' ')}`);
      this.seeded = true;
    }
  }

  /**
   * Replace the name list and category list in one save. Allowed only while no
   * category is open. Rejects — never silently fixes — anything invalid, and
   * names the offending lines so the admin can fix them.
   */
  configure({ names, categories } = {}) {
    if (this.categories.some((c) => c.phase === PHASE.OPEN)) {
      return { ok: false, errors: ['Close every open category before editing names or categories.'] };
    }
    if (!Array.isArray(names) || !Array.isArray(categories)) {
      return { ok: false, errors: ['names and categories must both be lists.'] };
    }
    const errors = [];
    const list = names.map(clean).filter(Boolean);
    if (list.length < LIMITS.minNames) errors.push(`At least ${LIMITS.minNames} names are needed (got ${list.length}).`);
    if (list.length > LIMITS.maxNames) errors.push(`At most ${LIMITS.maxNames} names (got ${list.length}).`);
    const seen = new Map();
    list.forEach((n, i) => {
      if (n.length > LIMITS.maxNameLen) {
        errors.push(`Name ${i + 1} is over ${LIMITS.maxNameLen} characters: "${n.slice(0, 24)}…".`);
      }
      const key = fold(n).text;
      if (seen.has(key)) {
        const j = seen.get(key);
        errors.push(`"${n}" (line ${i + 1}) is the same name as "${list[j]}" (line ${j + 1}).`);
      } else seen.set(key, i);
    });
    if (categories.length < 1 || categories.length > LIMITS.maxCategories) {
      errors.push(`Between 1 and ${LIMITS.maxCategories} categories (got ${categories.length}).`);
    }
    const maxPicks = Math.min(LIMITS.maxPicks, list.length);
    const byId = new Map(this.categories.map((c) => [c.id, c]));
    const specs = categories.map((c, i) => {
      const title = clean(c?.title);
      const picks = Number(c?.picks);
      if (!title) errors.push(`Category ${i + 1} needs a title.`);
      else if (title.length > LIMITS.maxTitleLen) {
        errors.push(`Category ${i + 1} title is over ${LIMITS.maxTitleLen} characters.`);
      }
      if (!Number.isInteger(picks) || picks < 1 || picks > maxPicks) {
        errors.push(`Category ${i + 1}${title ? ` ("${title}")` : ''} must ask for 1–${maxPicks} picks.`);
      }
      return { id: typeof c?.id === 'string' && byId.has(c.id) ? c.id : null, title, picks };
    });
    if (errors.length) return { ok: false, errors };

    const namesChanged =
      list.length !== this.candidates.length || list.some((n, i) => n !== this.candidates[i].name);
    if (namesChanged) {
      this.candidates = list.map((name, id) => ({ id, name }));
      this.listVersion += 1;
    }
    const kept = new Set();
    this.categories = specs.map((s) => {
      // A repeated id in one save is a new category, not two views of one.
      let cat = s.id && !kept.has(s.id) ? byId.get(s.id) : null;
      if (!cat) cat = this._newCategory();
      kept.add(cat.id);
      const picksChanged = cat.picks !== s.picks;
      cat.title = s.title;
      cat.picks = s.picks;
      if (namesChanged || picksChanged) this._clear(cat);
      return cat;
    });
    this.stage.categoryIds = this.stage.categoryIds.filter((id) => kept.has(id));
    if (this.stage.mode === 'pinned' && this.stage.categoryIds.length === 0) this.stage.mode = 'auto';
    this.seeded = false;
    this._touch(true);
    return { ok: true };
  }

  /** Start a fresh round (zero ballots, new roundId) in each category. */
  open(categoryIds, durationMs, now) {
    const sel = this._select(categoryIds);
    if (!sel.ok) return sel;
    const d = durationMs === undefined || durationMs === null ? LIMITS.defaultDurationMs : Number(durationMs);
    if (!Number.isFinite(d) || d < this.minDurationMs || d > LIMITS.maxDurationMs) {
      return { ok: false, errors: [`Duration must be between ${Math.round(this.minDurationMs / 1000)} seconds and 4 hours.`] };
    }
    for (const cat of sel.cats) {
      this._clear(cat);
      cat.phase = PHASE.OPEN;
      cat.roundId += 1;
      cat.endsAt = now + d;
      cat.durationMs = d;
    }
    this._touch(true);
    return { ok: true };
  }

  /** End these rounds now. Categories that aren't open are left alone. */
  close(categoryIds, now) {
    const sel = this._select(categoryIds);
    if (!sel.ok) return sel;
    for (const cat of sel.cats) if (cat.phase === PHASE.OPEN) this._closeCat(cat, now);
    this._touch(true);
    return { ok: true };
  }

  /** Back to setup with ballots cleared. */
  reset(categoryIds) {
    const sel = this._select(categoryIds);
    if (!sel.ok) return sel;
    for (const cat of sel.cats) this._clear(cat);
    this._touch(true);
    return { ok: true };
  }

  /**
   * Record (or replace) one voter's ballot in one category. The deadline is
   * checked against `now`, not just the phase, so a ballot landing between the
   * deadline and the next tick is still refused.
   */
  submit(voterId, { categoryId, roundId, listVersion, picks } = {}, now) {
    const cat = this.categories.find((c) => c.id === categoryId);
    if (!cat) return { ok: false, reason: 'unknown_category' };
    if (listVersion !== this.listVersion) return { ok: false, reason: 'stale_list' };
    if (cat.phase !== PHASE.OPEN || now >= cat.endsAt) return { ok: false, reason: 'closed' };
    if (roundId !== cat.roundId) return { ok: false, reason: 'stale_round' };
    if (cat.voided.has(voterId)) return { ok: false, reason: 'voided' };
    if (!Array.isArray(picks) || picks.length !== cat.picks) return { ok: false, reason: 'wrong_count' };
    const set = new Set(picks);
    if (set.size !== picks.length || picks.some((p) => !Number.isInteger(p) || p < 0 || p >= this.candidates.length)) {
      return { ok: false, reason: 'bad_picks' };
    }
    const next = [...set].sort((a, b) => a - b);
    const prev = cat.ballots.get(voterId);
    if (prev && prev.every((p, i) => p === next[i])) return { ok: true, ballot: next, changed: false, added: [] };
    const prevSet = new Set(prev ?? []);
    const added = next.filter((p) => !prevSet.has(p));
    for (const p of prev ?? []) if (!set.has(p)) cat.counts[p] -= 1;
    for (const p of added) cat.counts[p] += 1;
    if (!prev) cat.ballotCount += 1;
    cat.ballots.set(voterId, next);
    cat.rev += 1;
    for (const p of added) this._pushFeed(cat.id, p, now);
    this._touch(false);
    return { ok: true, ballot: next, changed: true, added };
  }

  /** Take these voters' ballots out of the counts and bar them for the round. */
  void(categoryId, voterIds) {
    const cat = this.categories.find((c) => c.id === categoryId);
    if (!cat) return 0;
    let n = 0;
    for (const id of voterIds) {
      if (cat.voided.has(id)) continue;
      cat.voided.add(id);
      const b = cat.ballots.get(id);
      if (!b) continue;
      for (const p of b) cat.counts[p] -= 1;
      cat.ballotCount -= 1;
      n += 1;
    }
    this._touch(false);
    return n;
  }

  /** Undo `void` for these voters. */
  restore(categoryId, voterIds) {
    const cat = this.categories.find((c) => c.id === categoryId);
    if (!cat) return 0;
    let n = 0;
    for (const id of voterIds) {
      if (!cat.voided.delete(id)) continue;
      const b = cat.ballots.get(id);
      if (!b) continue;
      for (const p of b) cat.counts[p] += 1;
      cat.ballotCount += 1;
      n += 1;
    }
    this._touch(false);
    return n;
  }

  /** Close every category whose deadline has passed. Returns their ids. */
  tick(now) {
    const closed = [];
    for (const cat of this.categories) {
      if (cat.phase === PHASE.OPEN && now >= cat.endsAt) {
        this._closeCat(cat, now);
        closed.push(cat.id);
      }
    }
    if (closed.length) this._touch(true);
    return closed;
  }

  setStage({ mode, categoryIds } = {}) {
    if (mode === 'auto') {
      this.stage = { mode: 'auto', categoryIds: [] };
    } else if (mode === 'pinned') {
      const sel = this._select(categoryIds);
      if (!sel.ok) return sel;
      if (sel.cats.length > LIMITS.maxCategories) return { ok: false, errors: ['Too many categories on stage.'] };
      this.stage = { mode: 'pinned', categoryIds: sel.cats.map((c) => c.id) };
    } else {
      return { ok: false, errors: ['mode must be "auto" or "pinned".'] };
    }
    this._touch(false);
    return { ok: true };
  }

  /**
   * Which categories the screen shows right now, in category order. Auto: every
   * open category; else the latest to close (with any that closed together);
   * else none — the lobby.
   */
  resolveStage() {
    if (this.stage.mode === 'pinned') {
      return this.categories.filter((c) => this.stage.categoryIds.includes(c.id)).map((c) => c.id);
    }
    const open = this.categories.filter((c) => c.phase === PHASE.OPEN);
    if (open.length) return open.map((c) => c.id);
    const closed = this.categories.filter((c) => c.phase === PHASE.CLOSED);
    if (!closed.length) return [];
    const latest = Math.max(...closed.map((c) => c.closedAt));
    return closed.filter((c) => c.closedAt >= latest - LIMITS.closedTogetherMs).map((c) => c.id);
  }

  /** Everything a phone needs — deliberately no counts. */
  phoneState() {
    return {
      listVersion: this.listVersion,
      categories: this.categories.map((c) => ({
        id: c.id, title: c.title, picks: c.picks, phase: c.phase, roundId: c.roundId, endsAt: c.endsAt,
      })),
    };
  }

  /** One voter's ballots and voided categories, for GET /vote/me. */
  voterView(voterId) {
    const ballots = {};
    const voided = [];
    for (const c of this.categories) {
      const b = c.ballots.get(voterId);
      if (b) ballots[c.id] = { roundId: c.roundId, picks: b };
      if (c.voided.has(voterId)) voided.push(c.id);
    }
    return { ballots, voided };
  }

  /** The admin-only view the screen and admin page render (counts included). */
  screenState() {
    return {
      listVersion: this.listVersion,
      seeded: this.seeded,
      candidates: this.candidates,
      stage: { mode: this.stage.mode, pinned: this.stage.categoryIds, show: this.resolveStage() },
      categories: this.categories.map((c) => ({
        id: c.id,
        title: c.title,
        picks: c.picks,
        phase: c.phase,
        roundId: c.roundId,
        endsAt: c.endsAt,
        closedAt: c.closedAt,
        durationMs: c.durationMs,
        ballotCount: c.ballotCount,
        voidedCount: c.voided.size,
        counts: c.counts,
      })),
      feed: this.feed,
      totalBallots: this.categories.reduce((s, c) => s + c.ballotCount, 0),
    };
  }

  _newCategory() {
    const cat = {
      id: `c${this._nextCat++}`,
      title: '',
      picks: 0,
      phase: PHASE.SETUP,
      roundId: 0,
      endsAt: null,
      closedAt: null,
      durationMs: null,
      ballots: new Map(),
      voided: new Set(),
      counts: [],
      ballotCount: 0,
      rev: 0, // bumps whenever this category's ballots change — the fraud scan's dirty flag
    };
    this._clear(cat);
    return cat;
  }

  // Ballots gone, back to setup. roundId is NOT reset: it only ever grows, so a
  // phone holding an old round can always be told it's stale.
  _clear(cat) {
    cat.phase = PHASE.SETUP;
    cat.endsAt = null;
    cat.closedAt = null;
    cat.ballots = new Map();
    cat.voided = new Set();
    cat.counts = new Array(this.candidates.length).fill(0);
    cat.ballotCount = 0;
    cat.rev += 1;
    this.feed = this.feed.filter((e) => e.categoryId !== cat.id);
  }

  _closeCat(cat, now) {
    cat.phase = PHASE.CLOSED;
    cat.closedAt = now;
    cat.endsAt = Math.min(cat.endsAt, now);
  }

  _select(categoryIds) {
    if (!Array.isArray(categoryIds) || categoryIds.length === 0) {
      return { ok: false, errors: ['Pick at least one category.'] };
    }
    const cats = [];
    for (const id of new Set(categoryIds)) {
      const cat = this.categories.find((c) => c.id === id);
      if (!cat) return { ok: false, errors: [`Unknown category: ${String(id).slice(0, 20)}`] };
      cats.push(cat);
    }
    return { ok: true, cats };
  }

  _pushFeed(categoryId, candidateId, now) {
    this.feed.push({ seq: ++this._feedSeq, categoryId, candidateId, at: now });
    if (this.feed.length > LIMITS.feedSize) this.feed.shift();
  }

  _touch(phone) {
    this.version += 1;
    if (phone) this.phoneVersion += 1;
  }
}
