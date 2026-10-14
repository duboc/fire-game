import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

// 31 symbols: no 0/O, 1/I/L — a code read off a projector from the back row
// must not hinge on telling those apart.
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const GUARD_DEFAULTS = Object.freeze({
  epochMs: 30_000, // the room code rotates this often; accepted for 2 epochs
  codeLength: 5,
  // Wrong codes per IP per window before a block. A whole venue shares one NAT
  // address, so this sits far above anything a room produces — and guessing
  // one of 2 live codes in 31^5 at 600/min still takes weeks per IP.
  failLimit: 600,
  failWindowMs: 60_000,
  failBlockMs: 60_000,
  expiredEpochs: 10, // codes this many epochs old answer "expired" and never count as failures
  minSubmitGapMs: 1000, // per device per category
  maxSubmitsPerRound: 30,
  maxDevices: 20_000, // memory bound against a script minting devices
  clusterMin: 5, // identical ballots from one (IP, UA, entry window)
  burstMinVotes: 20,
  burstWindowMs: 10_000,
  burstShare: 0.6,
  cookieMaxAgeMs: 12 * 3600_000,
});

const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const shortHash = (s) => createHash('sha1').update(s).digest('base64url').slice(0, 12);

/**
 * Live Vote anti-fraud — see docs/VOTE_SPEC.md, "Anti-fraud". Pure with respect
 * to time (every check takes `now`) and independent of the engine: `detect`
 * reads the engine's categories but never writes to them.
 *
 * Layers: a rotating room code proves presence; a signed HttpOnly cookie makes
 * the device the unit of voting; per-device limits slow scripts; and the
 * patterns that might be fraud are *flagged* for a human, never auto-blocked —
 * a real event is hundreds of identical phones behind one NAT IP.
 */
export class VoteGuard {
  constructor(opts = {}) {
    this.o = { ...GUARD_DEFAULTS, ...defined(opts) };
    // Random per boot: a restart wipes every ballot anyway, so invalidating
    // every cookie with it costs nothing and needs no secret plumbing.
    this.secret = opts.secret ?? randomBytes(32);
    this.entryOpen = true;
    this.devices = new Map(); // voterId -> {ip, ua, enteredAt}
    this.failures = new Map(); // ip -> {count, since, blockedUntil}
    this.submits = new Map(); // `${voterId}|${categoryId}|${roundId}` -> {last, n}
    this.recent = new Map(); // categoryId -> [{at, voterId, added, picks}]
    this.flags = new Map(); // flagId -> flag
    this.flagsVersion = 0;
    // categoryId -> {roundId, rev, noted, members: Map<group, Set<voterId>>, dirty: Set<group>}
    // — lets the 1 Hz scan look only at groups that gained a ballot.
    this.clusters = new Map();
  }

  // ---- room code -----------------------------------------------------------

  codeFor(epoch) {
    const h = createHmac('sha256', this.secret).update(`room:${epoch}`).digest();
    let code = '';
    for (let i = 0; i < this.o.codeLength; i++) code += CODE_ALPHABET[h[i] % CODE_ALPHABET.length];
    return code;
  }

  roomCode(now) {
    return this.codeFor(Math.floor(now / this.o.epochMs));
  }

  codeRotatesAt(now) {
    return (Math.floor(now / this.o.epochMs) + 1) * this.o.epochMs;
  }

  /** Current or previous epoch's code, so a code lives 1–2 epochs. */
  checkCode(code, now) {
    const c = String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c.length !== this.o.codeLength) return false;
    const epoch = Math.floor(now / this.o.epochMs);
    const given = Buffer.from(c);
    return [epoch, epoch - 1].some((e) => timingSafeEqual(given, Buffer.from(this.codeFor(e))));
  }

  /** A real code from the last few minutes — a stale photo or a slow typist, not a guess. */
  isExpiredCode(code, now) {
    const c = String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c.length !== this.o.codeLength) return false;
    const epoch = Math.floor(now / this.o.epochMs);
    for (let e = epoch - 2; e >= epoch - this.o.expiredEpochs; e--) if (c === this.codeFor(e)) return true;
    return false;
  }

  isBlocked(ip, now) {
    const f = this.failures.get(ip);
    return !!f && f.blockedUntil > now;
  }

  recordFailure(ip, now) {
    let f = this.failures.get(ip);
    if (!f || now - f.since > this.o.failWindowMs) f = { count: 0, since: now, blockedUntil: 0 };
    f.count += 1;
    if (f.count >= this.o.failLimit) f.blockedUntil = now + this.o.failBlockMs;
    this.failures.set(ip, f);
    if (this.failures.size > 10_000) {
      for (const [k, v] of this.failures) {
        if (v.blockedUntil <= now && now - v.since > this.o.failWindowMs) this.failures.delete(k);
      }
    }
  }

  // ---- devices -------------------------------------------------------------

  /**
   * Admit a device. An already-valid cookie short-circuits everything — a
   * device that's in stays in, even with an old code or entry closed. Only
   * *wrong codes* count toward the per-IP throttle: a whole venue enters from
   * one NAT address, so successful entries are never limited per IP.
   */
  enter({ code, existing, ip, ua, now }) {
    const already = this.verify(existing);
    if (already) return { ok: true, voterId: already, cookie: existing, already: true };
    if (this.isBlocked(ip, now)) return { ok: false, reason: 'throttled' };
    if (!this.checkCode(code, now)) {
      if (this.isExpiredCode(code, now)) return { ok: false, reason: 'expired' };
      this.recordFailure(ip, now);
      return { ok: false, reason: 'bad_code' };
    }
    if (!this.entryOpen) return { ok: false, reason: 'entry_closed' };
    if (this.devices.size >= this.o.maxDevices) return { ok: false, reason: 'full' };
    const voterId = randomUUID();
    const dev = { ip: String(ip ?? ''), ua: String(ua ?? '').slice(0, 300), enteredAt: now };
    // The cluster group (network + browser + entry window), hashed once here
    // so the 1 Hz scan joins a 12-char key instead of rebuilding ~200 chars.
    dev.group = shortHash(`${dev.ip}|${dev.ua}|${Math.floor(now / this.o.epochMs)}`);
    this.devices.set(voterId, dev);
    return { ok: true, voterId, cookie: this.sign(voterId), already: false };
  }

  _mac(voterId) {
    return createHmac('sha256', this.secret).update(`voter:${voterId}`).digest('base64url').slice(0, 32);
  }

  sign(voterId) {
    return `${voterId}.${this._mac(voterId)}`;
  }

  /** The voter id inside a cookie value, or null if forged, tampered or unknown. */
  verify(value) {
    if (typeof value !== 'string' || value.length > 200) return null;
    const dot = value.lastIndexOf('.');
    if (dot <= 0) return null;
    const id = value.slice(0, dot);
    const mac = Buffer.from(value.slice(dot + 1));
    const want = Buffer.from(this._mac(id));
    if (mac.length !== want.length || !timingSafeEqual(mac, want)) return null;
    return this.devices.has(id) ? id : null;
  }

  cookieHeader(value, secure) {
    return (
      `tv_voter=${value}; Path=/vote; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(this.o.cookieMaxAgeMs / 1000)}` +
      (secure ? '; Secure' : '')
    );
  }

  setEntry(open) {
    this.entryOpen = !!open;
  }

  // ---- submit limits -------------------------------------------------------

  allowSubmit(voterId, categoryId, roundId, now) {
    const key = `${voterId}|${categoryId}|${roundId}`;
    const s = this.submits.get(key) ?? { last: -Infinity, n: 0 };
    if (now - s.last < this.o.minSubmitGapMs) return { ok: false, reason: 'too_fast' };
    if (s.n >= this.o.maxSubmitsPerRound) return { ok: false, reason: 'too_many' };
    s.last = now;
    s.n += 1;
    if (this.submits.size > 200_000) this.submits.clear(); // bound; worst case resets a few limits
    this.submits.set(key, s);
    return { ok: true };
  }

  /**
   * Called after a ballot actually changed. Everything the 1 Hz scan needs is
   * updated here, incrementally, so the scan's cost tracks new ballots rather
   * than the size of the room (SCALE.md finding 7).
   */
  noteSubmit(categoryId, voterId, added, picks, now) {
    const w = this._window(categoryId);
    w.list.push({ at: now, voterId, added, picks });
    for (const p of added) w.gains.set(p, (w.gains.get(p) ?? 0) + 1);
    for (const p of picks) w.share.set(p, (w.share.get(p) ?? 0) + 1);
    this._expire(w, now);
    const st = this.clusters.get(categoryId);
    if (st) {
      st.noted += 1;
      this._place(st, voterId, picks);
    }
  }

  // ---- burst window: running counts over the last burstWindowMs -------------

  _window(categoryId) {
    let w = this.recent.get(categoryId);
    if (!w) this.recent.set(categoryId, (w = { list: [], head: 0, gains: new Map(), share: new Map() }));
    return w;
  }

  _expire(w, now) {
    while (w.head < w.list.length && now - w.list[w.head].at > this.o.burstWindowMs) {
      const e = w.list[w.head++];
      for (const p of e.added) w.gains.set(p, w.gains.get(p) - 1);
      for (const p of e.picks) w.share.set(p, w.share.get(p) - 1);
    }
    if (w.head > 1024 && w.head * 2 > w.list.length) {
      w.list = w.list.slice(w.head);
      w.head = 0;
    }
  }

  // ---- cluster buckets: (device group, exact ballot) -> voters ---------------

  // Move a voter into the bucket for their group + current ballot. Leaving a
  // bucket never needs a re-check (shrinking can't raise a flag); joining one does.
  _place(st, voterId, picks) {
    const group = this.devices.get(voterId)?.group;
    if (!group) return;
    const key = `${group}|${picks.join(',')}`;
    const old = st.keyOf.get(voterId);
    if (old === key) return;
    if (old) st.buckets.get(old)?.voterIds.delete(voterId);
    let b = st.buckets.get(key);
    if (!b) st.buckets.set(key, (b = { voterIds: new Set(), picks }));
    b.voterIds.add(voterId);
    st.keyOf.set(voterId, key);
    st.dirty.add(key);
  }

  // The category's cluster state, rebuilt from its ballots whenever it is out
  // of step: a new round, or ballots that changed without a noteSubmit (every
  // change bumps cat.rev; every noted one bumps st.noted).
  _clusterState(cat) {
    let st = this.clusters.get(cat.id);
    if (!st || st.roundId !== cat.roundId || st.rev + st.noted !== cat.rev) {
      st = { roundId: cat.roundId, rev: cat.rev, noted: 0, buckets: new Map(), keyOf: new Map(), dirty: new Set() };
      for (const [voterId, picks] of cat.ballots) this._place(st, voterId, picks);
      this.clusters.set(cat.id, st);
    }
    return st;
  }

  // ---- flags ---------------------------------------------------------------

  /**
   * Scan the engine's categories for suspicious patterns (run at 1 Hz). Returns
   * the voters newly caught by a flag the admin already voided, so the caller
   * can void them too — the admin decided that group is fraud.
   */
  detect(categories, now) {
    const autoVoid = [];
    for (const cat of categories) {
      // Clusters: identical ballots from one (IP, user-agent, entry window).
      // Only buckets that gained a voter since the last scan are looked at.
      const st = this._clusterState(cat);
      for (const key of st.dirty) {
        const b = st.buckets.get(key);
        if (!b || b.voterIds.size < this.o.clusterMin) continue;
        const id = `cl:${cat.id}:${cat.roundId}:${shortHash(key)}`;
        // A cluster is one narrow group — same network, browser, entry window
        // AND identical ballot — so a newcomer to a voided one is that group.
        const fresh = this._upsert(id, {
          kind: 'cluster',
          categoryId: cat.id,
          roundId: cat.roundId,
          candidateIds: b.picks,
          weak: cat.picks === 1,
          at: now,
        }, [...b.voterIds], true);
        if (fresh.length) autoVoid.push({ categoryId: cat.id, voterIds: fresh });
      }
      st.dirty.clear();

      // Bursts: one candidate gaining fast while dominating recent ballots.
      // Running counts make the check O(candidates); the window is only walked
      // to collect voters when a burst is actually on.
      const w = this.recent.get(cat.id);
      if (!w) continue;
      this._expire(w, now);
      const size = w.list.length - w.head;
      if (!size) continue;
      for (const [p, gained] of w.gains) {
        if (gained < this.o.burstMinVotes || w.share.get(p) / size < this.o.burstShare) continue;
        const voters = [];
        for (let i = w.head; i < w.list.length; i++) if (w.list[i].added.includes(p)) voters.push(w.list[i].voterId);
        const id = `bu:${cat.id}:${cat.roundId}:${p}`;
        // Never auto-voided: a burst is keyed by candidate alone, so later
        // voters for a popular name are not "the same group". The admin sees
        // them as newSinceVoid and decides.
        this._upsert(id, {
          kind: 'burst',
          categoryId: cat.id,
          roundId: cat.roundId,
          candidateIds: [p],
          gained: voters.length,
          sharePct: Math.round((w.share.get(p) / size) * 100),
          at: now,
        }, voters, false);
      }
    }
    return autoVoid;
  }

  // Create or grow a flag. Members only ever accumulate, so voiding a flag
  // and the group later shifting can never quietly un-void someone. Returns
  // the newcomers to void when `autoVoid` and the flag is already voided.
  _upsert(id, info, voterIds, autoVoid) {
    let f = this.flags.get(id);
    if (!f) {
      f = { id, voided: false, voidedMembers: 0, voterIds: [], ...info };
      this.flags.set(id, f);
      this.flagsVersion += 1;
    }
    const have = new Set(f.voterIds);
    const fresh = voterIds.filter((v) => !have.has(v));
    if (fresh.length) {
      f.voterIds.push(...fresh);
      Object.assign(f, info);
      this.flagsVersion += 1;
    }
    if (!f.voided || !autoVoid) return [];
    f.voidedMembers += fresh.length;
    return fresh;
  }

  /**
   * Voters to un-void when restoring a flag: its members, minus anyone another
   * still-voided flag in the same category also caught.
   */
  restorable(flagId) {
    const f = this.flags.get(flagId);
    if (!f) return [];
    const held = new Set();
    for (const o of this.flags.values()) {
      if (o !== f && o.voided && o.categoryId === f.categoryId && o.roundId === f.roundId) {
        for (const v of o.voterIds) held.add(v);
      }
    }
    return f.voterIds.filter((v) => !held.has(v));
  }

  markVoided(flagId, voided) {
    const f = this.flags.get(flagId);
    if (!f) return false;
    f.voided = !!voided;
    f.voidedMembers = f.voided ? f.voterIds.length : 0;
    this.flagsVersion += 1;
    return true;
  }

  /** Flags for each category's *current* round, newest first, safe to show the admin. */
  listFlags(categories) {
    const current = new Map(categories.map((c) => [c.id, c.roundId]));
    const out = [];
    for (const f of this.flags.values()) {
      if (current.get(f.categoryId) !== f.roundId) continue;
      const { voterIds, voidedMembers, ...rest } = f;
      out.push({ ...rest, devices: voterIds.length, newSinceVoid: f.voided ? voterIds.length - voidedMembers : 0 });
    }
    return out.sort((a, b) => b.at - a.at);
  }
}

/**
 * The client address as Google's front end saw it: the rightmost
 * X-Forwarded-For entry (the one the GFE appended), never a client-supplied
 * value further left. Falls back to the socket for local runs.
 */
export function clientIp(xff, remoteAddress) {
  if (typeof xff === 'string') {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return String(remoteAddress ?? '');
}

/**
 * Same-origin check for state-changing requests. Browsers send Sec-Fetch-Site
 * (or at least Origin) on every cross-site POST, so a hostile page is caught
 * here; a request with neither isn't a browser CSRF and still needs the cookie.
 */
export function sameOrigin(headers) {
  const site = headers['sec-fetch-site'];
  if (site) return site === 'same-origin';
  const origin = headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === headers.host;
  } catch {
    return false;
  }
}
