# Live Vote Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Live Vote — room-locked, multi-category, exactly-N voting with a spectacular phone search and a live big screen — as a third app inside the existing Tap Race server.

**Architecture:** Three pure, time-injected modules (`public/vote/search.js` shared with the browser, `src/vote.js` engine, `src/vote-guard.js` anti-fraud) wired into `src/server.js` next to Tap Race and Sequência: same 100 ms tick, same admin session, an admin-only SSE stream for screen + admin, and one precompressed shared buffer that every phone polls. Three static pages under `public/vote/`.

**Tech Stack:** Node ≥ 20 (ESM), Express 4, `qrcode` (already a dependency), `node:test`, Playwright (already a devDependency). No new dependencies.

**Spec:** `docs/VOTE_SPEC.md` — read it before any task. This plan argues from it.

## Global Constraints

- No new dependencies. ESM only. Node ≥ 20.
- English UI. Copy strings are taken verbatim from the spec where the spec quotes them.
- Names: 2–300 per list, each 1–60 chars after whitespace collapse; duplicates after accent/case folding are rejected, never silently fixed.
- Categories: 1–6; title 1–60 chars; N ("pick exactly") 1–min(10, names), default 3.
- Duration: 30 s – 4 h, default 3 min (`180000` ms). Presets 1 · 2 · 3 · 5 · 10 min.
- Room code: 5 chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, rotates every 30 s, accepted for the current and previous epoch.
- Wrong codes: 20 per IP per minute, then 429 for 60 s. Successful entries are never limited per IP.
- Per device per category: ≤ 1 submit/s, ≤ 30 per round. Device cap: 20.000.
- Flags: cluster = ≥ 5 identical ballots from one (IP, user-agent, entry window); burst = ≥ 20 gains in 10 s at ≥ 60 % of that window's ballots. Flag, never auto-block.
- **Phones never receive counts.** `/vote/events` is admin-session only.
- One clock: the existing 100 ms `tickTimer` drives Live Vote. No new intervals.
- Additive only: Tap Race and Sequência routes, pages and checks must be untouched and stay green.
- Follow existing server patterns: `precompress`, `readCookie`, `sessionOk`, `checkAdmin`, `etagMatches`, `numEnv`.
- Commits: small, one logical change, **no AI attribution of any kind** (repo owner's rule).

## Review Focus

These are the inputs the spec implies but doesn't spell out — the ones most likely to bite someone on the day. Each has a test in the owning task.

1. **A ballot that lands after the deadline but before the next tick** (slow venue wifi, phase still `open`) must be refused as `closed`, and the phone must say plainly the picks didn't count — never show "Submitted ✓". Tests: Task 2 (`submit refuses at the deadline even before tick runs…`), Task 5 (deadline check).
2. **The admin edits the list between rounds while a phone holds a draft** — picks must follow the *name*, not the index (ids are positions). Tests: Task 1 (`remapPicks…`), Task 4 (`stale_list` → 409 with fresh state), Task 5 drafts store names.
3. **A restart or redeploy mid-event** — cookies die with the per-boot secret, and `listVersion`/`roundId` restart at 1. The phone must re-gate cleanly, drop drafts from the old boot, and never trust a cached name list from before. Tests: Task 4 (`restart` section; candidates ETag includes the boot id), Task 5 (drafts keyed by `boot`).
4. **Double-tapping Submit** — the second request would hit `too_fast`. The phone must not show an error when the first one succeeded. Test: Task 5 (`dblclick` on Submit).
5. **60-character names on a 360 px phone** — no horizontal scroll, names wrap (max 2 lines), chips truncate. Test: Task 5 (360 px overflow check with a 60-char name configured).

---

## File Structure

| File | Responsibility |
|---|---|
| `public/vote/search.js` (create) | Pure shared logic: folding, ranked search, highlights, suggestions, A–Z letter, pick remapping by name, competition ranking. Loaded by phone, admin, screen, engine and tests. |
| `src/vote.js` (create) | Engine: names, categories, per-category phase machines, ballots, void/restore, stage, phone/screen views. |
| `src/vote-seed.js` (create) | 120 sample names + 5 sample categories. |
| `src/vote-guard.js` (create) | Anti-fraud: room codes, device cookies, throttles, submit limits, flags; `clientIp`, `sameOrigin`. |
| `src/server.js` (modify) | Wiring: construction, body limit for config, routes, admin SSE, phone live buffer, tick hook, shutdown, startup banner, exports. |
| `scripts/vote-check.mjs` (create) | HTTP contract (Task 4) + browser checks appended by Tasks 5–7. |
| `public/vote/phone.html` (create) | `/vote` — gate, category home, ballot with search + tray. |
| `public/vote/screen.html` (create) | `/vote/screen` — lobby, adaptive stage, QR rail, feed, podium + confetti. |
| `public/vote/admin.html` (create) | `/vote/admin` — setup, control board, stage, entry, fraud panel, results + CSV. |
| `test/vote-search.test.js`, `test/vote.test.js`, `test/vote-guard.test.js` (create) | Unit tests, picked up by the existing `npm test` (`node --test`). |
| `package.json`, `README.md`, `PLAN.md`, `docs/VOTE_SPEC.md` (modify) | `check:vote` script, docs, checklist, two spec clarifications. |

---

### Task 1: Shared search + ranking module

**Files:**
- Create: `public/vote/search.js`
- Test: `test/vote-search.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces (all named exports of `public/vote/search.js`):
  - `fold(str) → {text, start[], end[]}`
  - `osa(a, b) → number`
  - `letterOf(name) → 'A'..'Z' | '#'`
  - `buildIndex(candidates: {id, name}[]) → Entry[]`
  - `search(index, query) → {id, name, tier: 0..5, ranges: [start, end][]}[]` (empty query → all, alphabetical, tier 0)
  - `suggest(index, query, n = 3) → {id, name}[]`
  - `remapPicks(oldCandidates, newCandidates, pickIds) → number[]`
  - `rankCounts(candidates, counts) → {id, name, votes, rank}[]`

- [ ] **Step 1: Write the failing test** — create `test/vote-search.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fold, osa, letterOf, buildIndex, search, suggest, remapPicks, rankCounts,
} from '../public/vote/search.js';

const NAMES = [
  'Ana Souza', 'João Pedro Silva', "Lucas D'Ávila", 'Mariana Costa', 'Bruno Lima',
  'Anabela Rocha', 'Carla Dias', 'Élio Santos', 'Mariane Alves', 'Zoë Ribeiro',
];
const CANDS = NAMES.map((name, id) => ({ id, name }));
const IDX = buildIndex(CANDS);
const names = (results) => results.map((r) => r.name);
// The highlighted characters, in order, exactly as they appear in the name.
const marked = (r) => r.ranges.map(([s, e]) => r.name.slice(s, e)).join('|');

test('fold strips accents, lowercases, collapses punctuation, maps back to the original', () => {
  assert.equal(fold('João').text, 'joao');
  assert.equal(fold("Lucas D'Ávila").text, 'lucas d avila');
  assert.equal(fold('  Zoë   Ribeiro ').text, 'zoe ribeiro');
  assert.equal(fold('Straße').text, 'strasse');
  const f = fold('Élio');
  assert.deepEqual([f.start[0], f.end[0]], [0, 1]); // 'e' came from 'É'
});

test('osa counts an adjacent transposition as one edit', () => {
  assert.equal(osa('suoza', 'souza'), 1);
  assert.equal(osa('mariane', 'mariana'), 1);
  assert.equal(osa('abc', 'abc'), 0);
  assert.equal(osa('', 'abc'), 3);
});

test('empty query lists everyone alphabetically, accents ignored', () => {
  const r = search(IDX, '   ');
  assert.equal(r.length, NAMES.length);
  assert.deepEqual(names(r).slice(0, 4), ['Ana Souza', 'Anabela Rocha', 'Bruno Lima', 'Carla Dias']);
  assert.equal(r.find((x) => x.name === 'Élio Santos') !== undefined, true);
  assert.ok(names(r).indexOf('Élio Santos') < names(r).indexOf('João Pedro Silva'));
});

test('tier 1: full-name prefix, shorter name first', () => {
  const r = search(IDX, 'ana');
  assert.deepEqual(names(r).slice(0, 2), ['Ana Souza', 'Anabela Rocha']);
  assert.equal(r[0].tier, 1);
  assert.equal(marked(search(IDX, 'ana s')[0]), 'Ana S');
});

test('accent-insensitive with the highlight on the accented original', () => {
  const r = search(IDX, 'joao');
  assert.equal(r[0].name, 'João Pedro Silva');
  assert.equal(marked(r[0]), 'João');
  assert.equal(marked(search(IDX, 'elio')[0]), 'Élio');
});

test('tier 2: every word prefixes a different name word, any order', () => {
  const r = search(IDX, 'souza ana');
  assert.equal(r[0].name, 'Ana Souza');
  assert.equal(r[0].tier, 2);
  assert.equal(marked(r[0]), 'Ana|Souza');
  assert.equal(search(IDX, 'sou an')[0].name, 'Ana Souza');
});

test('tier 3: initials', () => {
  const r = search(IDX, 'jps');
  assert.equal(r[0].name, 'João Pedro Silva');
  assert.equal(r[0].tier, 3);
  assert.equal(marked(r[0]), 'J|P|S');
});

test('tier 4: substring, including across a word break', () => {
  const r = search(IDX, 'uza');
  assert.equal(r[0].name, 'Ana Souza');
  assert.equal(r[0].tier, 4);
  const d = search(IDX, 'davila');
  assert.equal(d[0].name, "Lucas D'Ávila");
  assert.equal(marked(d[0]), 'D|Ávila');
});

test('tier 5: typo-tolerant, ranked below exact matches', () => {
  const r = search(IDX, 'suoza');
  assert.equal(r[0].name, 'Ana Souza');
  assert.equal(r[0].tier, 5);
  const m = search(IDX, 'mariane');
  assert.deepEqual(names(m).slice(0, 2), ['Mariane Alves', 'Mariana Costa']);
  assert.equal(m[1].tier, 5);
});

test('a one-letter query only matches word starts, not every name containing it', () => {
  assert.deepEqual(names(search(IDX, 'z')), ['Zoë Ribeiro']);
});

test('nothing matches → empty list; suggest offers the closest names', () => {
  assert.deepEqual(search(IDX, 'xyzw'), []);
  const s = suggest(IDX, 'bruuno lmia');
  assert.equal(s[0].name, 'Bruno Lima');
  assert.ok(s.length <= 3);
  assert.deepEqual(suggest(IDX, 'qq'), []);
});

test('letterOf files accents under their base letter and non-letters under #', () => {
  assert.equal(letterOf('Élio Santos'), 'E');
  assert.equal(letterOf("'Bia"), 'B');
  assert.equal(letterOf('123 Team'), '#');
});

test('remapPicks carries picks by name and drops removed names', () => {
  const before = [{ id: 0, name: 'Ana' }, { id: 1, name: 'Bruno' }, { id: 2, name: 'Carla' }];
  const after = [{ id: 0, name: 'Bruno' }, { id: 1, name: 'Carla' }, { id: 2, name: 'Dan' }];
  assert.deepEqual(remapPicks(before, after, [0, 1, 2]), [0, 1]);
});

test('rankCounts: votes desc, name asc, competition ranking on ties', () => {
  const cands = [{ id: 0, name: 'Cid' }, { id: 1, name: 'Ana' }, { id: 2, name: 'Bea' }, { id: 3, name: 'Dan' }];
  const r = rankCounts(cands, [5, 5, 2, 0]);
  assert.deepEqual(r.map((x) => [x.name, x.rank]), [['Ana', 1], ['Cid', 1], ['Bea', 3], ['Dan', 4]]);
});

test('search over 300 names stays well under a frame', () => {
  const many = Array.from({ length: 300 }, (_, id) => ({ id, name: `Person ${id} Example${id % 17}` }));
  const idx = buildIndex(many);
  const t0 = performance.now();
  for (const q of ['p', 'pe', 'per', 'exampel', 'person 12', 'p1e']) search(idx, q);
  assert.ok(performance.now() - t0 < 50);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test test/vote-search.test.js`
Expected: FAIL — `Cannot find module '…/public/vote/search.js'`.

- [ ] **Step 3: Implement** — create `public/vote/search.js`:

```js
// Live Vote search — pure, shared by /vote, /vote/admin, src/vote.js and
// test/vote-search.test.js. No DOM and no imports: it must load unchanged in a
// phone browser and under `node --test`. See docs/VOTE_SPEC.md, "Search".

// Letters that don't decompose under NFD but that people type as plain ASCII.
const EXPAND = { ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', ł: 'l', đ: 'd', þ: 'th', ı: 'i' };
const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * Fold for matching: accents stripped, lowercased, every run of punctuation or
 * whitespace collapsed to one space. `start[i]`/`end[i]` give the slice of the
 * ORIGINAL string that folded char i came from, so highlight ranges computed on
 * the folded text can be mapped back onto the name exactly as written.
 */
export function fold(str) {
  const s = String(str ?? '');
  let text = '';
  const start = [];
  const end = [];
  let pendingSpace = false;
  for (let i = 0; i < s.length; ) {
    const ch = String.fromCodePoint(s.codePointAt(i));
    const next = i + ch.length;
    const base = ch.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
    for (const raw of base) {
      const out = EXPAND[raw] ?? raw;
      if (!WORD_CHAR.test(out[0])) {
        pendingSpace = text.length > 0;
        continue;
      }
      if (pendingSpace) {
        // The separator itself: spans the original punctuation/whitespace, so a
        // highlight crossing it ("Ana S") stays one unbroken range.
        text += ' ';
        start.push(end[end.length - 1]);
        end.push(i);
        pendingSpace = false;
      }
      for (const o of out) {
        text += o;
        start.push(i);
        end.push(next);
      }
    }
    i = next;
  }
  return { text, start, end };
}

/** Optimal-string-alignment distance: Levenshtein plus adjacent transpositions. */
export function osa(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const d = Array.from({ length: m + 1 }, (_, i) => {
    const row = new Array(n + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

/** The A–Z header a name files under: its first folded letter, or '#'. */
export function letterOf(name) {
  const c = fold(name).text[0] ?? '';
  return c >= 'a' && c <= 'z' ? c.toUpperCase() : '#';
}

/** Build once per candidate list; every keystroke reuses it. */
export function buildIndex(candidates) {
  return candidates.map(({ id, name }) => {
    const f = fold(name);
    const words = [];
    const re = /\S+/g;
    let m;
    while ((m = re.exec(f.text))) words.push({ w: m[0], at: m.index });
    // The same text with the spaces taken out, plus where each char sits in
    // `f.text`, so "anasouza" and "davila" match across word breaks.
    let compact = '';
    const cpos = [];
    for (let i = 0; i < f.text.length; i++) {
      if (f.text[i] !== ' ') {
        compact += f.text[i];
        cpos.push(i);
      }
    }
    return { id, name, f, words, compact, cpos, initials: words.map((x) => x.w[0]).join('') };
  });
}

// Folded-text [from, to) → merged ranges on the original name.
function toRanges(entry, spans) {
  const out = [];
  for (const [a, b] of [...spans].sort((x, y) => x[0] - y[0])) {
    for (let i = a; i < b; i++) {
      const s = entry.f.start[i];
      const e = entry.f.end[i];
      if (e <= s) continue;
      const last = out[out.length - 1];
      if (last && s <= last[1]) last[1] = Math.max(last[1], e);
      else out.push([s, e]);
    }
  }
  return out;
}

const compactSpans = (entry, from, len) => {
  const spans = [];
  for (let k = from; k < from + len; k++) spans.push([entry.cpos[k], entry.cpos[k] + 1]);
  return spans;
};

// Assign every query word to a distinct name word it prefixes (any order).
// Backtracking, because greedy fails on e.g. ["a", "an"] vs ["ana", "alice"]
// — names have a handful of words, so this is effectively free.
function assignPrefixes(qWords, words, used = new Set(), k = 0) {
  if (k === qWords.length) return [];
  for (let i = 0; i < words.length; i++) {
    if (used.has(i) || !words[i].w.startsWith(qWords[k])) continue;
    used.add(i);
    const rest = assignPrefixes(qWords, words, used, k + 1);
    used.delete(i);
    if (rest) return [{ i, len: qWords[k].length }, ...rest];
  }
  return null;
}

const maxEdits = (len) => (len >= 8 ? 2 : len >= 4 ? 1 : 0);

// Distance from query word q to the best-matching prefix of name word w, or -1.
function fuzzyWord(q, w) {
  const max = maxEdits(q.length);
  if (max === 0) return w.startsWith(q) ? { d: 0, len: q.length } : null;
  let best = null;
  for (let L = Math.max(1, q.length - max); L <= Math.min(w.length, q.length + max); L++) {
    const d = osa(q, w.slice(0, L));
    if (d <= max && (!best || d < best.d)) best = { d, len: L };
  }
  return best;
}

function matchEntry(entry, q, qWords, qCompact) {
  const { f, words, compact, initials } = entry;
  if (f.text.startsWith(q)) return { tier: 1, pos: 0, edits: 0, spans: [[0, q.length]] };
  if (compact.startsWith(qCompact)) {
    return { tier: 1, pos: 0, edits: 0, spans: compactSpans(entry, 0, qCompact.length) };
  }
  const pre = assignPrefixes(qWords, words);
  if (pre) {
    const spans = pre.map(({ i, len }) => [words[i].at, words[i].at + len]);
    return { tier: 2, pos: Math.min(...spans.map((s) => s[0])), edits: 0, spans };
  }
  if (qWords.length === 1 && q.length >= 2 && initials.startsWith(q)) {
    const spans = words.slice(0, q.length).map((x) => [x.at, x.at + 1]);
    return { tier: 3, pos: 0, edits: 0, spans };
  }
  if (qCompact.length >= 2) {
    const at = f.text.indexOf(q);
    if (at >= 0) return { tier: 4, pos: at, edits: 0, spans: [[at, at + q.length]] };
    const cat = compact.indexOf(qCompact);
    if (cat >= 0) {
      return { tier: 4, pos: entry.cpos[cat], edits: 0, spans: compactSpans(entry, cat, qCompact.length) };
    }
  }
  if (qWords.some((w) => w.length >= 4)) {
    const used = new Set();
    const spans = [];
    let edits = 0;
    for (const qw of qWords) {
      let best = null;
      words.forEach((x, i) => {
        if (used.has(i)) return;
        const r = fuzzyWord(qw, x.w);
        if (r && (!best || r.d < best.d)) best = { ...r, i };
      });
      if (!best) return null;
      used.add(best.i);
      edits += best.d;
      spans.push([words[best.i].at, words[best.i].at + best.len]);
    }
    return { tier: 5, pos: Math.min(...spans.map((s) => s[0])), edits, spans };
  }
  return null;
}

const alpha = (a, b) => (a.f.text < b.f.text ? -1 : a.f.text > b.f.text ? 1 : 0);

/**
 * Ranked matches for `query`: [{id, name, tier, ranges}], best first. `ranges`
 * are [start, end) slices of `name` to highlight. An empty query returns every
 * candidate alphabetically (tier 0, no ranges).
 */
export function search(index, query) {
  const q = fold(query).text;
  if (!q) return [...index].sort(alpha).map((e) => ({ id: e.id, name: e.name, tier: 0, ranges: [] }));
  const qWords = q.split(' ');
  const qCompact = qWords.join('');
  const hits = [];
  for (const e of index) {
    const m = matchEntry(e, q, qWords, qCompact);
    if (m) hits.push({ e, m });
  }
  hits.sort(
    (a, b) =>
      a.m.tier - b.m.tier ||
      a.m.edits - b.m.edits ||
      a.m.pos - b.m.pos ||
      a.e.name.length - b.e.name.length ||
      alpha(a.e, b.e),
  );
  return hits.map(({ e, m }) => ({ id: e.id, name: e.name, tier: m.tier, ranges: toRanges(e, m.spans) }));
}

/** "Did you mean…?" — up to n names close to a query that matched nothing. */
export function suggest(index, query, n = 3) {
  const qc = fold(query).text.replace(/ /g, '');
  if (qc.length < 3) return [];
  const limit = Math.max(2, Math.floor(qc.length / 3));
  const scored = [];
  for (const e of index) {
    let d = osa(qc, e.compact.slice(0, qc.length + 2));
    for (let L = qc.length - 2; L <= qc.length + 1; L++) {
      if (L > 0) d = Math.min(d, osa(qc, e.compact.slice(0, L)));
    }
    for (const x of e.words) d = Math.min(d, osa(qc, x.w));
    if (d <= limit) scored.push({ e, d });
  }
  scored.sort((a, b) => a.d - b.d || alpha(a.e, b.e));
  return scored.slice(0, n).map(({ e }) => ({ id: e.id, name: e.name }));
}

/**
 * Carry picks across a list change by NAME, never by index: ids are positions in
 * the list, so after an edit the same id can mean a different person.
 */
export function remapPicks(oldCandidates, newCandidates, pickIds) {
  const byName = new Map(newCandidates.map((c) => [c.name, c.id]));
  const out = [];
  for (const id of pickIds) {
    const name = oldCandidates.find((c) => c.id === id)?.name;
    if (name !== undefined && byName.has(name)) out.push(byName.get(name));
  }
  return out;
}

/**
 * Standings for one category: [{id, name, votes, rank}], votes desc then name.
 * Competition ranking — two at 5 votes are both #1 and the next is #3.
 */
export function rankCounts(candidates, counts) {
  const rows = candidates.map((c) => ({ id: c.id, name: c.name, votes: counts[c.id] ?? 0 }));
  rows.sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  rows.forEach((r, i) => {
    r.rank = i > 0 && r.votes === rows[i - 1].votes ? rows[i - 1].rank : i + 1;
  });
  return rows;
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `node --test test/vote-search.test.js`
Expected: `ℹ pass 15`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add public/vote/search.js test/vote-search.test.js
git commit -m "Live Vote: shared search — folding, ranked tiers, highlights, suggestions"
```

---

### Task 2: Vote engine + seed

**Files:**
- Create: `src/vote.js`, `src/vote-seed.js`
- Test: `test/vote.test.js`

**Interfaces:**
- Consumes: `fold` from `public/vote/search.js` (Task 1).
- Produces:
  - `PHASE = {SETUP:'setup', OPEN:'open', CLOSED:'closed'}`, `LIMITS` (see code).
  - `new Vote({names, categories, minDurationMs?})` — throws on an invalid seed.
  - `configure({names, categories:[{id?, title, picks}]}) → {ok:true} | {ok:false, errors:string[]}`
  - `open(categoryIds, durationMs|undefined, now)`, `close(categoryIds, now)`, `reset(categoryIds)` → `{ok}` / `{ok:false, errors}`
  - `submit(voterId, {categoryId, roundId, listVersion, picks}, now) → {ok:true, ballot:number[], changed:boolean, added:number[]} | {ok:false, reason:'unknown_category'|'stale_list'|'closed'|'stale_round'|'voided'|'wrong_count'|'bad_picks'}`
  - `void(categoryId, voterIds) → number`, `restore(categoryId, voterIds) → number`
  - `tick(now) → closedCategoryIds[]`
  - `setStage({mode:'auto'} | {mode:'pinned', categoryIds})`, `resolveStage() → ids[]`
  - `phoneState() → {listVersion, categories:[{id,title,picks,phase,roundId,endsAt}]}` (no counts)
  - `voterView(voterId) → {ballots:{[catId]:{roundId,picks}}, voided:catId[]}`
  - `screenState() → {listVersion, candidates, stage:{mode,pinned,show}, categories:[{id,title,picks,phase,roundId,endsAt,closedAt,durationMs,ballotCount,voidedCount,counts}], feed:[{seq,categoryId,candidateId,at}], totalBallots}`
  - Properties read by the server/guard: `version`, `phoneVersion`, `listVersion`, `candidates`, `categories[i].{id, roundId, picks, ballots: Map, voided: Set}`.
  - `SEED_NAMES` (120), `SEED_CATEGORIES` (5 × `{title, picks:3}`) from `src/vote-seed.js`.

- [ ] **Step 1: Write the failing test** — create `test/vote.test.js`:

```js
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
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test test/vote.test.js`
Expected: FAIL — `Cannot find module '…/src/vote.js'`.

- [ ] **Step 3: Create the seed** — `src/vote-seed.js`:

```js
// Boot-time setup for Live Vote, so the app works the moment it starts. The
// admin replaces both from /vote/admin. Accents, apostrophes, multi-part and
// repeated first names are deliberate: they are what the search has to handle.
export const SEED_NAMES = Object.freeze([
  'Ana Souza', 'João Pedro Silva', "Lucas D'Ávila", 'Mariana Costa', 'Bruno Lima',
  'Carla Dias', 'Élio Santos', 'Zoë Ribeiro', 'Rafael Oliveira', 'Beatriz Almeida',
  'Gabriel Ferreira', 'Juliana Rocha', 'Thiago Martins', 'Camila Barbosa', 'Felipe Carvalho',
  'Larissa Gomes', 'Gustavo Pereira', 'Fernanda Ribas', 'Rodrigo Nunes', 'Patrícia Moreira',
  'Diego Cardoso', 'Letícia Araújo', 'Matheus Teixeira', 'Aline Correia', 'Vinícius Mendes',
  'Natália Pinto', 'Leonardo Castro', 'Isabela Fonseca', 'André Vieira', 'Renata Monteiro',
  'Marcelo Freitas', 'Tatiane Ramos', 'Eduardo Lopes', 'Priscila Azevedo', 'Henrique Duarte',
  'Vanessa Cunha', 'Ricardo Batista', 'Bianca Machado', 'Daniel Rezende', 'Luana Farias',
  'Paulo Siqueira', 'Gabriela Tavares', 'Fábio Moura', 'Sofia Andrade', 'Caio Medeiros',
  'Helena Brandão', 'Otávio Pires', 'Clara Bezerra', 'Samuel Coelho', 'Lívia Guimarães',
  'Igor Antunes', 'Yasmin Peixoto', 'Murilo Sales', 'Débora Xavier', 'Arthur Campos',
  'Raquel Morais', 'Enzo Prado', 'Manuela Leite', 'Hugo Barros', 'Alícia Matos',
  'Emma Müller', "Liam O'Connor", 'Noah Schmidt', 'Olivia Brown', 'Chloé Dubois',
  'Mateo García', 'Lucía Fernández', 'Hiroshi Tanaka', 'Yuki Sato', 'Priya Patel',
  'Arjun Sharma', 'Minh Nguyễn', 'Wei Zhang', 'Fatima Al-Sayed', 'Omar Haddad',
  'Ingrid Johansson', 'Lars Nielsen', 'Søren Madsen', 'Anouk de Vries', 'Giulia Romano',
  'Marco Bianchi', 'Aleksandra Nowak', 'Mikhail Ivanov', 'Zeynep Yılmaz', 'Kwame Mensah',
  'Amara Okafor', 'Thandiwe Dlamini', 'Diego Hernández', 'Valentina Russo', 'Sebastián Morales',
  'Isabelle Laurent', 'Théo Martin', 'Camille Bernard', 'Nicolás Torres', 'Martina Gómez',
  'Jonas Weber', 'Lea Fischer', 'Ana Luísa Pacheco', 'Anabela Rocha', 'Mariane Alves',
  'João Vitor Lacerda', 'Maria Eduarda Quintela', 'Pedro Henrique Salgado', 'Ana Clara Vasconcelos', 'Luiz Felipe Brito',
  'Maria Fernanda Godoy', 'Carlos Eduardo Paiva', 'Júlia Bittencourt', 'Rafaela Sampaio', 'Gonçalo Esteves',
  'Inês Magalhães', 'Tomás Figueiredo', 'Beatriz Couto', 'Kenji Watanabe', 'Mei Lin',
  'Sana Qureshi', 'Elif Demir', 'Nadia Benali', 'Oscar Lindqvist', 'Ruby Thompson',
]);

export const SEED_CATEGORIES = Object.freeze([
  { title: 'MVP of the Year', picks: 3 },
  { title: 'Most Helpful', picks: 3 },
  { title: 'Best Leader', picks: 3 },
  { title: 'Most Creative', picks: 3 },
  { title: 'Rising Star', picks: 3 },
]);
```

- [ ] **Step 4: Implement the engine** — `src/vote.js`:

```js
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
  constructor({ names, categories, minDurationMs } = {}) {
    // Overridable only so browser checks can watch a deadline pass in seconds.
    this.minDurationMs = minDurationMs ?? LIMITS.minDurationMs;
    this.candidates = []; // [{id, name}], id === index
    this.listVersion = 0;
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
```

- [ ] **Step 5: Run it and confirm it passes**

Run: `node --test test/vote.test.js`
Expected: `ℹ pass 19`, `ℹ fail 0`. Then `npm test` — every existing suite still passes.

- [ ] **Step 6: Commit**

```bash
git add src/vote.js src/vote-seed.js test/vote.test.js
git commit -m "Live Vote: engine — categories, exactly-N ballots, void/restore, stage"
```

---

### Task 3: Anti-fraud guard

**Files:**
- Create: `src/vote-guard.js`
- Test: `test/vote-guard.test.js`

**Interfaces:**
- Consumes: `Vote` (Task 2) in tests only; at runtime `detect` reads `categories[i].{id, roundId, picks, ballots}`.
- Produces:
  - `CODE_ALPHABET`, `GUARD_DEFAULTS`
  - `new VoteGuard({secret?, epochMs?, …GUARD_DEFAULTS overrides})`; `o` (resolved options), `entryOpen`, `devices: Map`, `flags: Map`, `flagsVersion`
  - `roomCode(now) → string`, `codeRotatesAt(now) → ms`, `checkCode(code, now) → bool`
  - `enter({code, existing, ip, ua, now}) → {ok:true, voterId, cookie, already} | {ok:false, reason:'throttled'|'bad_code'|'entry_closed'|'full'}`
  - `verify(cookieValue) → voterId | null`, `sign(voterId)`, `cookieHeader(value, secure) → string`, `setEntry(open)`
  - `allowSubmit(voterId, categoryId, roundId, now) → {ok} | {ok:false, reason:'too_fast'|'too_many'}`
  - `noteSubmit(categoryId, voterId, added, picks, now)`
  - `detect(categories, now) → [{categoryId, voterIds}]` (members to auto-void)
  - `restorable(flagId) → voterIds`, `markVoided(flagId, bool)`, `listFlags(categories) → flags without voterIds, with devices count`
  - `clientIp(xff, remoteAddress) → string`, `sameOrigin(headers) → bool`

- [ ] **Step 1: Write the failing test** — create `test/vote-guard.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VoteGuard, CODE_ALPHABET, clientIp, sameOrigin } from '../src/vote-guard.js';
import { Vote } from '../src/vote.js';

const SECRET = Buffer.from('test-secret-test-secret-test-sec');
const guard = (opts = {}) => new VoteGuard({ secret: SECRET, ...opts });
const enter = (g, now, extra = {}) =>
  g.enter({ code: g.roomCode(now), ip: '10.0.0.1', ua: 'UA', now, ...extra });

test('room code: 5 chars from the unambiguous alphabet, rotating every epoch', () => {
  const g = guard();
  const c = g.roomCode(0);
  assert.equal(c.length, 5);
  assert.ok([...c].every((ch) => CODE_ALPHABET.includes(ch)));
  assert.ok(!/[01OIL]/.test(CODE_ALPHABET));
  assert.equal(CODE_ALPHABET.length, 31);
  assert.equal(g.roomCode(29_999), c);
  assert.notEqual(g.roomCode(30_000), c);
  assert.equal(g.codeRotatesAt(12_345), 30_000);
});

test('a code is accepted for its epoch and the next one only (30–60 s), case/space-insensitive', () => {
  const g = guard();
  const c = g.roomCode(10_000);
  assert.equal(g.checkCode(c, 10_000), true);
  assert.equal(g.checkCode(` ${c.toLowerCase()} `, 10_000), true);
  assert.equal(g.checkCode(c, 59_999), true);
  assert.equal(g.checkCode(c, 60_000), false);
  assert.equal(g.checkCode('', 10_000), false);
  assert.equal(g.checkCode('ABC', 10_000), false);
});

test('a different secret yields different codes and rejects foreign cookies', () => {
  const a = guard();
  const b = new VoteGuard({ secret: Buffer.from('another-secret-another-secret-ab') });
  assert.notEqual(a.roomCode(0), b.roomCode(0));
  const r = enter(a, 0);
  assert.equal(b.verify(r.cookie), null);
});

test('enter mints a device with a signed cookie; tampering and unknown ids fail', () => {
  const g = guard();
  const r = enter(g, 0);
  assert.equal(r.ok, true);
  assert.equal(g.verify(r.cookie), r.voterId);
  assert.equal(g.verify(r.cookie.slice(0, -1) + (r.cookie.endsWith('A') ? 'B' : 'A')), null);
  assert.equal(g.verify(`someone-else.${r.cookie.split('.')[1]}`), null);
  assert.equal(g.verify(undefined), null);
  assert.equal(g.verify('x'.repeat(500)), null);
});

test('an entered device stays in: old code or closed entry do not matter', () => {
  const g = guard();
  const r = enter(g, 0);
  g.setEntry(false);
  const again = g.enter({ code: 'WRONG', existing: r.cookie, ip: '10.0.0.1', ua: 'UA', now: 999_999 });
  assert.deepEqual([again.ok, again.already, again.voterId], [true, true, r.voterId]);
  assert.equal(g.devices.size, 1);
});

test('entry lock refuses new devices even with a valid code', () => {
  const g = guard();
  g.setEntry(false);
  assert.equal(enter(g, 0).reason, 'entry_closed');
});

test('wrong codes are throttled per IP after 20 in a minute; right codes never count', () => {
  const g = guard();
  for (let i = 0; i < 100; i++) assert.equal(enter(g, 0).ok, true, 'a whole NAT can enter');
  for (let i = 0; i < 19; i++) g.enter({ code: 'ZZZZZ', ip: '1.1.1.1', ua: 'x', now: 1000 });
  assert.equal(g.enter({ code: 'ZZZZZ', ip: '1.1.1.1', ua: 'x', now: 1000 }).reason, 'bad_code');
  assert.equal(enter(g, 1000, { ip: '1.1.1.1' }).reason, 'throttled', 'blocked even with a right code');
  assert.equal(enter(g, 1000, { ip: '2.2.2.2' }).ok, true, 'other IPs unaffected');
  assert.equal(enter(g, 61_001, { ip: '1.1.1.1' }).ok, true, 'block lifts after a minute');
});

test('device cap', () => {
  const g = guard({ maxDevices: 2 });
  enter(g, 0);
  enter(g, 0);
  assert.equal(enter(g, 0).reason, 'full');
});

test('cookie header: HttpOnly, SameSite=Strict, scoped to /vote, Secure only on TLS', () => {
  const g = guard();
  assert.match(g.cookieHeader('v', false), /^tv_voter=v; Path=\/vote; HttpOnly; SameSite=Strict; Max-Age=43200$/);
  assert.match(g.cookieHeader('v', true), /; Secure$/);
});

test('submit limits: one per second and 30 per round, per device and category', () => {
  const g = guard();
  assert.equal(g.allowSubmit('a', 'c1', 1, 0).ok, true);
  assert.equal(g.allowSubmit('a', 'c1', 1, 999).reason, 'too_fast');
  assert.equal(g.allowSubmit('a', 'c2', 1, 999).ok, true, 'other categories are separate');
  let t = 1000;
  for (let i = 1; i < 30; i++, t += 1000) assert.equal(g.allowSubmit('a', 'c1', 1, t).ok, true);
  assert.equal(g.allowSubmit('a', 'c1', 1, t).reason, 'too_many');
  assert.equal(g.allowSubmit('a', 'c1', 2, t).ok, true, 'a new round starts fresh');
});

// A Vote with one open 3-pick category, plus a guard with devices entered.
function scene({ devices, sameUa = true, ballots }) {
  const v = new Vote({ names: ['A', 'B', 'C', 'D', 'E', 'F'], categories: [{ title: 'MVP', picks: 3 }] });
  const cat = v.categories[0];
  v.open([cat.id], undefined, 0);
  const g = guard();
  const ids = [];
  for (let i = 0; i < devices; i++) {
    const r = enter(g, 1000, { ua: sameUa ? 'iPhone' : `UA${i}` });
    ids.push(r.voterId);
    v.submit(r.voterId, { categoryId: cat.id, roundId: cat.roundId, listVersion: v.listVersion, picks: ballots(i) }, 2000);
  }
  return { v, g, cat, ids };
}

test('cluster: ≥5 identical ballots from one network+browser+entry window are flagged', () => {
  const { v, g, cat } = scene({ devices: 6, ballots: () => [0, 1, 2] });
  g.detect(v.categories, 3000);
  const flags = g.listFlags(v.categories);
  assert.equal(flags.length, 1);
  assert.deepEqual([flags[0].kind, flags[0].devices, flags[0].candidateIds, flags[0].weak], ['cluster', 6, [0, 1, 2], false]);
  assert.equal(flags[0].categoryId, cat.id);
  assert.equal('voterIds' in flags[0], false, 'voter ids never leave the server');
});

test('cluster: a diverse NAT group is NOT flagged', () => {
  const sets = [[0, 1, 2], [0, 1, 3], [0, 2, 4], [1, 3, 5], [2, 4, 5], [0, 3, 5], [1, 2, 4], [3, 4, 5]];
  const { v, g } = scene({ devices: 8, ballots: (i) => sets[i] });
  g.detect(v.categories, 3000);
  assert.equal(g.listFlags(v.categories).length, 0);
});

test('cluster: identical ballots from different browsers are NOT one group', () => {
  const { v, g } = scene({ devices: 6, sameUa: false, ballots: () => [0, 1, 2] });
  g.detect(v.categories, 3000);
  assert.equal(g.listFlags(v.categories).length, 0);
});

test('burst: ≥20 gains in 10 s while on ≥60% of that window’s ballots', () => {
  const g = guard();
  const cats = [{ id: 'c1', roundId: 1, picks: 3, ballots: new Map() }];
  for (let i = 0; i < 20; i++) g.noteSubmit('c1', `v${i}`, [4], [4, i % 3, 5], 1000 + i);
  for (let i = 0; i < 5; i++) g.noteSubmit('c1', `w${i}`, [1], [1, 2, 3], 1500);
  g.detect(cats, 2000);
  const f = g.listFlags(cats);
  assert.equal(f.length, 1);
  assert.deepEqual([f[0].kind, f[0].candidateIds, f[0].gained, f[0].sharePct], ['burst', [4], 20, 80]);
  g.detect(cats, 20_000);
  assert.equal(g.recent.get('c1').length, 0, 'the window slides');
});

test('void sticks: new members of an already-voided flag come back for auto-void', () => {
  const { v, g, cat } = scene({ devices: 5, ballots: () => [0, 1, 2] });
  g.detect(v.categories, 3000);
  const [flag] = g.listFlags(v.categories);
  g.markVoided(flag.id, true);
  const r = enter(g, 1000, { ua: 'iPhone' });
  v.submit(r.voterId, { categoryId: cat.id, roundId: cat.roundId, listVersion: v.listVersion, picks: [0, 1, 2] }, 4000);
  assert.deepEqual(g.detect(v.categories, 5000), [{ categoryId: cat.id, voterIds: [r.voterId] }]);
});

test('restorable skips voters another voided flag still holds', () => {
  const g = guard();
  g.flags.set('a', { id: 'a', categoryId: 'c1', roundId: 1, voided: true, voterIds: ['x', 'y'] });
  g.flags.set('b', { id: 'b', categoryId: 'c1', roundId: 1, voided: true, voterIds: ['y', 'z'] });
  assert.deepEqual(g.restorable('a'), ['x']);
});

test('flags from an earlier round of a category are hidden', () => {
  const { v, g, cat } = scene({ devices: 5, ballots: () => [0, 1, 2] });
  g.detect(v.categories, 3000);
  v.close([cat.id], 4000);
  v.open([cat.id], undefined, 5000);
  assert.equal(g.listFlags(v.categories).length, 0);
});

test('clientIp takes the rightmost X-Forwarded-For entry, else the socket', () => {
  assert.equal(clientIp('6.6.6.6, 203.0.113.9', '::1'), '203.0.113.9');
  assert.equal(clientIp('203.0.113.9', '::1'), '203.0.113.9');
  assert.equal(clientIp(undefined, '::1'), '::1');
  assert.equal(clientIp(' , ', '::1'), '::1');
});

test('sameOrigin: Sec-Fetch-Site wins, then Origin vs Host; no headers passes', () => {
  assert.equal(sameOrigin({ 'sec-fetch-site': 'same-origin' }), true);
  assert.equal(sameOrigin({ 'sec-fetch-site': 'cross-site' }), false);
  assert.equal(sameOrigin({ 'sec-fetch-site': 'same-site' }), false);
  assert.equal(sameOrigin({ origin: 'https://vote.example', host: 'vote.example' }), true);
  assert.equal(sameOrigin({ origin: 'https://evil.example', host: 'vote.example' }), false);
  assert.equal(sameOrigin({ origin: 'null', host: 'vote.example' }), false);
  assert.equal(sameOrigin({ host: 'vote.example' }), true);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test test/vote-guard.test.js`
Expected: FAIL — `Cannot find module '…/src/vote-guard.js'`.

- [ ] **Step 3: Implement** — `src/vote-guard.js`:

```js
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

// 31 symbols: no 0/O, 1/I/L — a code read off a projector from the back row
// must not hinge on telling those apart.
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const GUARD_DEFAULTS = Object.freeze({
  epochMs: 30_000, // the room code rotates this often; accepted for 2 epochs
  codeLength: 5,
  failLimit: 20, // wrong codes per IP per window before a block
  failWindowMs: 60_000,
  failBlockMs: 60_000,
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
      this.recordFailure(ip, now);
      return { ok: false, reason: 'bad_code' };
    }
    if (!this.entryOpen) return { ok: false, reason: 'entry_closed' };
    if (this.devices.size >= this.o.maxDevices) return { ok: false, reason: 'full' };
    const voterId = randomUUID();
    this.devices.set(voterId, { ip: String(ip ?? ''), ua: String(ua ?? '').slice(0, 300), enteredAt: now });
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

  /** Called after a ballot actually changed — feeds burst detection. */
  noteSubmit(categoryId, voterId, added, picks, now) {
    const list = this.recent.get(categoryId) ?? [];
    list.push({ at: now, voterId, added, picks });
    while (list.length && now - list[0].at > this.o.burstWindowMs) list.shift();
    this.recent.set(categoryId, list);
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
      const groups = new Map();
      for (const [voterId, picks] of cat.ballots) {
        const d = this.devices.get(voterId);
        if (!d) continue;
        const key = `${d.ip}|${d.ua}|${Math.floor(d.enteredAt / this.o.epochMs)}|${picks.join(',')}`;
        let g = groups.get(key);
        if (!g) groups.set(key, (g = { voterIds: [], picks }));
        g.voterIds.push(voterId);
      }
      for (const [key, g] of groups) {
        if (g.voterIds.length < this.o.clusterMin) continue;
        const id = `cl:${cat.id}:${cat.roundId}:${shortHash(key)}`;
        const fresh = this._upsert(id, {
          kind: 'cluster',
          categoryId: cat.id,
          roundId: cat.roundId,
          candidateIds: g.picks,
          weak: cat.picks === 1,
          at: now,
        }, g.voterIds);
        if (fresh.length) autoVoid.push({ categoryId: cat.id, voterIds: fresh });
      }

      // Bursts: one candidate gaining fast while dominating recent ballots.
      const win = (this.recent.get(cat.id) ?? []).filter((e) => now - e.at <= this.o.burstWindowMs);
      this.recent.set(cat.id, win);
      if (!win.length) continue;
      const gains = new Map();
      const share = new Map();
      for (const e of win) {
        for (const p of e.added) gains.set(p, [...(gains.get(p) ?? []), e.voterId]);
        for (const p of e.picks) share.set(p, (share.get(p) ?? 0) + 1);
      }
      for (const [p, voters] of gains) {
        if (voters.length < this.o.burstMinVotes || share.get(p) / win.length < this.o.burstShare) continue;
        const id = `bu:${cat.id}:${cat.roundId}:${p}`;
        const fresh = this._upsert(id, {
          kind: 'burst',
          categoryId: cat.id,
          roundId: cat.roundId,
          candidateIds: [p],
          gained: voters.length,
          sharePct: Math.round((share.get(p) / win.length) * 100),
          at: now,
        }, voters);
        if (fresh.length) autoVoid.push({ categoryId: cat.id, voterIds: fresh });
      }
    }
    return autoVoid;
  }

  // Create or grow a flag. Members only ever accumulate, so voiding a flag
  // and the group later shifting can never quietly un-void someone.
  _upsert(id, info, voterIds) {
    let f = this.flags.get(id);
    if (!f) {
      f = { id, voided: false, voterIds: [], ...info };
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
    return f.voided ? fresh : [];
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
    this.flagsVersion += 1;
    return true;
  }

  /** Flags for each category's *current* round, newest first, safe to show the admin. */
  listFlags(categories) {
    const current = new Map(categories.map((c) => [c.id, c.roundId]));
    const out = [];
    for (const f of this.flags.values()) {
      if (current.get(f.categoryId) !== f.roundId) continue;
      const { voterIds, ...rest } = f;
      out.push({ ...rest, devices: voterIds.length });
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
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `node --test test/vote-guard.test.js`
Expected: `ℹ pass 19`, `ℹ fail 0`. Then `npm test` — all green.

- [ ] **Step 5: Commit**

```bash
git add src/vote-guard.js test/vote-guard.test.js
git commit -m "Live Vote: anti-fraud — rotating room code, device cookie, limits, flags"
```

---

### Task 4: Server wiring + HTTP contract

**Files:**
- Modify: `src/server.js` (imports at the top; construction after the `batucada` constructor ~line 192; a route-scoped JSON parser just before `app.use(express.json({ limit: '8kb' }))` ~line 230; `precompress` list ~line 290; a new Live Vote section after the Sequência admin routes ~line 830; the `tickTimer` callback ~line 530; `shutdown`; the startup banner; the export line)
- Create: `scripts/vote-check.mjs`
- Modify: `package.json` (add `"check:vote": "node scripts/vote-check.mjs"`), `docs/VOTE_SPEC.md` (two clarifications, Step 6)

**Interfaces:**
- Consumes: `Vote`, `PHASE` (Task 2); `SEED_NAMES`, `SEED_CATEGORIES` (Task 2); `VoteGuard`, `clientIp`, `sameOrigin` (Task 3); existing `readCookie`, `sessionOk`, `checkAdmin`, `etagMatches`, `numEnv`, `precompress`, `ADMIN_COOKIE`, `zlib`, `randomBytes`.
- Produces (HTTP, used by the pages in Tasks 5–7):
  - `POST /vote/enter {code}` → 200 `{ok:true}` + `Set-Cookie: tv_voter=…` | 403 `{reason:'bad_code'|'entry_closed'|'full'|'cross_site'}` | 429 `{reason:'throttled'}`
  - `GET /vote/candidates` → `{listVersion, candidates}`; `ETag: "vl<boot>-<listVersion>"`, 304 on match
  - `GET /vote/live` → `{listVersion, categories, boot, entryOpen, pollMs}`; header `X-Server-Now`
  - `GET /vote/me` → `{entered, entryOpen, ballots, voided}`
  - `POST /vote/ballot {categoryId, roundId, listVersion, picks}` → 200 `{ok, ballot, live}` | 401 `not_entered` | 403 `voided`/`cross_site` | 409 `closed`/`stale_list`/`stale_round` (each with `live`) | 429 `too_fast`/`too_many` | 400 others. Header `X-Server-Now`.
  - `GET /vote/events` (admin session) → SSE frames: `screenState()` + `{now, code, codeRotatesAt, codeMs, entryOpen, devices, flags}`
  - `POST /vote/admin/{config,open,close,reset,stage,entry,void}` → 200 `{ok…}` | 400 `{ok:false, errors}` | 401
  - Env: `VOTE_CODE_MS` (code epoch), `VOTE_MIN_DURATION_MS` (test harnesses only)
  - `scripts/vote-check.mjs` exports nothing; its helpers `startServer`, `client`, `frame`, `ok`, `sleep` are reused by the browser sections Tasks 5–7 append.

- [ ] **Step 1: Write the failing contract check** — create `scripts/vote-check.mjs`:

```js
// Live Vote verification — docs/VOTE_SPEC.md, "Testing". Spawns its own
// servers on localhost. Part 1 is the HTTP contract; Tasks 5–7 of
// docs/VOTE_PLAN.md append the browser checks for each page.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { SEED_NAMES, SEED_CATEGORIES } from '../src/vote-seed.js';

const ROOT = new URL('..', import.meta.url).pathname;
const TOKEN = 'votetok';
const CODE_MS = 3000;
const SHOTS = '/tmp/vote-check';
mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
let fail = 0;
const ok = (c, m) => {
  if (c) { pass++; console.log('  ✔', m); } else { fail++; console.log('  ✘', m); }
};
const FORBIDDEN = ['counts', 'ballotCount', 'votes', 'code', 'flags'];
// Every key at any depth — "no counts on phones" is about structure, not text.
const keysDeep = (o, out = new Set()) => {
  if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { out.add(k); keysDeep(v, out); }
  return out;
};
const leaks = (o) => FORBIDDEN.filter((k) => keysDeep(o).has(k));

function startServer(port, env = {}) {
  const child = spawn(process.execPath, [ROOT + 'src/server.js'], {
    env: {
      ...process.env, PORT: String(port), ADMIN_TOKEN: TOKEN, VOTE_CODE_MS: String(CODE_MS),
      VOTE_MIN_DURATION_MS: '2000', NODE_ENV: 'test', HEARTBEAT_MS: '60000', ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  const ready = (async () => {
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`${base}/livez`)).ok) return; } catch { /* not up yet */ }
      await sleep(100);
    }
    throw new Error(`server on ${port} did not start:\n${log}`);
  })();
  return { child, ready, base, log: () => log };
}

// One simulated device: its own cookie jar, IP (via X-Forwarded-For — honoured
// because clientIp() takes the rightmost entry and there is no proxy locally)
// and user-agent.
function client(base, { ip, ua = 'vote-check' } = {}) {
  const jar = new Map();
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const req = async (path, { method = 'GET', body, headers = {} } = {}) => {
    const h = { 'user-agent': ua, ...headers };
    if (ip) h['x-forwarded-for'] = ip;
    if (jar.size) h.cookie = cookie();
    if (body !== undefined) h['content-type'] = 'application/json';
    const r = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie()) {
      const kv = c.split(';')[0];
      const i = kv.indexOf('=');
      jar.set(kv.slice(0, i), kv.slice(i + 1));
    }
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: r.status, headers: r.headers, json, text };
  };
  return { base, jar, cookie, req };
}

async function adminClient(base) {
  const a = client(base);
  const r = await a.req('/admin/login', { method: 'POST', body: { token: TOKEN } });
  if (r.status !== 200) throw new Error('admin login failed');
  return a;
}

// The first frame of the admin SSE stream: counts, room code, flags.
async function frame(admin) {
  const ctl = new AbortController();
  const r = await fetch(admin.base + '/vote/events', { headers: { cookie: admin.cookie() }, signal: ctl.signal });
  if (r.status !== 200) { ctl.abort(); return { status: r.status }; }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return { status: 0 };
      buf += dec.decode(value, { stream: true });
      const m = buf.match(/data: (.*)\n\n/);
      if (m) return { status: 200, ...JSON.parse(m[1]) };
    }
  } finally { ctl.abort(); }
}

const enterWith = (c, code) => c.req('/vote/enter', { method: 'POST', body: { code } });
const ballot = (c, cat, listVersion, picks, extra = {}) =>
  c.req('/vote/ballot', { method: 'POST', body: { categoryId: cat.id, roundId: cat.roundId, listVersion, picks, ...extra } });

async function apiChecks() {
  const A = startServer(8145);
  try {
    await A.ready;
    const admin = await adminClient(A.base);

    console.log('\n== public surface ==');
    const anon = client(A.base);
    const live0 = await anon.req('/vote/live');
    ok(live0.status === 200 && live0.json.categories.length === 5, '/vote/live lists the 5 seed categories');
    ok(Number(live0.headers.get('x-server-now')) > 0, '/vote/live carries X-Server-Now');
    ok(leaks(live0.json).length === 0, '/vote/live has no counts, code or flags');
    ok(live0.json.pollMs >= 3000 && live0.json.pollMs <= 6000, 'pollMs is within 3–6 s');
    ok(typeof live0.json.boot === 'string' && live0.json.boot.length >= 8, '/vote/live carries a boot id');
    const cands = await anon.req('/vote/candidates');
    ok(cands.json.candidates.length === 120, '120 seed names');
    const etag = cands.headers.get('etag');
    ok(etag.includes(live0.json.boot), 'candidates ETag includes the boot id');
    ok((await anon.req('/vote/candidates', { headers: { 'if-none-match': etag } })).status === 304, 'candidates revalidate to 304');
    ok((await anon.req('/vote/events')).status === 401, '/vote/events refuses without an admin session');
    ok((await anon.req('/vote/me')).json.entered === false, '/vote/me: not entered without a cookie');
    const c0 = live0.json.categories[0];
    const nb = await ballot(anon, c0, live0.json.listVersion, [0, 1, 2]);
    ok(nb.status === 401 && nb.json.reason === 'not_entered', 'ballot without a device cookie → 401 not_entered');
    ok((await anon.req('/state')).status === 200 && (await anon.req('/batucada/state')).status === 200, 'Tap Race and Sequência still answer');

    console.log('\n== entering ==');
    const f0 = await frame(admin);
    ok(f0.status === 200 && /^[A-HJKMNP-Z2-9]{5}$/.test(f0.code), 'admin frame carries the 5-char room code');
    const bad = client(A.base, { ip: '198.51.100.1' });
    const b1 = await enterWith(bad, 'ZZZZZ');
    ok(b1.status === 403 && b1.json.reason === 'bad_code', 'wrong code → 403 bad_code');
    for (let i = 0; i < 19; i++) await enterWith(bad, 'ZZZZZ');
    const thr = await enterWith(bad, (await frame(admin)).code);
    ok(thr.status === 429 && thr.json.reason === 'throttled', '20 wrong codes from one IP → 429, even with the right code');
    const x = await client(A.base).req('/vote/enter', { method: 'POST', body: { code: f0.code }, headers: { 'sec-fetch-site': 'cross-site' } });
    ok(x.status === 403 && x.json.reason === 'cross_site', 'cross-site POST refused');
    const dev = client(A.base, { ip: '198.51.100.2' });
    const e = await enterWith(dev, (await frame(admin)).code);
    const sc = e.headers.getSetCookie()[0] ?? '';
    ok(e.status === 200 && /^tv_voter=[^;]+; Path=\/vote; HttpOnly; SameSite=Strict/.test(sc), 'right code → device cookie (HttpOnly, Strict, /vote)');
    ok(!/Secure/.test(sc), 'no Secure flag over plain http');
    ok((await dev.req('/vote/me')).json.entered === true, '/vote/me: entered');
    const re = await enterWith(dev, 'ZZZZZ');
    ok(re.status === 200 && re.headers.getSetCookie().length === 0, 're-entering with a valid cookie is a no-op, whatever the code');

    console.log('\n== config ==');
    const big = Array.from({ length: 300 }, (_, i) => `Person ${String(i).padStart(3, '0')} ${'x'.repeat(46)}`);
    const cfg = await admin.req('/vote/admin/config', { method: 'POST', body: { names: big, categories: [{ title: 'Big', picks: 3 }] } });
    ok(cfg.status === 200, '300 × 57-char names save (body well over 8 KB)');
    const dup = await admin.req('/vote/admin/config', { method: 'POST', body: { names: ['Élio', 'ELIO'], categories: [{ title: 'X', picks: 1 }] } });
    ok(dup.status === 400 && /same name/.test(dup.json.errors.join(' ')), 'duplicate names → 400 naming the lines');
    const anonCfg = await client(A.base).req('/vote/admin/config', { method: 'POST', body: { names: ['A', 'B'], categories: [{ title: 'X', picks: 1 }] } });
    ok(anonCfg.status === 401, 'config needs the admin session');
    ok((await admin.req('/vote/admin/config', { method: 'POST', body: { names: SEED_NAMES, categories: SEED_CATEGORIES } })).status === 200, 'seed restored');

    console.log('\n== ballots ==');
    let live = (await anon.req('/vote/live')).json;
    const [c1] = live.categories;
    ok((await admin.req('/vote/admin/open', { method: 'POST', body: { categoryIds: [c1.id] } })).status === 200, 'open one category');
    live = (await anon.req('/vote/live')).json;
    let cat = live.categories.find((c) => c.id === c1.id);
    ok(cat.phase === 'open' && Math.abs(cat.endsAt - Date.now() - 180_000) < 5000, 'no duration → 3 min');
    const w = await ballot(dev, cat, live.listVersion, [0, 1]);
    ok(w.status === 400 && w.json.reason === 'wrong_count', 'a 2-pick ballot in a 3-pick category → wrong_count');
    await sleep(1100);
    const g = await ballot(dev, cat, live.listVersion, [2, 0, 1]);
    ok(g.status === 200 && g.json.ballot.join() === '0,1,2', 'a valid ballot lands (sorted)');
    ok(leaks(g.json).length === 0, 'the ballot response carries no counts');
    const tf = await ballot(dev, cat, live.listVersion, [0, 1, 3]);
    ok(tf.status === 429 && tf.json.reason === 'too_fast', 'a second submit within 1 s → too_fast');
    let f = await frame(admin);
    let fc = f.categories.find((c) => c.id === cat.id);
    ok(fc.counts.slice(0, 4).join() === '1,1,1,0' && fc.ballotCount === 1, 'the admin frame shows the counts');
    ok(f.feed.filter((x) => x.categoryId === cat.id).length === 3, 'the feed has the three +1s');
    ok((await dev.req('/vote/me')).json.ballots[cat.id].picks.join() === '0,1,2', '/vote/me returns my ballot');
    await sleep(1100);
    await ballot(dev, cat, live.listVersion, [0, 1, 3]);
    fc = (await frame(admin)).categories.find((c) => c.id === cat.id);
    ok(fc.counts.slice(0, 4).join() === '1,1,0,1' && fc.ballotCount === 1, 'changing one pick moves exactly one vote');
    await sleep(1100);
    const sl = await ballot(dev, cat, live.listVersion - 1, [0, 1, 4]);
    ok(sl.status === 409 && sl.json.reason === 'stale_list' && Array.isArray(sl.json.live.categories), 'stale list → 409 with fresh live state');

    console.log('\n== expiry & entry lock ==');
    const old = (await frame(admin)).code;
    await sleep(CODE_MS * 2 + 200);
    const late = await enterWith(client(A.base, { ip: '198.51.100.3' }), old);
    ok(late.status === 403 && late.json.reason === 'bad_code', 'a code older than two epochs is refused');
    await admin.req('/vote/admin/entry', { method: 'POST', body: { open: false } });
    const locked = await enterWith(client(A.base, { ip: '198.51.100.4' }), (await frame(admin)).code);
    ok(locked.status === 403 && locked.json.reason === 'entry_closed', 'entry closed → new devices refused');
    ok((await dev.req('/vote/me')).json.entered === true, '…devices already in stay in');
    ok((await anon.req('/vote/live')).json.entryOpen === false, 'phones learn entry is closed');
    await admin.req('/vote/admin/entry', { method: 'POST', body: { open: true } });

    console.log('\n== fraud flags ==');
    const fr = await frame(admin);
    await sleep(fr.codeRotatesAt - fr.now + 50); // a fresh epoch, so all six share an entry window
    const code = (await frame(admin)).code;
    const bots = [];
    for (let i = 0; i < 6; i++) {
      const b = client(A.base, { ip: '203.0.113.50', ua: 'BotPhone/1.0' });
      await enterWith(b, code);
      await ballot(b, cat, live.listVersion, [5, 6, 7]);
      bots.push(b);
    }
    await sleep(1300);
    f = await frame(admin);
    const flag = f.flags.find((x) => x.kind === 'cluster' && x.categoryId === cat.id);
    ok(flag && flag.devices === 6, 'six identical ballots from one network + browser → cluster flag');
    ok(!keysDeep(f.flags).has('voterIds'), 'voter ids never leave the server');
    const before = f.categories.find((c) => c.id === cat.id).counts[5];
    await admin.req('/vote/admin/void', { method: 'POST', body: { flagId: flag.id } });
    fc = (await frame(admin)).categories.find((c) => c.id === cat.id);
    ok(fc.counts[5] === before - 6 && fc.voidedCount === 6, 'void takes the six ballots out of the counts');
    await sleep(1100);
    const vb = await ballot(bots[0], cat, live.listVersion, [5, 6, 8]);
    ok(vb.status === 403 && vb.json.reason === 'voided', 'a voided device cannot vote again this round');
    ok((await bots[0].req('/vote/me')).json.voided.includes(cat.id), '/vote/me reports the void');
    await admin.req('/vote/admin/void', { method: 'POST', body: { flagId: flag.id, restore: true } });
    ok((await frame(admin)).categories.find((c) => c.id === cat.id).counts[5] === before, 'restore puts them back');

    console.log('\n== close ==');
    await admin.req('/vote/admin/close', { method: 'POST', body: { categoryIds: [cat.id] } });
    await sleep(1100);
    const cl = await ballot(dev, cat, live.listVersion, [0, 1, 2]);
    ok(cl.status === 409 && cl.json.reason === 'closed', 'a ballot after close → 409 closed');
    const st = await admin.req('/vote/admin/stage', { method: 'POST', body: { mode: 'pinned', categoryIds: [cat.id] } });
    ok(st.status === 200 && (await frame(admin)).stage.show.join() === cat.id, 'pinning the stage');

    console.log('\n== restart ==');
    const B = startServer(8146);
    try {
      await B.ready;
      const moved = client(B.base);
      for (const [k, v] of dev.jar) moved.jar.set(k, v);
      ok((await moved.req('/vote/me')).json.entered === false, 'a cookie from before a restart is not honoured');
      const liveB = (await moved.req('/vote/live')).json;
      ok(liveB.boot !== live0.json.boot, 'a new boot id after restart');
      const mb = await ballot(moved, liveB.categories[0], liveB.listVersion, [0, 1, 2]);
      ok(mb.status === 401, '…and it cannot vote');
    } finally { B.child.kill(); }
  } finally { A.child.kill(); }
}

await apiChecks();
// Browser checks (Tasks 5–7) are called here.

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
```

Add to `package.json` `"scripts"`: `"check:vote": "node scripts/vote-check.mjs"`.

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm run check:vote`
Expected: FAIL — `/vote/live lists the 5 seed categories` ✘ (the route doesn't exist yet), most checks ✘, non-zero exit.

- [ ] **Step 3: Wire the modules into `src/server.js`**

3a. Imports, after `import { Batucada } from './batucada.js';`:

```js
import { Vote } from './vote.js';
import { VoteGuard, clientIp, sameOrigin } from './vote-guard.js';
import { SEED_NAMES, SEED_CATEGORIES } from './vote-seed.js';
```

3b. Construction, right after the `const batucada = new Batucada({...});` block:

```js
// A third app in the same process — see docs/VOTE_SPEC.md. Same tick, same
// admin session; an admin-only SSE stream for the screen, and a shared,
// precompressed buffer that every phone polls (phones can't each hold a
// stream under Cloud Run's 1.000-connection cap). VOTE_CODE_MS and
// VOTE_MIN_DURATION_MS exist for the test harnesses only — an expired-code or
// deadline check should not take a minute.
const vote = new Vote({ names: SEED_NAMES, categories: SEED_CATEGORIES, minDurationMs: numEnv('VOTE_MIN_DURATION_MS') });
const voteGuard = new VoteGuard({ epochMs: numEnv('VOTE_CODE_MS') });
// Restarts reuse listVersion/roundId numbers from 1; this tells a phone (and
// its HTTP cache) that a "v2" from before a restart is not this "v2".
const VOTE_BOOT = randomBytes(6).toString('hex');
```

3c. Body limit, immediately **before** `app.use(express.json({ limit: '8kb' }));`:

```js
// 300 names × 60 chars is ~18 KB — over the 8 KB every other route lives
// under. body-parser skips a body that's already been parsed, so this
// route-scoped parser simply wins for this one path.
app.use('/vote/admin/config', express.json({ limit: '64kb' }));
```

3d. Precompress the shared module, after the `batucada/screen.html` line:

```js
precompress('vote/search.js', 'text/javascript; charset=utf-8', ['/vote/search.js']);
```

3e. The Live Vote section — insert after the `app.post('/batucada/admin/reset', …)` handler, before the `// Utilities` banner:

```js
// ---------------------------------------------------------------------------
// Live Vote  (companion app — see docs/VOTE_SPEC.md)
// ---------------------------------------------------------------------------
const VOTER_COOKIE = 'tv_voter';
const voteSseClients = new Set();
let voteScreenDirty = false; // a screen-visible change outside the engine: devices, entry
let voteSentVersion = -1;
let voteSentEpoch = -1;
let voteSentFlags = -1;
let voteLastFrameAt = 0;
let voteLastDetectAt = 0;

const isTls = (req) => req.secure || req.get('x-forwarded-proto') === 'https';
const voterOf = (req) => voteGuard.verify(readCookie(req, VOTER_COOKIE));

function voteSameOrigin(req, res) {
  if (sameOrigin(req.headers)) return true;
  res.status(403).json({ ok: false, reason: 'cross_site' });
  return false;
}

// Phones come back at ≤ 400 req/s in total: 3 s up to ~1.200 devices, then
// backing off to 6 s.
const votePollMs = () => Math.min(6000, Math.max(3000, Math.round((voteGuard.devices.size / 400) * 1000)));

// The /metrics trick (above): serialise and gzip once per change, so a
// request just writes a buffer however many phones are polling.
function jsonEntry(obj) {
  const raw = Buffer.from(JSON.stringify(obj));
  return { raw, gzip: zlib.gzipSync(raw) };
}

function sendEntry(req, res, entry) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Vary', 'Accept-Encoding');
  let body = entry.raw;
  if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    res.setHeader('Content-Encoding', 'gzip');
    body = entry.gzip;
  }
  res.setHeader('Content-Length', body.length);
  res.end(body);
}

let voteLiveCache = null;
function voteLiveEntry() {
  const pollMs = votePollMs();
  const key = `${vote.phoneVersion}|${pollMs}|${voteGuard.entryOpen}`;
  if (voteLiveCache?.key !== key) {
    voteLiveCache = { key, entry: jsonEntry({ ...vote.phoneState(), boot: VOTE_BOOT, entryOpen: voteGuard.entryOpen, pollMs }) };
  }
  return voteLiveCache.entry;
}

let voteCandidatesCache = null;
function voteCandidatesEntry() {
  if (voteCandidatesCache?.v !== vote.listVersion) {
    voteCandidatesCache = { v: vote.listVersion, entry: jsonEntry({ listVersion: vote.listVersion, candidates: vote.candidates }) };
  }
  return voteCandidatesCache.entry;
}

app.post('/vote/enter', (req, res) => {
  if (!voteSameOrigin(req, res)) return;
  const r = voteGuard.enter({
    code: req.body?.code,
    existing: readCookie(req, VOTER_COOKIE),
    ip: clientIp(req.get('x-forwarded-for'), req.socket.remoteAddress),
    ua: req.get('user-agent'),
    now: Date.now(),
  });
  if (!r.ok) return res.status(r.reason === 'throttled' ? 429 : 403).json({ ok: false, reason: r.reason });
  if (!r.already) {
    res.setHeader('Set-Cookie', voteGuard.cookieHeader(r.cookie, isTls(req)));
    voteScreenDirty = true; // the device count is on the admin page
  }
  res.json({ ok: true });
});

app.get('/vote/candidates', (req, res) => {
  const etag = `"vl${VOTE_BOOT}-${vote.listVersion}"`;
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('ETag', etag);
  if (etagMatches(req.headers['if-none-match'], etag)) return res.status(304).end();
  sendEntry(req, res, voteCandidatesEntry());
});

// Shared by every phone and up to a change old by design — so the clock rides
// in a header read at request time, exactly as /metrics does.
app.get('/vote/live', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Server-Now', String(Date.now()));
  sendEntry(req, res, voteLiveEntry());
});

app.get('/vote/me', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const id = voterOf(req);
  const view = id ? vote.voterView(id) : { ballots: {}, voided: [] };
  res.json({ entered: !!id, entryOpen: voteGuard.entryOpen, ...view });
});

const BALLOT_STATUS = { closed: 409, stale_list: 409, stale_round: 409, voided: 403 };

app.post('/vote/ballot', (req, res) => {
  if (!voteSameOrigin(req, res)) return;
  const now = Date.now();
  res.setHeader('X-Server-Now', String(now));
  const voterId = voterOf(req);
  if (!voterId) return res.status(401).json({ ok: false, reason: 'not_entered' });
  const b = req.body || {};
  const gate = voteGuard.allowSubmit(voterId, b.categoryId, b.roundId, now);
  if (!gate.ok) return res.status(429).json({ ok: false, reason: gate.reason });
  const r = vote.submit(voterId, { categoryId: b.categoryId, roundId: b.roundId, listVersion: b.listVersion, picks: b.picks }, now);
  const live = { ...vote.phoneState(), boot: VOTE_BOOT };
  if (!r.ok) return res.status(BALLOT_STATUS[r.reason] ?? 400).json({ ok: false, reason: r.reason, live });
  if (r.changed) voteGuard.noteSubmit(b.categoryId, voterId, r.added, r.ballot, now);
  res.json({ ok: true, ballot: r.ballot, live });
});

function voteFrame(now) {
  return JSON.stringify({
    ...vote.screenState(),
    now,
    code: voteGuard.roomCode(now),
    codeRotatesAt: voteGuard.codeRotatesAt(now),
    codeMs: voteGuard.o.epochMs,
    entryOpen: voteGuard.entryOpen,
    devices: voteGuard.devices.size,
    flags: voteGuard.listFlags(vote.categories),
  });
}

// Admin-only: every frame carries the live room code and every count. If it
// were public, anyone anywhere could read the code and the room lock would be
// decoration.
app.get('/vote/events', (req, res) => {
  if (!sessionOk(readCookie(req, ADMIN_COOKIE))) return res.status(401).json({ error: 'admin session required' });
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');
  res.write(`data: ${voteFrame(Date.now())}\n\n`);
  voteSseClients.add(res);
  req.on('close', () => voteSseClients.delete(res));
});

// Called every tick; sends only when something changed (≤ 10 frames/s), with a
// comment every 15 s so an idle stream isn't reaped by a proxy.
function broadcastVote(now) {
  const epoch = Math.floor(now / voteGuard.o.epochMs);
  const changed =
    vote.version !== voteSentVersion || epoch !== voteSentEpoch ||
    voteGuard.flagsVersion !== voteSentFlags || voteScreenDirty;
  if (changed) {
    voteSentVersion = vote.version;
    voteSentEpoch = epoch;
    voteSentFlags = voteGuard.flagsVersion;
    voteScreenDirty = false;
  }
  if (voteSseClients.size === 0) return;
  let payload = null;
  if (changed) payload = `data: ${voteFrame(now)}\n\n`;
  else if (now - voteLastFrameAt >= 15000) payload = ': keepalive\n\n';
  if (!payload) return;
  voteLastFrameAt = now;
  for (const res of voteSseClients) {
    try { res.write(payload); } catch { voteSseClients.delete(res); }
  }
}

// 1 Hz. Members newly caught by a flag the admin already voided are voided too.
function voteDetect(now) {
  if (now - voteLastDetectAt < 1000) return;
  voteLastDetectAt = now;
  for (const { categoryId, voterIds } of voteGuard.detect(vote.categories, now)) vote.void(categoryId, voterIds);
}

// Same password, same session cookie as /host. Engine/guard validation errors
// come back as 400 {ok:false, errors}.
async function voteAdmin(req, res, fn) {
  if (!(await checkAdmin(req, res))) return;
  const r = fn(req.body || {}, Date.now());
  if (r && r.ok === false) return res.status(400).json(r);
  res.json(r ?? { ok: true });
}

app.post('/vote/admin/config', (req, res) => voteAdmin(req, res, (b) => vote.configure({ names: b.names, categories: b.categories })));
app.post('/vote/admin/open', (req, res) => voteAdmin(req, res, (b, now) => vote.open(b.categoryIds, b.durationMs, now)));
app.post('/vote/admin/close', (req, res) => voteAdmin(req, res, (b, now) => vote.close(b.categoryIds, now)));
app.post('/vote/admin/reset', (req, res) => voteAdmin(req, res, (b) => vote.reset(b.categoryIds)));
app.post('/vote/admin/stage', (req, res) => voteAdmin(req, res, (b) => vote.setStage(b)));
app.post('/vote/admin/entry', (req, res) =>
  voteAdmin(req, res, (b) => {
    voteGuard.setEntry(b.open);
    voteScreenDirty = true;
    return { ok: true, entryOpen: voteGuard.entryOpen };
  }),
);
app.post('/vote/admin/void', (req, res) =>
  voteAdmin(req, res, (b) => {
    const id = String(b.flagId ?? '');
    const flag = voteGuard.flags.get(id);
    if (!flag) return { ok: false, errors: ['Unknown flag.'] };
    const affected = b.restore
      ? vote.restore(flag.categoryId, voteGuard.restorable(id))
      : vote.void(flag.categoryId, flag.voterIds);
    voteGuard.markVoided(id, !b.restore);
    return { ok: true, affected };
  }),
);
```

3f. The tick — replace the `tickTimer` callback body with:

```js
const tickTimer = setInterval(() => {
  game.tick(Date.now());
  broadcast();
  batucada.tick(Date.now());
  broadcastBatucada();
  const now = Date.now();
  vote.tick(now);
  voteDetect(now);
  broadcastVote(now);
}, TICK_MS);
```

and update its comment's second sentence to "Drives Batucada and Live Vote too — one clock for every app rather than timers that can drift against each other."

3g. `shutdown`: after the `batucadaSseClients` loop add
`for (const res of voteSseClients) { try { res.end(); } catch { /* ignore */ } }`.

3h. Startup banner: after the `batucada` line add
``console.log(`   live vote  : phone:/vote  screen:/vote/screen  admin:/vote/admin`);``

3i. Export: `export { app, game, PHASE, batucada, vote, voteGuard };`

- [ ] **Step 4: Run the contract and the existing checks**

Run: `npm run check:vote`
Expected: every line ✔, `… passed, 0 failed`, exit 0.

Run: `npm test && npm run check:contract`
Expected: all green — Tap Race and Sequência untouched.

- [ ] **Step 5: Spec clarifications** — in `docs/VOTE_SPEC.md`, API table:
  - `GET /vote/live` row: replace `{listVersion, entryOpen, now, pollMs, categories:[…]}` with `{listVersion, boot, entryOpen, pollMs, categories:[…]}` and append: "the server clock rides in an `X-Server-Now` header (the body is shared and may be older than the request); `boot` changes on every restart so phones drop drafts from before it".
  - `GET /vote/candidates` row: `ETag = boot + listVersion`.

- [ ] **Step 6: Commit**

```bash
git add src/server.js scripts/vote-check.mjs package.json docs/VOTE_SPEC.md
git commit -m "Live Vote: server routes, admin SSE, shared phone buffer, HTTP contract"
```

---

### Task 5: Phone page — `/vote`

**Files:**
- Create: `public/vote/phone.html`
- Modify: `src/server.js` (precompress line), `scripts/vote-check.mjs` (append `phoneChecks`)

**Interfaces:**
- Consumes: Task 1 exports (`buildIndex`, `search`, `suggest`, `letterOf`, `remapPicks`) via `import … from '/vote/search.js'`; Task 4 routes `/vote/enter`, `/vote/live`, `/vote/candidates`, `/vote/me`, `/vote/ballot`.
- Produces — the DOM contract the browser checks rely on:
  - Gate: `#gate`, `#gateMsg`, `#codeForm` > `#codeInput` + `#codeBtn`
  - Home: `#home`, `#cards` > `button.cat-card[data-id]` with class `open|setup|closed`, child `.s` = status text, `.tm` = countdown
  - Ballot: `#ballot`, `#back`, `#ballotTitle`, `#timer`, `#need` ("Pick exactly 3"), `#searchForm` > `#q` + `#clear`, `#count`
  - List: `#results` > `li.hdr#L-<letter>` and `li.row[data-id][data-name]` (`.on` when picked; matches in `<mark>`), `#rail` > `span[data-l]`
  - Empty: `#empty`, `#suggestWrap` > `#suggest` > `button.sug[data-id]`
  - Tray: `#tray` (`.submitted` when the server has exactly these picks), `#chips` > `button.chip[data-id]`, `#picked` ("2 of 3"), `#submit`, `#trayNote`
  - Banners: `#warn` (last 30 s with unsubmitted changes), `#deadlineMsg`
  - Toast: `#toast` with `.show` and one of `.ok|.info|.error`

- [ ] **Step 1: Write the failing browser check** — in `scripts/vote-check.mjs`, add `import { chromium, devices } from 'playwright';` to the imports, add this function above `await apiChecks();`, and call `await phoneChecks();` on the line after it:

```js
async function phoneChecks() {
  const S = startServer(8147);
  const browser = await chromium.launch();
  try {
    await S.ready;
    const admin = await adminClient(S.base);
    let live = (await admin.req('/vote/live')).json;
    const [c1, c2] = live.categories;
    await admin.req('/vote/admin/open', { method: 'POST', body: { categoryIds: [c1.id] } });

    console.log('\n== phone: entering and searching ==');
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const bodies = [];
    page.on('response', async (r) => {
      if (r.url().includes('/vote/') && (r.headers()['content-type'] || '').includes('json')) {
        try { bodies.push(await r.json()); } catch { /* 304 / empty */ }
      }
    });
    await page.goto(`${S.base}/vote?k=${(await frame(admin)).code}`);
    await page.waitForSelector('#ballot:not([hidden])');
    ok(new URL(page.url()).search === '', 'the code is stripped from the address bar');
    ok((await page.textContent('#ballotTitle')) === c1.title, 'one open category → straight into its ballot');
    ok(/Pick exactly 3/.test(await page.textContent('#need')), '"Pick exactly 3" in the header');
    ok((await page.locator('#results li.hdr').count()) > 10, 'empty query: alphabetical with letter headers');
    ok((await page.locator('#rail span').count()) > 10, 'the A–Z rail is shown');

    const top = () => page.locator('#results li.row').first();
    await page.fill('#q', 'joao');
    ok((await top().getAttribute('data-name')) === 'João Pedro Silva', '"joao" finds João Pedro Silva first');
    ok((await top().locator('mark').allTextContents()).join('') === 'João', '…with "João" highlighted');
    ok(/^\d+ of 120$/.test((await page.textContent('#count')).trim()), 'result count reads "N of 120"');
    ok(await page.isHidden('#rail'), 'the rail hides while searching');
    await page.press('#q', 'Enter');
    ok((await page.inputValue('#q')) === '', 'Enter picks the top hit and clears the field');
    ok((await page.locator('#chips .chip').count()) === 1, 'the pick lands in the tray');
    ok(/1 of 3/.test(await page.textContent('#picked')), 'tray reads "1 of 3"');

    await page.fill('#q', 'suoza');
    ok((await top().getAttribute('data-name')) === 'Ana Souza', 'typo "suoza" still finds Ana Souza');
    await page.press('#q', 'Enter');
    await page.fill('#q', 'bruno lma');
    ok(await page.isVisible('#empty'), 'no match → empty state');
    ok((await page.textContent('#suggest')).includes('Bruno Lima'), '…with "Did you mean Bruno Lima?"');
    await page.click('#suggest .sug');
    ok((await page.locator('#chips .chip').count()) === 3, 'tapping a suggestion picks it');
    ok(await page.isEnabled('#submit'), 'Submit enabled at exactly 3');

    await page.fill('#q', 'carla');
    await top().click();
    ok(await page.isVisible('#toast.show'), 'a 4th pick is refused with a toast');
    ok((await page.textContent('#toast')).includes("You've picked 3"), '…"You\'ve picked 3 — remove one…"');
    ok((await page.locator('#chips .chip').count()) === 3, '…and the tray still has 3');

    console.log('\n== phone: submitting ==');
    await page.fill('#q', '');
    await page.locator('#submit').dblclick();
    await page.waitForSelector('#tray.submitted');
    await sleep(300);
    ok(!(await page.isVisible('#toast.error')), 'double-tapping Submit shows no error');
    let fc = (await frame(admin)).categories.find((c) => c.id === c1.id);
    ok(fc.ballotCount === 1 && fc.counts[0] === 1 && fc.counts[1] === 1 && fc.counts[4] === 1, 'the server counted Ana, João and Bruno');
    ok((await page.textContent('#submit')).includes('Submitted'), 'button reads "Submitted ✓"');
    await page.reload();
    await page.waitForSelector('#tray.submitted');
    ok((await page.locator('#chips .chip').count()) === 3, 'after a reload the submitted ballot is still shown');

    await page.locator('#chips .chip[data-id="4"]').click();
    ok(!(await page.locator('#tray').getAttribute('class')).includes('submitted'), 'removing a pick un-marks "submitted"');
    await page.fill('#q', 'carla');
    await page.press('#q', 'Enter');
    await page.click('#submit');
    await page.waitForSelector('#tray.submitted');
    fc = (await frame(admin)).categories.find((c) => c.id === c1.id);
    ok(fc.counts[4] === 0 && fc.counts[5] === 1 && fc.ballotCount === 1, 'changing a pick moved one vote');
    ok(bodies.every((b) => leaks(b).length === 0), 'no response the phone received contained counts');

    console.log('\n== phone: home, deadline ==');
    // Long enough for a 3 s poll to show the card, short enough to watch it end.
    await admin.req('/vote/admin/open', { method: 'POST', body: { categoryIds: [c2.id], durationMs: 10_000 } });
    await page.click('#back');
    await page.waitForSelector(`#cards .cat-card.open[data-id="${c2.id}"]`, { timeout: 8000 });
    ok((await page.textContent(`#cards .cat-card[data-id="${c1.id}"] .s`)).includes('Submitted'), 'home: category 1 reads "Submitted ✓"');
    ok((await page.locator('#cards .cat-card.open').count()) === 2, 'home: both open categories listed first');
    await page.click(`#cards .cat-card[data-id="${c2.id}"]`);
    await page.fill('#q', 'mei lin');
    await page.press('#q', 'Enter');
    await page.waitForSelector('#deadlineMsg:not([hidden])', { timeout: 12_000 });
    ok(/didn.t count/.test(await page.textContent('#deadlineMsg')), "deadline with an unsubmitted draft → \"…didn't count\"");
    ok(await page.isDisabled('#submit'), 'Submit disabled after the deadline');
    await page.screenshot({ path: `${SHOTS}/phone-ballot.png` });

    console.log('\n== phone: gate ==');
    const g = await browser.newContext({ ...devices['iPhone 13'] });
    const gp = await g.newPage();
    await gp.goto(`${S.base}/vote`);
    await gp.waitForSelector('#gate:not([hidden])');
    ok((await gp.textContent('#gateMsg')).includes('Scan the QR on the big screen'), 'no cookie → "Scan the QR on the big screen to vote"');
    await gp.goto(`${S.base}/vote?k=ZZZZZ`);
    await gp.waitForSelector('#gate:not([hidden])');
    ok(/expired/.test(await gp.textContent('#gateMsg')), 'an expired code says so');
    await gp.fill('#codeInput', (await frame(admin)).code.toLowerCase());
    await gp.click('#codeBtn');
    await gp.waitForSelector('#gate', { state: 'hidden' });
    ok(true, 'typing the code (any case) lets you in');
    await gp.screenshot({ path: `${SHOTS}/phone-home.png` });

    console.log('\n== phone: 360 px, 60-char names ==');
    const long = 'Maria Eduarda Quintela de Albuquerque Vasconcelos e Silva Jr';
    await admin.req('/vote/admin/close', { method: 'POST', body: { categoryIds: [c1.id, c2.id] } });
    await admin.req('/vote/admin/config', { method: 'POST', body: { names: [long, ...SEED_NAMES.slice(1)], categories: SEED_CATEGORIES } });
    live = (await admin.req('/vote/live')).json;
    await admin.req('/vote/admin/open', { method: 'POST', body: { categoryIds: [live.categories[0].id] } });
    const small = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, userAgent: devices['Pixel 5'].userAgent });
    const sp = await small.newPage();
    await sp.goto(`${S.base}/vote?k=${(await frame(admin)).code}`);
    await sp.waitForSelector('#ballot:not([hidden])');
    await sp.fill('#q', 'albuquerque'); // only the long name has this word
    await sp.press('#q', 'Enter');
    ok((await sp.locator('#chips .chip').count()) === 1, 'the 60-char name is in the tray');
    ok(await sp.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth), 'no horizontal scroll at 360 px with a 60-char name');
    const h = await sp.locator('#results li.row').first().boundingBox();
    ok(h.height >= 56, 'rows are at least 56 px tall');
    ok(await sp.evaluate(() => parseFloat(getComputedStyle(document.getElementById('q')).fontSize) >= 16), 'search input ≥ 16 px (no iOS zoom)');
    await sp.screenshot({ path: `${SHOTS}/phone-360.png` });

    ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  } finally {
    await browser.close();
    S.child.kill();
  }
}
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm run check:vote`
Expected: API section ✔; `== phone ==` fails at `waitForSelector('#ballot:not([hidden])')` (404 for `/vote`).

- [ ] **Step 3: Register the page** — in `src/server.js`, after the `vote/search.js` precompress line:

```js
precompress('vote/phone.html', HTML, ['/vote', '/vote/', '/vote/phone.html']);
```

- [ ] **Step 4: Build `public/vote/phone.html`**

Head: `<html lang="en">`, `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` (zoom stays allowed — this page is reading-heavy), `<meta name="theme-color" content="#000000">`, `<title>Live Vote</title>`, `<link rel="stylesheet" href="/theme.css">`. `<body class="noise-bg">`.

Markup (ids exactly as the DOM contract above):

```html
<div id="gate" class="gate" hidden>
  <p id="gateMsg">Scan the QR on the big screen to vote</p>
  <form id="codeForm" autocomplete="off">
    <input id="codeInput" maxlength="5" autocapitalize="characters" autocorrect="off" spellcheck="false" placeholder="CODE" aria-label="Room code">
    <button id="codeBtn" type="submit">Enter</button>
  </form>
</div>

<main id="home">
  <header class="top"><h1>Live Vote</h1></header>
  <div id="cards" class="cards"></div>
</main>

<main id="ballot" hidden>
  <header class="top bar">
    <button id="back" aria-label="Back">‹</button>
    <div class="ttl"><h1 id="ballotTitle"></h1><span id="need"></span></div>
    <span id="timer" class="mono"></span>
  </header>
  <div id="warn" class="warn" hidden>Submit before time runs out!</div>
  <div id="deadlineMsg" class="warn" hidden></div>
  <form id="searchForm" class="search" role="search">
    <input id="q" type="search" enterkeyhint="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Search names" aria-label="Search names">
    <button id="clear" type="button" aria-label="Clear" hidden>×</button>
  </form>
  <div id="count" class="count"></div>
  <ul id="results" class="list"></ul>
  <nav id="rail" class="rail" aria-label="Jump to letter"></nav>
  <div id="empty" class="empty" hidden>
    <p>No names found</p>
    <div id="suggestWrap" hidden><p>Did you mean…?</p><div id="suggest"></div></div>
  </div>
  <footer id="tray" class="tray">
    <div id="chips" class="chips"></div>
    <div class="trayrow"><span id="picked" class="mono"></span><button id="submit" type="button" disabled></button></div>
    <div id="trayNote" class="note"></div>
  </footer>
</main>
<div id="toast" class="toast" role="status" aria-live="polite"></div>
```

CSS (in a `<style>` block, using the `theme.css` variables). Required rules — each line here is something a check or the spec depends on:
- `[hidden]{display:none !important}` — the page toggles views with the `hidden` attribute, and any `display:` rule (e.g. `.tray{display:flex}`) would otherwise beat the browser's default and keep it visible. Same rule in the screen and admin pages.
- `html,body{min-height:100dvh}`; `body{padding-top:env(safe-area-inset-top)}`.
- `.top` sticky at `top:0`, `z-index:5`, glass background; `.search` sticky directly under it.
- `#q{font-size:17px; min-height:48px; width:100%}` — ≥ 16 px stops iOS zooming on focus.
- `.list li.row{min-height:56px; display:flex; align-items:center; gap:12px; padding:8px 44px 8px 16px}` (right padding clears the rail); `.nm{flex:1; min-width:0; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; overflow-wrap:anywhere}` — 60-char names wrap to two lines, never scroll sideways.
- `li.row mark{background:none; color:var(--g-blue-700); font-weight:700}`; `li.row.on{background:var(--primary-dim)}` plus a filled check in `.ck`.
- `.av` 36 px circle, `background:hsl(var(--h) 55% 32%)`, initials in it.
- `li.hdr{position:sticky; top:<header+search height>; scroll-margin-top:<same>}` letter headers.
- `.rail{position:fixed; right:2px; top:50%; transform:translateY(-50%); touch-action:none; font:600 11px var(--font-mono)}`, each `span` ≥ 18 px tall.
- `.tray{position:fixed; left:0; right:0; bottom:var(--kb,0px); padding:12px 16px calc(12px + env(safe-area-inset-bottom)); z-index:6}`; `.list{padding-bottom:<tray height + 24px>}`.
- `.chip{max-width:46vw; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-height:36px}`.
- `#submit{min-height:52px; flex:1}`; `.tray.submitted #submit{background:var(--g-green)}`.
- `.tray.shake{animation:shake .35s}`; `.toast` fixed above the tray, `.show` fades it in.
- `.cat-card` full-width button ≥ 72 px, `.open` gets a primary border + live `.tm`; `.cat-card.new{animation:cardIn .4s ease-out}` (a category the host just opened).

Script — `<script type="module">`:

```js
import { buildIndex, search, suggest, letterOf, remapPicks } from '/vote/search.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const initials = (n) => n.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const hue = (n) => { let h = 0; for (const c of n) h = (h * 31 + c.codePointAt(0)) % 360; return h; };
const sameSet = (a, b) => !!a && !!b && a.length === b.length && a.every((x) => b.includes(x));
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// NTP-style, RTT-compensated — same algorithm as public/batucada/phone.html:127-148,
// fed from the X-Server-Now header (the /vote/live body is shared and may be old).
let clockOffset = 0;
let bestRtt = Infinity;
const serverNow = () => Date.now() + clockOffset;
function syncClock(r, t0, t1) {
  const sn = Number(r.headers.get('x-server-now'));
  if (!sn) return;
  const rtt = t1 - t0;
  if (rtt < 0 || rtt > 5000) return;
  if (Math.abs(sn - t1 - clockOffset) > 5000) bestRtt = Infinity;
  if (rtt > bestRtt) return;
  bestRtt = rtt;
  clockOffset = sn + rtt / 2 - t1;
}

async function api(path, { method = 'GET', body } = {}) {
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(path, {
      method, signal: ctl.signal,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    syncClock(r, t0, Date.now());
    return { status: r.status, json: await r.json().catch(() => null) };
  } catch {
    return { status: 0, json: null };
  } finally {
    clearTimeout(timer);
  }
}

const S = {
  boot: null, entered: false, entryOpen: true, pollMs: 3000,
  live: null, listVersion: -1, candidates: [], index: [], byId: new Map(), byName: new Map(),
  ballots: {}, voided: new Set(),
  view: 'home', catId: null, query: '', picks: [], results: [],
  inflight: false, autoOpened: new Set(), deadlineShown: new Set(), booting: true,
};
const currentCat = () => S.live?.categories.find((c) => c.id === S.catId) ?? null;
const closedLocally = (cat) => cat.phase === 'open' && serverNow() >= cat.endsAt;
const isOpen = (cat) => cat.phase === 'open' && !closedLocally(cat);
const submittedPicks = (cat) => {
  const b = S.ballots[cat.id];
  return b && b.roundId === cat.roundId ? b.picks : null;
};

// Drafts hold NAMES, keyed by boot + category + round: ids are list positions,
// and a restart reuses every number from 1 (docs/VOTE_PLAN.md, Review Focus 2–3).
const draftKey = (cat) => `tv_draft:${S.boot}:${cat.id}:${cat.roundId}`;
function loadDraft(cat) {
  try {
    const names = JSON.parse(localStorage.getItem(draftKey(cat)) || 'null');
    return Array.isArray(names) ? names.map((n) => S.byName.get(n)).filter((id) => id !== undefined) : null;
  } catch { return null; }
}
function saveDraft(cat) {
  try { localStorage.setItem(draftKey(cat), JSON.stringify(S.picks.map((id) => S.byId.get(id).name))); } catch { /* private mode */ }
}
function dropOtherBoots() {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k?.startsWith('tv_draft:') && !k.startsWith(`tv_draft:${S.boot}:`)) localStorage.removeItem(k);
  }
}

let toastTimer = 0;
function toast(msg, kind = 'info') {
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 2600);
}

// ---- server state ---------------------------------------------------------
async function loadCandidates() {
  const r = await api('/vote/candidates');
  if (r.status !== 200 || !r.json) return;
  const before = S.candidates;
  S.candidates = r.json.candidates;
  S.listVersion = r.json.listVersion;
  S.index = buildIndex(S.candidates);
  S.byId = new Map(S.candidates.map((c) => [c.id, c]));
  S.byName = new Map(S.candidates.map((c) => [c.name, c.id]));
  if (before.length) S.picks = remapPicks(before, S.candidates, S.picks);
}

async function applyLive(live) {
  if (live.boot && live.boot !== S.boot) {
    const restarted = S.boot !== null; // null = first load, not a restart
    S.boot = live.boot;
    dropOtherBoots();
    if (restarted) {
      S.ballots = {}; // the server forgot them, and our cookie died with its secret
      refreshMe().then(render);
    }
  }
  const prevCat = currentCat();
  S.live = { ...(S.live ?? {}), ...live };
  if (typeof live.entryOpen === 'boolean') S.entryOpen = live.entryOpen;
  if (live.pollMs) S.pollMs = live.pollMs;
  if (live.listVersion !== S.listVersion) await loadCandidates();
  const cat = currentCat();
  if (cat && prevCat && cat.roundId !== prevCat.roundId) S.picks = loadDraft(cat) ?? submittedPicks(cat) ?? S.picks;
  maybeAutoOpen();
}

async function refreshLive() {
  const r = await api('/vote/live');
  if (r.status === 200 && r.json) await applyLive(r.json);
}

async function refreshMe() {
  const r = await api('/vote/me');
  if (r.status !== 200 || !r.json) return;
  S.entered = r.json.entered;
  S.entryOpen = r.json.entryOpen;
  S.ballots = r.json.ballots;
  S.voided = new Set(r.json.voided);
}

async function enter(code, fromQr) {
  const r = await api('/vote/enter', { method: 'POST', body: { code } });
  if (r.status === 200) { S.entered = true; return; }
  const reason = r.json?.reason;
  $('gateMsg').textContent =
    reason === 'entry_closed' ? 'Entry is closed' :
    reason === 'throttled' ? 'Too many tries — wait a minute and scan again' :
    reason === 'bad_code' ? (fromQr ? 'That code expired — scan the screen again' : "That code isn't right — check the big screen") :
    "Couldn't reach the server — try again";
}

let polls = 0;
async function poll() {
  await refreshLive();
  if (++polls % 5 === 0) await refreshMe(); // voids and entry changes; ballots we already know
  render();
  setTimeout(poll, S.pollMs * (0.8 + Math.random() * 0.4));
}

// ---- navigation -----------------------------------------------------------
function openBallot(id, push = true) {
  const cat = S.live?.categories.find((c) => c.id === id);
  if (!cat) return;
  S.view = 'ballot';
  S.catId = id;
  S.query = '';
  $('q').value = '';
  S.picks = loadDraft(cat) ?? [...(submittedPicks(cat) ?? [])];
  if (push) history.pushState({ cat: id }, '', '/vote');
  render();
  scrollTo(0, 0);
}
function goHome() {
  S.view = 'home';
  S.catId = null;
  render();
}
addEventListener('popstate', () => goHome());

function maybeAutoOpen() {
  if (S.booting || S.view !== 'home' || !S.live) return;
  const open = S.live.categories.filter(isOpen);
  if (open.length !== 1) return;
  const cat = open[0];
  const key = `${cat.id}:${cat.roundId}`;
  if (submittedPicks(cat) || S.autoOpened.has(key)) return;
  S.autoOpened.add(key);
  openBallot(cat.id);
}

// ---- rendering ------------------------------------------------------------
function statusOf(cat) {
  const sub = submittedPicks(cat);
  if (cat.phase === 'setup') return 'Opens soon';
  if (!isOpen(cat)) return sub ? 'Closed · your votes counted ✓' : 'Closed';
  const draft = loadDraft(cat);
  if (sub && (!draft || sameSet(draft, sub))) return 'Submitted ✓';
  if (draft?.length) return `${draft.length} of ${cat.picks} picked — not submitted`;
  return 'Not voted';
}

const cardClass = (cat) => (isOpen(cat) ? 'open' : cat.phase === 'setup' ? 'setup' : 'closed');
const CARD_ORDER = { open: 0, setup: 1, closed: 2 };

const seenOpen = new Set(); // `${id}:${roundId}` already shown open — only new ones animate in

function renderHome() {
  const cats = [...(S.live?.categories ?? [])].sort((a, b) => CARD_ORDER[cardClass(a)] - CARD_ORDER[cardClass(b)]);
  $('cards').innerHTML = cats.map((cat) => {
    let cls = cardClass(cat);
    const key = `${cat.id}:${cat.roundId}`;
    if (cls === 'open' && !seenOpen.has(key)) { seenOpen.add(key); cls += ' new'; }
    return `<button class="cat-card ${cls}" data-id="${esc(cat.id)}"><span class="t">${esc(cat.title)}</span>` +
      `<span class="n">Pick ${cat.picks}</span><span class="s">${esc(statusOf(cat))}</span><span class="tm mono"></span></button>`;
  }).join('');
}

function highlight(name, ranges) {
  let out = '';
  let at = 0;
  for (const [s, e] of ranges) { out += `${esc(name.slice(at, s))}<mark>${esc(name.slice(s, e))}</mark>`; at = e; }
  return out + esc(name.slice(at));
}

function renderResults() {
  const q = S.query.trim();
  const results = search(S.index, S.query);
  const picked = new Set(S.picks);
  let html = '';
  let letter = null;
  for (const r of results) {
    if (!q) {
      const L = letterOf(r.name);
      if (L !== letter) { letter = L; html += `<li class="hdr" id="L-${L}">${L}</li>`; }
    }
    html += `<li class="row${picked.has(r.id) ? ' on' : ''}" data-id="${r.id}" data-name="${esc(r.name)}">` +
      `<span class="av" style="--h:${hue(r.name)}">${esc(initials(r.name))}</span>` +
      `<span class="nm">${highlight(r.name, r.ranges)}</span><span class="ck" aria-hidden="true"></span></li>`;
  }
  $('results').innerHTML = html;
  $('count').textContent = q ? `${results.length} of ${S.candidates.length}` : `${S.candidates.length} names`;
  $('clear').hidden = !S.query;
  const empty = !!q && results.length === 0;
  $('empty').hidden = !empty;
  if (empty) {
    const sug = suggest(S.index, S.query);
    $('suggest').innerHTML = sug.map((s) => `<button type="button" class="sug" data-id="${s.id}">${esc(s.name)}</button>`).join('');
    $('suggestWrap').hidden = sug.length === 0;
  }
  $('rail').hidden = !!q;
  if (!q) $('rail').innerHTML = [...new Set(results.map((r) => letterOf(r.name)))].map((L) => `<span data-l="${L}">${L}</span>`).join('');
  S.results = results;
}

function renderTray() {
  const cat = currentCat();
  if (!cat) return;
  const sub = submittedPicks(cat);
  const same = sameSet(sub, S.picks);
  const open = isOpen(cat);
  $('tray').classList.toggle('submitted', same);
  $('chips').innerHTML = S.picks.map((id) => `<button type="button" class="chip" data-id="${id}"><span>${esc(S.byId.get(id)?.name ?? '?')}</span><b aria-label="Remove">×</b></button>`).join('');
  $('picked').textContent = `${S.picks.length} of ${cat.picks}`;
  const btn = $('submit');
  btn.disabled = !S.entered || !open || S.inflight || same || S.picks.length !== cat.picks || S.voided.has(cat.id);
  btn.textContent = S.inflight ? 'Submitting…' : same ? 'Submitted ✓' : sub ? 'Update votes' : `Submit ${cat.picks} vote${cat.picks > 1 ? 's' : ''}`;
  $('trayNote').textContent =
    S.voided.has(cat.id) ? 'Your ballot in this category was removed by the organizer' :
    cat.phase === 'setup' ? "Voting hasn't started yet" :
    !open ? (sub ? 'Voting closed — your votes counted ✓' : 'Voting closed') :
    same ? `Your ${cat.picks} votes are in ✓ — you can change them until time runs out` : '';
}

function renderGate() {
  $('gate').hidden = S.entered;
  $('codeForm').hidden = !S.entryOpen;
  if (!S.entered && !S.entryOpen) $('gateMsg').textContent = 'Entry is closed';
}

function render() {
  renderGate();
  $('home').hidden = S.view !== 'home';
  $('ballot').hidden = S.view !== 'ballot';
  if (S.view === 'home') return renderHome();
  const cat = currentCat();
  if (!cat) return goHome();
  $('ballotTitle').textContent = cat.title;
  $('need').textContent = `Pick exactly ${cat.picks}`;
  renderResults();
  renderTray();
}

// ---- actions --------------------------------------------------------------
function togglePick(id) {
  const cat = currentCat();
  if (!cat) return;
  if (!S.entered) { $('gate').classList.remove('shake'); void $('gate').offsetWidth; $('gate').classList.add('shake'); return; }
  if (!isOpen(cat)) return toast(cat.phase === 'setup' ? "Voting hasn't started yet" : 'Voting closed');
  const i = S.picks.indexOf(id);
  if (i >= 0) S.picks.splice(i, 1);
  else if (S.picks.length >= cat.picks) {
    $('tray').classList.remove('shake'); void $('tray').offsetWidth; $('tray').classList.add('shake');
    return toast(`You've picked ${cat.picks} — remove one to add ${S.byId.get(id)?.name}`);
  } else S.picks.push(id);
  saveDraft(cat);
  renderResults();
  renderTray();
}

const BALLOT_MSG = {
  closed: 'Voting closed — this ballot did not count.',
  stale_list: 'The list was updated — check your picks and submit again.',
  stale_round: 'This category was restarted — check your picks and submit again.',
  voided: 'Your ballot in this category was removed by the organizer',
  not_entered: 'Scan the QR on the big screen to vote',
  too_many: 'Too many changes in this category.',
};

async function submit() {
  const cat = currentCat();
  if (!cat || S.inflight || S.picks.length !== cat.picks) return; // in-flight guard: a double tap is one submit
  S.inflight = true;
  renderTray();
  const body = { categoryId: cat.id, roundId: cat.roundId, listVersion: S.listVersion, picks: S.picks };
  try {
    let r = await api('/vote/ballot', { method: 'POST', body });
    if (r.status === 429 && r.json?.reason === 'too_fast') { await sleep(1100); r = await api('/vote/ballot', { method: 'POST', body }); }
    if (r.json?.live) await applyLive(r.json.live);
    if (r.status === 200) {
      S.ballots[cat.id] = { roundId: cat.roundId, picks: r.json.ballot };
      navigator.vibrate?.(30);
      toast('Your votes are in ✓', 'ok');
      return;
    }
    const reason = r.json?.reason;
    if (reason === 'not_entered') S.entered = false;
    if (reason === 'voided') S.voided.add(cat.id);
    if (reason === 'stale_list') await loadCandidates();
    toast(BALLOT_MSG[reason] ?? "Couldn't submit — try again", 'error');
  } finally {
    S.inflight = false;
    render();
  }
}

// ---- events ---------------------------------------------------------------
$('cards').addEventListener('click', (e) => { const c = e.target.closest('.cat-card'); if (c) openBallot(c.dataset.id); });
$('back').addEventListener('click', () => history.back());
$('q').addEventListener('input', () => { S.query = $('q').value; renderResults(); });
$('clear').addEventListener('click', () => { S.query = ''; $('q').value = ''; renderResults(); $('q').focus(); });
$('searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!S.query.trim() || !S.results.length) return;
  togglePick(S.results[0].id);
  S.query = '';
  $('q').value = '';
  renderResults(); // the keyboard stays up for the next name
});
$('results').addEventListener('click', (e) => { const row = e.target.closest('li.row'); if (row) togglePick(Number(row.dataset.id)); });
$('suggest').addEventListener('click', (e) => {
  const b = e.target.closest('.sug');
  if (!b) return;
  togglePick(Number(b.dataset.id));
  S.query = '';
  $('q').value = '';
  renderResults();
});
$('chips').addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (c) togglePick(Number(c.dataset.id)); });
$('submit').addEventListener('click', submit);
$('codeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  await enter($('codeInput').value, false);
  if (S.entered) await refreshMe();
  render();
});
function railJump(e) {
  const p = e.touches ? e.touches[0] : e;
  const L = document.elementFromPoint(p.clientX, p.clientY)?.dataset?.l;
  if (L) document.getElementById(`L-${L}`)?.scrollIntoView({ block: 'start' });
  e.preventDefault();
}
$('rail').addEventListener('touchstart', railJump, { passive: false });
$('rail').addEventListener('touchmove', railJump, { passive: false });
$('rail').addEventListener('click', railJump);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshLive().then(render); });
// Keep the fixed tray above the on-screen keyboard (iOS doesn't resize the layout viewport).
if (window.visualViewport) {
  const vv = window.visualViewport;
  const fit = () => document.documentElement.style.setProperty('--kb', `${Math.max(0, innerHeight - vv.height - vv.offsetTop)}px`);
  vv.addEventListener('resize', fit);
  vv.addEventListener('scroll', fit);
}

// ---- clock: countdowns, last-30-s warning, the deadline -------------------
function tickClock() {
  const now = serverNow();
  for (const el of document.querySelectorAll('.cat-card.open .tm')) {
    const cat = S.live?.categories.find((c) => c.id === el.parentElement.dataset.id);
    if (cat) el.textContent = mmss(cat.endsAt - now);
  }
  const cat = S.view === 'ballot' ? currentCat() : null;
  if (cat) {
    const left = cat.phase === 'open' ? cat.endsAt - now : 0;
    $('timer').textContent = cat.phase === 'open' ? mmss(left) : cat.phase === 'setup' ? 'Soon' : 'Closed';
    const unsent = S.picks.length > 0 && !sameSet(submittedPicks(cat), S.picks);
    $('warn').hidden = !(cat.phase === 'open' && left > 0 && left <= 30_000 && unsent);
    const key = `${cat.id}:${cat.roundId}`;
    if (cat.phase !== 'setup' && left <= 0 && !S.deadlineShown.has(key)) {
      S.deadlineShown.add(key);
      if (unsent) {
        $('deadlineMsg').textContent = "Time's up — your unsubmitted picks didn't count.";
        $('deadlineMsg').hidden = false;
      }
      renderTray();
    }
    if (left > 0 && S.deadlineShown.has(key)) S.deadlineShown.delete(key);
    if (left > 0) $('deadlineMsg').hidden = true;
  }
  requestAnimationFrame(tickClock);
}

// ---- boot -----------------------------------------------------------------
(async () => {
  const k = new URLSearchParams(location.search).get('k');
  if (k) history.replaceState(null, '', '/vote');
  await refreshMe();
  if (k && !S.entered) await enter(k, true);
  await refreshLive();
  if (S.entered) await refreshMe();
  S.booting = false;
  // A reload keeps you in the ballot you were on: the browser keeps history.state.
  const back = history.state?.cat;
  if (back && S.live?.categories.some((c) => c.id === back)) openBallot(back, false);
  else maybeAutoOpen();
  render();
  for (let i = 1; i < 4; i++) setTimeout(refreshLive, i * 250); // min-RTT needs a few samples
  setTimeout(poll, S.pollMs);
  requestAnimationFrame(tickClock);
})();
```

- [ ] **Step 5: Run the checks**

Run: `npm run check:vote`
Expected: API + phone sections all ✔. Open `/tmp/vote-check/phone-ballot.png`, `phone-home.png`, `phone-360.png` and look: sticky header + search, readable highlights, tray clear of the safe area, nothing clipped.

- [ ] **Step 6: Commit**

```bash
git add public/vote/phone.html src/server.js scripts/vote-check.mjs
git commit -m "Live Vote: phone page — room gate, category home, search-first ballot"
```

---

### Task 6: Big screen — `/vote/screen`

**Files:**
- Create: `public/vote/screen.html`
- Modify: `src/server.js` (precompress line), `scripts/vote-check.mjs` (append `screenChecks`)

**Interfaces:**
- Consumes: `rankCounts` from `/vote/search.js` (Task 1); `/vote/events` frames, `/admin/session`, `/admin/login`, `/vote/live` (clock), `/qr.svg?data=` (Task 4 and existing).
- Produces — DOM contract:
  - `#login` (overlay) > `#token`, `#loginBtn`, `#loginErr`
  - `#lobby` > `#lobbyQr` (svg), `#lobbyCode`, `#lobbyCats`
  - `#stage` with class `n1`…`n6` > `section.panel[data-id]` > `.ptitle`, `.ptimer`, `.pmeta`, `ol.rows` > `li.prow[data-id]` > `.pname`, `.pvotes`, `.ppct`, `.bar`; a closed panel gets `.podium` and a `.tie` label when the top is tied
  - `#side` > `#qrBox` > `#qr` (svg) + `#code` + `svg#ring`; `#entryClosed`; `#total`; `#feed` > `li.item`
  - `canvas#confetti`

- [ ] **Step 1: Write the failing browser check** — append to `scripts/vote-check.mjs` above `await apiChecks();` and call `await screenChecks();` after `phoneChecks()`:

```js
async function screenChecks() {
  const S = startServer(8148);
  const browser = await chromium.launch();
  try {
    await S.ready;
    const admin = await adminClient(S.base);
    console.log('\n== screen: login and lobby ==');
    const anon = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
    await anon.goto(`${S.base}/vote/screen`);
    await anon.waitForSelector('#login:not([hidden])');
    ok(true, 'no admin session → the screen asks for the password');

    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    await page.goto(`${S.base}/vote/screen`);
    await page.fill('#token', TOKEN);
    await page.click('#loginBtn');
    await page.waitForSelector('#lobby:not([hidden])');
    const code1 = (await page.textContent('#lobbyCode')).trim();
    ok(/^[A-HJKMNP-Z2-9]{5}$/.test(code1), 'lobby shows the 5-char room code');
    ok((await page.locator('#lobbyQr svg').count()) === 1, 'lobby shows the QR');
    ok((await page.locator('#lobbyCats li').count()) === 5, 'lobby lists the categories');
    await page.screenshot({ path: `${SHOTS}/screen-lobby.png` });
    await page.waitForFunction((c) => document.getElementById('lobbyCode').textContent.trim() !== c, code1, { timeout: CODE_MS + 2000 });
    ok(true, 'the code rotates on its own');

    console.log('\n== screen: live stage ==');
    let live = (await admin.req('/vote/live')).json;
    const [c1, c2] = live.categories;
    await admin.req('/vote/admin/open', { method: 'POST', body: { categoryIds: [c1.id, c2.id] } });
    await page.waitForSelector('#stage.n2');
    ok((await page.locator('#stage .panel').count()) === 2, 'two open categories → two panels');
    live = (await admin.req('/vote/live')).json;
    const cat1 = live.categories.find((c) => c.id === c1.id);
    const code = (await page.textContent('#code')).trim();
    for (const [i, picks] of [[0, [0, 1, 2]], [1, [0, 1, 3]], [2, [0, 4, 5]]]) {
      const v = client(S.base, { ip: `192.0.2.${i + 10}`, ua: `Phone${i}` });
      await enterWith(v, code);
      await ballot(v, cat1, live.listVersion, picks);
    }
    const top = page.locator(`#stage .panel[data-id="${c1.id}"] li.prow`).first();
    await page.waitForFunction((id) => document.querySelector(`#stage .panel[data-id="${id}"] li.prow .pvotes`)?.textContent.trim() === '3', c1.id, { timeout: 2000 });
    ok((await top.locator('.pname').textContent()).includes('Ana Souza'), 'Ana Souza leads with 3 within ~1 s');
    ok((await top.locator('.ppct').textContent()).includes('100'), '…on 100 % of ballots');
    ok((await page.locator('#feed li.item').count()) >= 3, 'the live feed shows the +1s');
    ok((await page.textContent('#feed')).includes(c1.title), '…tagged with the category');
    ok(/^\d+:\d\d$/.test((await page.locator(`#stage .panel[data-id="${c1.id}"] .ptimer`).textContent()).trim()), 'each panel has its own countdown');
    await page.screenshot({ path: `${SHOTS}/screen-live.png` });

    await admin.req('/vote/admin/entry', { method: 'POST', body: { open: false } });
    await page.waitForSelector('#entryClosed:not([hidden])');
    ok(await page.isHidden('#qrBox'), 'entry closed → the QR is hidden');
    await admin.req('/vote/admin/entry', { method: 'POST', body: { open: true } });

    console.log('\n== screen: reveal and stage ==');
    await admin.req('/vote/admin/close', { method: 'POST', body: { categoryIds: [c1.id] } });
    await page.waitForSelector(`#stage.n1 .panel[data-id="${c2.id}"]`);
    ok(true, 'auto stage follows the categories still open');
    await admin.req('/vote/admin/close', { method: 'POST', body: { categoryIds: [c2.id] } });
    await admin.req('/vote/admin/stage', { method: 'POST', body: { mode: 'pinned', categoryIds: [c1.id] } });
    await page.waitForSelector(`#stage .panel.podium[data-id="${c1.id}"]`);
    ok((await page.textContent(`#stage .panel[data-id="${c1.id}"]`)).includes('Ana Souza'), 'pinned closed category shows its podium');
    await page.screenshot({ path: `${SHOTS}/screen-podium.png` });
  } finally {
    await browser.close();
    S.child.kill();
  }
}
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm run check:vote`
Expected: `== screen ==` fails at `#login` (404 for `/vote/screen`).

- [ ] **Step 3: Register the page** — `src/server.js`, after the phone precompress line:

```js
precompress('vote/screen.html', HTML, ['/vote/screen', '/vote/screen.html']);
```

- [ ] **Step 4: Build `public/vote/screen.html`**

Markup:

```html
<div id="login" class="overlay" hidden>
  <div class="gcard box">
    <h2>Live Vote · screen</h2>
    <input id="token" type="password" placeholder="Admin password" autocomplete="current-password">
    <button id="loginBtn">Show the screen</button>
    <p id="loginErr" class="err"></p>
  </div>
</div>
<div id="lobby" class="overlay lobby" hidden>
  <h1>Live Vote</h1>
  <div id="lobbyQr" class="qr"></div>
  <p class="codeline">or open <b id="lobbyHost"></b>/vote and type <span id="lobbyCode" class="mono"></span></p>
  <p class="soon">Voting starts soon</p>
  <ul id="lobbyCats"></ul>
</div>
<main>
  <div id="stage" class="n1"></div>
  <aside id="side">
    <div id="qrBox">
      <div id="qr" class="qr"></div>
      <div class="codeline"><span id="code" class="mono"></span>
        <svg id="ring" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="16" pathLength="100"/></svg></div>
    </div>
    <div id="entryClosed" hidden>Entry closed</div>
    <div class="total"><span id="total" class="mono">0</span> ballots</div>
    <ol id="feed"></ol>
  </aside>
</main>
<canvas id="confetti"></canvas>
```

`#ring circle{fill:none; stroke:var(--primary); stroke-width:3; stroke-dasharray:100; stroke-dashoffset:calc((1 - var(--p, 1)) * 100); transform:rotate(-90deg); transform-origin:center}` — it empties as the code ages.

Layout: 16:9, `body{overflow:hidden; height:100vh}`; a CSS grid `main{grid-template-columns:1fr 26vw}` — `#stage` left, `#side` right. Lobby is a full-screen overlay (`#lobby`) with the QR at ~42vh. Stage grids: `.n1{grid-template-columns:1fr}`, `.n2{repeat(2,1fr)}`, `.n3{repeat(3,1fr)}`, `.n4{repeat(2,1fr); grid-template-rows:1fr 1fr}`, `.n5,.n6{repeat(3,1fr); grid-template-rows:1fr 1fr}`. Type sizes in `vh` so a projector reads them from the back: panel titles ~3.2vh (n1: 4.5vh), names ~2.6vh (n1: 3.4vh), counts in `--font-mono`. Bars are an absolutely-positioned `.bar` behind each row, `transition: width .5s`. `.prow.pulse` flashes a green glow for 700 ms. `#feed li.item` slides in from the right (`@keyframes in`). The podium: three columns 2nd · 1st · 3rd, heights 60/80/45 % of the panel, gold/silver/bronze accents from the theme, names large.

Login overlay: same flow as `public/host.html:182-213` — `POST /admin/login {token}`, then `connect()`; wrong password → `#loginErr` "Wrong password".

Script — `<script type="module">`:

```js
import { rankCounts } from '/vote/search.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const TOP = { 1: 10, 2: 8, 3: 6, 4: 5, 5: 3, 6: 3 };

let clockOffset = 0;
let bestRtt = Infinity;
const serverNow = () => Date.now() + clockOffset;
async function sampleClock() { // same min-RTT rule as public/screen.html:159-170
  const t0 = Date.now();
  try {
    const r = await fetch('/vote/live', { cache: 'no-store' });
    const t1 = Date.now();
    const sn = Number(r.headers.get('x-server-now'));
    const rtt = t1 - t0;
    if (!sn || rtt < 0 || rtt > 5000) return;
    if (Math.abs(sn - t1 - clockOffset) > 5000) bestRtt = Infinity;
    if (rtt > bestRtt) return;
    bestRtt = rtt;
    clockOffset = sn + rtt / 2 - t1;
  } catch { /* next sample */ }
}

let F = null; // latest frame
let shownCode = null;
let lastFeedSeq = 0;
const prevPhase = new Map(); // categoryId -> phase in the previous frame
const prevVotes = new Map(); // `${cat}:${cand}` -> votes in the previous frame
let es = null;

async function setQr(code) {
  const url = `${location.origin}/vote?k=${code}`;
  const svg = await fetch(`/qr.svg?data=${encodeURIComponent(url)}`).then((r) => r.text()).catch(() => '');
  if (code !== shownCode) return; // rotated again while fetching
  $('qr').innerHTML = svg;
  $('lobbyQr').innerHTML = svg;
}

function connect() {
  es?.close();
  es = new EventSource('/vote/events');
  es.onmessage = (e) => onFrame(JSON.parse(e.data));
  es.onerror = async () => {
    const s = await fetch('/admin/session').then((r) => r.json()).catch(() => null);
    if (s && !s.authenticated) { es.close(); $('login').hidden = false; }
  };
}

function onFrame(f) {
  if (bestRtt === Infinity) clockOffset = f.now - Date.now(); // until sampleClock lands
  F = f;
  $('login').hidden = true;
  if (f.code !== shownCode) {
    shownCode = f.code;
    $('code').textContent = f.code;
    $('lobbyCode').textContent = f.code;
    setQr(f.code);
  }
  $('qrBox').hidden = !f.entryOpen;
  $('entryClosed').hidden = f.entryOpen;
  $('total').textContent = new Intl.NumberFormat('en').format(f.totalBallots);
  renderFeed(f);
  const show = f.stage.show;
  $('lobby').hidden = show.length > 0;
  if (!show.length) {
    $('lobbyCats').innerHTML = f.categories.map((c) => `<li>${esc(c.title)} <span>· pick ${c.picks}</span></li>`).join('');
  }
  renderStage(f, show);
  for (const c of f.categories) prevPhase.set(c.id, c.phase);
}

function renderFeed(f) {
  const titles = new Map(f.categories.map((c) => [c.id, c.title]));
  const fresh = f.feed.filter((e) => e.seq > lastFeedSeq);
  if (!fresh.length) return;
  lastFeedSeq = fresh[fresh.length - 1].seq;
  for (const e of fresh) {
    const li = document.createElement('li');
    li.className = 'item';
    li.innerHTML = `<b>+1</b> ${esc(f.candidates[e.candidateId]?.name ?? '')} <span>· ${esc(titles.get(e.categoryId) ?? '')}</span>`;
    $('feed').prepend(li);
  }
  while ($('feed').children.length > 8) $('feed').lastElementChild.remove();
}

function renderStage(f, show) {
  let reveal = 0; // several closing in one frame get their moments in turn
  const stage = $('stage');
  stage.className = `n${Math.max(1, show.length)}`;
  const keep = new Set(show);
  for (const p of [...stage.children]) if (!keep.has(p.dataset.id)) p.remove();
  show.forEach((id, i) => {
    const cat = f.categories.find((c) => c.id === id);
    let panel = stage.querySelector(`.panel[data-id="${id}"]`);
    const isNew = !panel;
    if (isNew) {
      panel = document.createElement('section');
      panel.className = 'panel';
      panel.dataset.id = id;
      panel.innerHTML = '<header><h2 class="ptitle"></h2><span class="ptimer mono"></span></header><div class="pmeta"></div><ol class="rows"></ol>';
    }
    if (stage.children[i] !== panel) stage.insertBefore(panel, stage.children[i] ?? null);
    panel.querySelector('.ptitle').textContent = cat.title;
    panel.querySelector('.pmeta').textContent = `Pick ${cat.picks} · ${cat.ballotCount} ballot${cat.ballotCount === 1 ? '' : 's'}`;
    const ranked = rankCounts(f.candidates, cat.counts);
    const justClosed = prevPhase.get(id) === 'open' && cat.phase === 'closed';
    if (cat.phase === 'closed') {
      const k = cat.counts.join(',');
      if (justClosed) {
        panel.dataset.pending = '1';
        setTimeout(() => {
          delete panel.dataset.pending;
          renderPodium(panel, ranked);
          panel.dataset.k = k;
          burst();
        }, reveal++ * 1500);
      } else if (!panel.dataset.pending && (panel.dataset.k !== k || !panel.classList.contains('podium'))) {
        // Counts can still move after the close (the admin can void): keep the podium true.
        renderPodium(panel, ranked);
        panel.dataset.k = k;
      }
    } else {
      delete panel.dataset.k;
      panel.classList.remove('podium');
      renderRows(panel, cat, ranked.slice(0, TOP[show.length] ?? 3));
    }
  });
}

// FLIP: the same technique as public/screen.html:243-307 — measure, reorder,
// then animate each row from where it was.
function renderRows(panel, cat, rows) {
  let list = panel.querySelector('ol.rows');
  if (!list) { panel.querySelector('.podium-wrap')?.remove(); list = document.createElement('ol'); list.className = 'rows'; panel.append(list); }
  const first = new Map([...list.children].map((el) => [el.dataset.id, el.getBoundingClientRect().top]));
  const existing = new Map([...list.children].map((el) => [el.dataset.id, el]));
  const max = Math.max(1, rows[0]?.votes ?? 0);
  const els = rows.map((r) => {
    let el = existing.get(String(r.id));
    existing.delete(String(r.id));
    if (!el) {
      el = document.createElement('li');
      el.className = 'prow';
      el.dataset.id = String(r.id);
      el.innerHTML = '<span class="bar"></span><span class="prank mono"></span><span class="pname"></span><span class="pvotes mono"></span><span class="ppct mono"></span>';
    }
    el.querySelector('.prank').textContent = r.votes ? r.rank : '–';
    el.querySelector('.pname').textContent = r.name;
    el.querySelector('.pvotes').textContent = r.votes;
    el.querySelector('.ppct').textContent = cat.ballotCount ? `${Math.round((r.votes / cat.ballotCount) * 100)}%` : '0%';
    el.querySelector('.bar').style.width = `${(r.votes / max) * 100}%`;
    const key = `${cat.id}:${r.id}`;
    if ((prevVotes.get(key) ?? 0) < r.votes) { el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); }
    prevVotes.set(key, r.votes);
    return el;
  });
  for (const el of existing.values()) el.remove();
  for (const el of els) list.appendChild(el);
  for (const el of els) {
    const was = first.get(el.dataset.id);
    if (was === undefined) continue;
    const dy = was - el.getBoundingClientRect().top;
    if (!dy) continue;
    el.style.transition = 'none';
    el.style.transform = `translateY(${dy}px)`;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.style.transition = 'transform .45s cubic-bezier(.2,.8,.2,1)';
      el.style.transform = '';
    }));
  }
}

function renderPodium(panel, ranked) {
  panel.classList.add('podium');
  panel.querySelector('ol.rows')?.remove();
  panel.querySelector('.podium-wrap')?.remove();
  const top = ranked.filter((r) => r.votes > 0 && r.rank <= 3).slice(0, 5);
  const tie = ranked.length > 1 && ranked[0].votes > 0 && ranked[1].votes === ranked[0].votes;
  const step = (rank) => top.filter((r) => r.rank === rank).map((r) => `<div class="pod-name">${esc(r.name)}</div><div class="pod-votes mono">${r.votes}</div>`).join('');
  const wrap = document.createElement('div');
  wrap.className = 'podium-wrap';
  wrap.innerHTML = (tie ? '<div class="tie">It\'s a tie!</div>' : '') +
    `<div class="steps"><div class="step s2">${step(2)}</div><div class="step s1">${step(1)}</div><div class="step s3">${step(3)}</div></div>`;
  panel.append(wrap);
}

function tick() {
  const now = serverNow();
  if (F) {
    for (const panel of document.querySelectorAll('#stage .panel')) {
      const cat = F.categories.find((c) => c.id === panel.dataset.id);
      if (!cat) continue;
      panel.querySelector('.ptimer').textContent = cat.phase === 'open' ? mmss(cat.endsAt - now) : cat.phase === 'closed' ? 'Closed' : 'Soon';
    }
    // The server sends a frame at every rotation, so codeRotatesAt is always the next one.
    const frac = Math.min(1, Math.max(0, (F.codeRotatesAt - now) / F.codeMs));
    $('ring').style.setProperty('--p', frac.toFixed(3));
  }
  requestAnimationFrame(tick);
}
```

Then the confetti: copy the self-contained block from `public/screen.html:350-385` verbatim and expose its start function as `burst()` (it targets `canvas#confetti`; start it for ~3 s). Boot:

```js
$('loginBtn').addEventListener('click', async () => {
  const r = await fetch('/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: $('token').value }) });
  if (r.ok) { $('token').value = ''; connect(); } else $('loginErr').textContent = 'Wrong password';
});
$('token').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('loginBtn').click(); });
$('lobbyHost').textContent = location.host;
fetch('/admin/session').then((r) => r.json()).then((s) => { if (s.authenticated) connect(); else $('login').hidden = false; });
for (let i = 0; i < 4; i++) setTimeout(sampleClock, i * 200);
setInterval(sampleClock, 15000);
requestAnimationFrame(tick);
```

- [ ] **Step 5: Run the checks**

Run: `npm run check:vote`
Expected: API, phone and screen sections all ✔. Look at `screen-lobby.png`, `screen-live.png`, `screen-podium.png` at 1920×1080: readable from a distance, nothing overflowing, the QR quiet zone intact.

- [ ] **Step 6: Commit**

```bash
git add public/vote/screen.html src/server.js scripts/vote-check.mjs
git commit -m "Live Vote: big screen — adaptive stage, rotating QR, live feed, podium"
```

---

### Task 7: Admin page — `/vote/admin`

**Files:**
- Create: `public/vote/admin.html`
- Modify: `src/server.js` (precompress line), `scripts/vote-check.mjs` (append `adminChecks`)

**Interfaces:**
- Consumes: `buildIndex`, `search`, `rankCounts`, `fold` from `/vote/search.js`; `/vote/events`; every `/vote/admin/*` route; `/admin/login`, `/admin/session`, `/admin/logout`.
- Produces — DOM contract:
  - `#login` > `#token`, `#loginBtn`, `#loginErr`; `#app`
  - Top bar: `#devices`, `#entryBtn` ("Close entry" / "Reopen entry"), links to `/vote` and `/vote/screen`
  - Board: `#board` > `.board-row[data-id]` > `input.sel`, `.ph`, `.tm`, `.bc`, `button.open`, `button.close`, `button.reset`, `button.onscreen[aria-pressed]`; `#dur` > `button[data-min]` (1, 2, 3, 5, 10; `.on` = selected, 3 by default), `#durCustom`, `#openSelected`, `#stageAuto`
  - Flags: `#flags` > `.flag[data-id]` > `.why`, `.names`, `button.void` (text "Void" / "Restore"); `#voidedTotal`
  - Results: `#resTabs` > `button[data-id]`, `#resFilter`, `#resTable tbody tr`, `#csv`
  - Setup: `#names` (textarea), `#namesCount`, `#namesErr`, `#cats` > `.cat-row` > `input.title`, `input.picks`, `button.up`, `button.down`, `button.del`; `#addCat`; `#saveConfig`; `#saveWarn`; `#configErr`; `#restoreBar` > `#restoreBtn`

- [ ] **Step 1: Write the failing browser check** — append above `await apiChecks();`, call `await adminChecks();` after `screenChecks()`:

```js
async function adminChecks() {
  let S = startServer(8149);
  const browser = await chromium.launch();
  try {
    await S.ready;
    console.log('\n== admin: login and setup ==');
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    const page = await ctx.newPage();
    const login = async () => {
      await page.goto(`${S.base}/vote/admin`);
      await page.waitForSelector('#login:not([hidden])');
      await page.fill('#token', TOKEN);
      await page.click('#loginBtn');
      await page.waitForSelector('#app:not([hidden])');
    };
    await login();
    ok(true, 'login reveals the admin app');
    await page.waitForFunction(() => document.getElementById('names').value.split('\n').length === 120);
    ok(/120/.test(await page.textContent('#namesCount')), 'names textarea holds the 120 seed names');

    await page.fill('#names', (await page.inputValue('#names')) + '\nana souza');
    ok(/same name/.test(await page.textContent('#namesErr')), 'a duplicate (any case/accents) is flagged inline');
    ok(await page.isDisabled('#saveConfig'), '…and Save is disabled');
    await page.fill('#names', SEED_NAMES.join('\n'));
    await page.locator('#cats .cat-row').first().locator('input.title').fill('MVP 2026');
    await page.locator('#cats .cat-row').first().locator('input.picks').fill('2');
    await page.click('#saveConfig');
    const admin = await adminClient(S.base);
    await sleep(300);
    let live = (await admin.req('/vote/live')).json;
    ok(live.categories[0].title === 'MVP 2026' && live.categories[0].picks === 2, 'saving updates title and N');

    console.log('\n== admin: control board ==');
    const [c1, c2] = live.categories;
    await page.check(`#board .board-row[data-id="${c1.id}"] input.sel`);
    await page.check(`#board .board-row[data-id="${c2.id}"] input.sel`);
    await page.click('#dur button[data-min="1"]');
    await page.click('#openSelected');
    await sleep(300);
    live = (await admin.req('/vote/live')).json;
    const o1 = live.categories.find((c) => c.id === c1.id);
    ok(o1.phase === 'open' && Math.abs(o1.endsAt - Date.now() - 60_000) < 5000, 'open selected with the 1-min chip');
    ok(live.categories.find((c) => c.id === c2.id).phase === 'open', '…both categories');
    ok(await page.isDisabled('#saveConfig'), 'setup is locked while a category is open');

    const v = client(S.base, { ip: '192.0.2.77' });
    await enterWith(v, (await frame(admin)).code);
    await ballot(v, o1, live.listVersion, [0, 1]);
    await page.waitForFunction((id) => document.querySelector(`#board .board-row[data-id="${id}"] .bc`)?.textContent.includes('1'), c1.id);
    ok(true, 'the board shows the ballot count live');
    await page.click(`#board .board-row[data-id="${c1.id}"] button.close`);
    let dialog = '';
    page.once('dialog', async (d) => { dialog = d.message(); await d.accept(); });
    await page.click(`#board .board-row[data-id="${c1.id}"] button.open`);
    await sleep(300);
    ok(/clears its 1 ballot/.test(dialog), 'reopening a category with ballots asks first');
    await page.click(`#board .board-row[data-id="${c2.id}"] button.onscreen`);
    await sleep(300);
    ok((await frame(admin)).stage.show.join() === c2.id, '"On screen" pins the stage');
    await page.click('#stageAuto');
    await sleep(300);
    ok((await frame(admin)).stage.mode === 'auto', '"Auto" restores the automatic stage');
    await page.click('#entryBtn');
    await sleep(300);
    ok((await admin.req('/vote/live')).json.entryOpen === false, 'Close entry works');
    await page.click('#entryBtn');

    console.log('\n== admin: fraud panel and results ==');
    live = (await admin.req('/vote/live')).json;
    const cat = live.categories.find((c) => c.id === c2.id);
    const fr = await frame(admin);
    await sleep(fr.codeRotatesAt - fr.now + 50);
    const code = (await frame(admin)).code;
    for (let i = 0; i < 5; i++) {
      const b = client(S.base, { ip: '203.0.113.60', ua: 'BotPhone/2.0' });
      await enterWith(b, code);
      await ballot(b, cat, live.listVersion, [7, 8, 9]);
    }
    await page.waitForSelector('#flags .flag', { timeout: 4000 });
    ok(/identical ballot/.test(await page.textContent('#flags .flag .why')), 'cluster flag explained in plain English');
    ok((await page.textContent('#flags .flag .names')).includes(SEED_NAMES[7]), '…naming the ballot');
    await page.click('#flags .flag button.void');
    await page.waitForFunction(() => document.querySelector('#flags .flag button.void')?.textContent.trim() === 'Restore');
    ok((await frame(admin)).categories.find((c) => c.id === cat.id).voidedCount === 5, 'Void removes the five ballots');
    ok(/5/.test(await page.textContent('#voidedTotal')), 'voided total updates');

    await page.click(`#resTabs button[data-id="${c2.id}"]`);
    await page.fill('#resFilter', 'joao');
    ok((await page.locator('#resTable tbody tr').count()) >= 1 && (await page.textContent('#resTable tbody')).includes('João'), 'results filter uses the same search');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#csv')]);
    const csv = await (await import('node:fs/promises')).readFile(await dl.path(), 'utf8');
    ok(csv.startsWith('category,rank,name,votes\n') && csv.includes('"MVP 2026"'), 'CSV export covers every category');
    await page.screenshot({ path: `${SHOTS}/admin.png`, fullPage: true });

    console.log('\n== admin: restore after restart ==');
    await admin.req('/vote/admin/close', { method: 'POST', body: { categoryIds: [c1.id, c2.id] } });
    const exited = new Promise((r) => S.child.once('exit', r));
    S.child.kill();
    await exited; // the port must be free before the restart binds it
    S = startServer(8149);
    await S.ready;
    await login();
    await page.waitForSelector('#restoreBar:not([hidden])');
    await page.click('#restoreBtn');
    await page.click('#saveConfig');
    await sleep(300);
    const after = (await (await adminClient(S.base)).req('/vote/live')).json;
    ok(after.categories[0].title === 'MVP 2026', 'the saved setup is restored after a restart');

    console.log('\n== admin: phone width ==');
    const m = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage();
    await m.goto(`${S.base}/vote/admin`);
    await m.fill('#token', TOKEN);
    await m.click('#loginBtn');
    await m.waitForSelector('#app:not([hidden])');
    ok(await m.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth), 'admin has no horizontal scroll on a phone');
    await m.screenshot({ path: `${SHOTS}/admin-phone.png`, fullPage: true });
  } finally {
    await browser.close();
    S.child.kill();
  }
}
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm run check:vote`
Expected: `== admin ==` fails at `#login` (404 for `/vote/admin`).

- [ ] **Step 3: Register the page** — `src/server.js`, after the screen precompress line:

```js
precompress('vote/admin.html', HTML, ['/vote/admin', '/vote/admin.html']);
```

- [ ] **Step 4: Build `public/vote/admin.html`**

Markup:

```html
<div id="login" class="center" hidden>
  <div class="gcard box">
    <h1>Live Vote · admin</h1>
    <input id="token" type="password" placeholder="Admin password" autocomplete="current-password">
    <button id="loginBtn">Log in</button>
    <p id="loginErr" class="err"></p>
  </div>
</div>
<div id="app" hidden>
  <header class="bar">
    <h1>Live Vote</h1><span id="devices" class="pill"></span>
    <button id="entryBtn"></button>
    <a href="/vote" target="_blank">Phone page</a><a href="/vote/screen" target="_blank">Big screen</a>
  </header>
  <div class="grid">
    <section class="col">
      <div class="gcard"><h2>Control board</h2>
        <div id="board"></div>
        <div class="openbar">
          <div id="dur"><button data-min="1">1 min</button><button data-min="2">2 min</button><button data-min="3" class="on">3 min</button><button data-min="5">5 min</button><button data-min="10">10 min</button></div>
          <label>Custom <input id="durCustom" type="number" min="0.5" max="240" step="0.5" placeholder="min"></label>
          <button id="openSelected" class="primary">Open selected</button>
        </div>
        <div class="stagebar">Big screen: <button id="stageAuto">Auto</button> <span class="muted">or pin categories with "On screen"</span></div>
      </div>
      <div class="gcard"><h2>Fraud panel <span id="voidedTotal" class="muted"></span></h2><div id="flags"></div></div>
      <div class="gcard"><h2>Results</h2>
        <div id="resTabs"></div>
        <input id="resFilter" type="search" placeholder="Filter names" autocomplete="off">
        <table id="resTable"><thead><tr><th>#</th><th>Name</th><th>Votes</th></tr></thead><tbody></tbody></table>
        <button id="csv">Download CSV</button>
      </div>
    </section>
    <section class="col">
      <div class="gcard"><h2>Setup</h2>
        <div id="restoreBar" class="warn" hidden>The server restarted with the sample setup. <button id="restoreBtn">Restore the setup saved in this browser</button></div>
        <label for="names">Names, one per line <span id="namesCount" class="muted"></span></label>
        <textarea id="names" rows="14" spellcheck="false"></textarea>
        <p id="namesErr" class="err"></p>
        <h3>Categories</h3>
        <div id="cats"></div>
        <button id="addCat">+ Add category</button>
        <p id="saveWarn" class="warn"></p>
        <button id="saveConfig" class="primary">Save names &amp; categories</button>
        <p id="configErr" class="err"></p>
      </div>
    </section>
  </div>
</div>
```

Layout: `theme.css`, cards (`.gcard`) in a two-column grid ≥ 960 px (left: control board + flags + results; right: setup), one column below. Inputs ≥ 16 px; buttons ≥ 44 px. The setup card shows "Close every open category to edit" when locked.

Script — `<script type="module">`:

```js
import { buildIndex, search, rankCounts, fold } from '/vote/search.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const DRAFT = 'tv_admin_draft';
let F = null;
let dirty = false; // the setup form has edits the server doesn't
let lastCfgKey = ''; // refill the form only when the server's setup actually changed
let boardKey = '';
let flagsKey = '';
let tabsKey = '';
let cats = []; // setup form rows: [{id?, title, picks}]
let resTab = null;
let durMin = 3;
let es = null;

async function post(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const json = await r.json().catch(() => ({}));
  if (r.status === 401) showLogin();
  return { status: r.status, json };
}

// ---- login (same flow as public/host.html:182-213) ------------------------
function showLogin() { $('login').hidden = false; $('app').hidden = true; es?.close(); }
async function login() {
  const r = await fetch('/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: $('token').value }) });
  if (!r.ok) { $('loginErr').textContent = 'Wrong password'; return; }
  $('token').value = '';
  start();
}
function start() {
  $('login').hidden = true;
  $('app').hidden = false;
  es?.close();
  es = new EventSource('/vote/events');
  es.onmessage = (e) => onFrame(JSON.parse(e.data));
  es.onerror = async () => {
    const s = await fetch('/admin/session').then((r) => r.json()).catch(() => null);
    if (s && !s.authenticated) showLogin();
  };
}

// ---- setup form ------------------------------------------------------------
const anyOpen = () => !!F?.categories.some((c) => c.phase === 'open');
const formNames = () => $('names').value.split('\n').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);

function validate() {
  const names = formNames();
  const errs = [];
  const seen = new Map();
  names.forEach((n, i) => {
    if (n.length > 60) errs.push(`Line ${i + 1} is over 60 characters.`);
    const k = fold(n).text;
    if (seen.has(k)) errs.push(`"${n}" (line ${i + 1}) is the same name as line ${seen.get(k) + 1}.`);
    else seen.set(k, i);
  });
  if (names.length < 2 || names.length > 300) errs.push(`Between 2 and 300 names (now ${names.length}).`);
  const max = Math.min(10, names.length);
  cats.forEach((c, i) => {
    if (!c.title.trim()) errs.push(`Category ${i + 1} needs a title.`);
    if (!(Number.isInteger(c.picks) && c.picks >= 1 && c.picks <= max)) errs.push(`Category ${i + 1} must ask for 1–${max} picks.`);
  });
  if (cats.length < 1 || cats.length > 6) errs.push('Between 1 and 6 categories.');
  $('namesCount').textContent = `${names.length} names`;
  $('namesErr').textContent = errs.join(' ');
  $('saveConfig').disabled = errs.length > 0 || anyOpen();
  $('saveWarn').textContent = clearWarning(names);
  return errs.length === 0;
}

function clearWarning(names) {
  if (!F) return '';
  const namesChanged = names.length !== F.candidates.length || names.some((n, i) => n !== F.candidates[i].name);
  const total = F.categories.reduce((s, c) => s + c.ballotCount, 0);
  if (namesChanged && total) return `Changing the names clears all ${total} ballots in every category.`;
  return cats.map((c) => {
    const cur = F.categories.find((x) => x.id === c.id);
    return cur && cur.picks !== c.picks && cur.ballotCount ? `Changing N clears ${cur.ballotCount} ballots in ${cur.title}.` : '';
  }).filter(Boolean).join(' ');
}

function renderCats() {
  $('cats').innerHTML = cats.map((c, i) => `<div class="cat-row" data-i="${i}">` +
    `<input class="title" value="${esc(c.title)}" maxlength="60" aria-label="Category title">` +
    `<label>Pick exactly <input class="picks" type="number" min="1" max="10" value="${c.picks}"></label>` +
    `<button class="up" aria-label="Move up">↑</button><button class="down" aria-label="Move down">↓</button><button class="del" aria-label="Remove">✕</button></div>`).join('');
}

function fillFromServer() {
  $('names').value = F.candidates.map((c) => c.name).join('\n');
  cats = F.categories.map((c) => ({ id: c.id, title: c.title, picks: c.picks }));
  renderCats();
  dirty = false;
  validate();
}

function saveDraft() {
  try { localStorage.setItem(DRAFT, JSON.stringify({ names: formNames(), categories: cats.map(({ title, picks }) => ({ title, picks })) })); } catch { /* ignore */ }
}

function maybeOfferRestore() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(DRAFT) || 'null'); } catch { /* ignore */ }
  const differs = d && (d.names.join('\n') !== F.candidates.map((c) => c.name).join('\n') ||
    JSON.stringify(d.categories) !== JSON.stringify(F.categories.map(({ title, picks }) => ({ title, picks }))));
  // listVersion 1 = the server is still on its boot seed: memory was wiped.
  $('restoreBar').hidden = !(F.listVersion === 1 && differs);
}

$('names').addEventListener('input', () => { dirty = true; validate(); });
$('cats').addEventListener('input', (e) => {
  const row = e.target.closest('.cat-row');
  if (!row) return;
  const c = cats[Number(row.dataset.i)];
  if (e.target.classList.contains('title')) c.title = e.target.value;
  if (e.target.classList.contains('picks')) c.picks = Number(e.target.value);
  dirty = true;
  validate();
});
$('cats').addEventListener('click', (e) => {
  const row = e.target.closest('.cat-row');
  if (!row) return;
  const i = Number(row.dataset.i);
  if (e.target.classList.contains('up') && i > 0) [cats[i - 1], cats[i]] = [cats[i], cats[i - 1]];
  else if (e.target.classList.contains('down') && i < cats.length - 1) [cats[i + 1], cats[i]] = [cats[i], cats[i + 1]];
  else if (e.target.classList.contains('del')) cats.splice(i, 1);
  else return;
  dirty = true;
  renderCats();
  validate();
});
$('addCat').addEventListener('click', () => { if (cats.length < 6) { cats.push({ title: '', picks: 3 }); dirty = true; renderCats(); validate(); } });
$('saveConfig').addEventListener('click', async () => {
  if (!validate()) return;
  const r = await post('/vote/admin/config', { names: formNames(), categories: cats });
  $('configErr').textContent = r.status === 200 ? '' : (r.json.errors ?? ['Save failed']).join(' ');
  if (r.status === 200) { saveDraft(); dirty = false; $('restoreBar').hidden = true; }
});
$('restoreBtn').addEventListener('click', () => {
  const d = JSON.parse(localStorage.getItem(DRAFT));
  $('names').value = d.names.join('\n');
  cats = d.categories.map((c) => ({ ...c }));
  renderCats();
  dirty = true;
  validate();
  $('restoreBar').hidden = true;
});

// ---- control board -----------------------------------------------------------
// Frames arrive up to 10×/s while votes pour in. Rebuilding the buttons that
// often would eat the host's clicks (mousedown on one node, mouseup on its
// replacement), so rows are rebuilt only when their shape changes and the
// live numbers are patched in place.
function renderBoard() {
  const pinned = F.stage.mode === 'pinned' ? new Set(F.stage.pinned) : new Set();
  const key = F.categories.map((c) => `${c.id}:${c.phase}:${c.title}:${pinned.has(c.id)}`).join('|');
  if (key !== boardKey) {
    boardKey = key;
    const sel = new Set([...document.querySelectorAll('#board input.sel:checked')].map((x) => x.closest('.board-row').dataset.id));
    $('board').innerHTML = F.categories.map((c) => `<div class="board-row ${c.phase}" data-id="${esc(c.id)}">` +
      `<input type="checkbox" class="sel" ${sel.has(c.id) ? 'checked' : ''} aria-label="Select ${esc(c.title)}">` +
      `<span class="t">${esc(c.title)}</span><span class="ph">${c.phase}</span><span class="tm mono"></span>` +
      `<span class="bc mono"></span>` +
      `<button class="open">Open</button><button class="close" ${c.phase === 'open' ? '' : 'disabled'}>Close</button>` +
      `<button class="reset">Reset</button><button class="onscreen" aria-pressed="${pinned.has(c.id)}">On screen</button></div>`).join('');
  }
  for (const c of F.categories) {
    const bc = document.querySelector(`#board .board-row[data-id="${CSS.escape(c.id)}"] .bc`);
    if (bc) bc.textContent = `${c.ballotCount} ballot${c.ballotCount === 1 ? '' : 's'}`;
  }
  $('stageAuto').setAttribute('aria-pressed', String(F.stage.mode === 'auto'));
  $('devices').textContent = `${F.devices} device${F.devices === 1 ? '' : 's'} in`;
  $('entryBtn').textContent = F.entryOpen ? 'Close entry' : 'Reopen entry';
}

const durationMs = () => {
  const custom = Number($('durCustom').value);
  return Math.round((custom > 0 ? custom : durMin) * 60_000);
};
async function openCats(ids) {
  const withBallots = F.categories.filter((c) => ids.includes(c.id) && c.ballotCount > 0);
  for (const c of withBallots) {
    if (!confirm(`Opening "${c.title}" again clears its ${c.ballotCount} ballot${c.ballotCount === 1 ? '' : 's'}. Continue?`)) return;
  }
  const r = await post('/vote/admin/open', { categoryIds: ids, durationMs: durationMs() });
  if (r.status !== 200) alert((r.json.errors ?? ['Could not open']).join(' '));
}
$('board').addEventListener('click', async (e) => {
  const row = e.target.closest('.board-row');
  if (!row || e.target.tagName !== 'BUTTON') return;
  const id = row.dataset.id;
  const cat = F.categories.find((c) => c.id === id);
  if (e.target.classList.contains('open')) await openCats([id]);
  if (e.target.classList.contains('close')) await post('/vote/admin/close', { categoryIds: [id] });
  if (e.target.classList.contains('reset') && confirm(`Reset "${cat.title}"? This clears its ${cat.ballotCount} ballots.`)) await post('/vote/admin/reset', { categoryIds: [id] });
  if (e.target.classList.contains('onscreen')) {
    const cur = F.stage.mode === 'pinned' ? new Set(F.stage.pinned) : new Set();
    if (cur.has(id)) cur.delete(id); else cur.add(id);
    await post('/vote/admin/stage', cur.size ? { mode: 'pinned', categoryIds: [...cur] } : { mode: 'auto' });
  }
});
$('openSelected').addEventListener('click', () => {
  const ids = [...document.querySelectorAll('#board input.sel:checked')].map((x) => x.closest('.board-row').dataset.id);
  if (ids.length) openCats(ids);
});
$('dur').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-min]');
  if (!b) return;
  durMin = Number(b.dataset.min);
  $('durCustom').value = '';
  for (const x of $('dur').children) x.classList.toggle('on', x === b);
});
$('stageAuto').addEventListener('click', () => post('/vote/admin/stage', { mode: 'auto' }));
$('entryBtn').addEventListener('click', () => post('/vote/admin/entry', { open: !F.entryOpen }));

// ---- fraud panel -------------------------------------------------------------
function renderFlags() {
  const key = F.flags.map((f) => `${f.id}:${f.voided}:${f.devices}`).join('|') + `|${F.categories.reduce((s, c) => s + c.voidedCount, 0)}`;
  if (key === flagsKey) return;
  flagsKey = key;
  const title = new Map(F.categories.map((c) => [c.id, c.title]));
  const name = (id) => F.candidates[id]?.name ?? '?';
  $('flags').innerHTML = F.flags.length ? F.flags.map((f) => {
    const why = f.kind === 'cluster'
      ? `${f.devices} devices · same network & browser · joined within ${Math.round(F.codeMs / 1000)} s · identical ballot${f.weak ? ' (pick-1 category: a weaker signal)' : ''}`
      : `+${f.gained} votes in 10 s · on ${f.sharePct}% of ballots in that window`;
    return `<div class="flag ${f.voided ? 'voided' : ''}" data-id="${esc(f.id)}"><span class="cat">${esc(title.get(f.categoryId) ?? '')}</span>` +
      `<span class="why">${esc(why)}</span><span class="names">${esc(f.candidateIds.map(name).join(', '))}</span>` +
      `<button class="void">${f.voided ? 'Restore' : 'Void'}</button></div>`;
  }).join('') : '<p class="muted">No suspicious patterns.</p>';
  const voided = F.categories.reduce((s, c) => s + c.voidedCount, 0);
  $('voidedTotal').textContent = `${voided} voided ballot${voided === 1 ? '' : 's'}`;
}
$('flags').addEventListener('click', async (e) => {
  const b = e.target.closest('button.void');
  if (!b) return;
  const id = b.closest('.flag').dataset.id;
  const f = F.flags.find((x) => x.id === id);
  await post('/vote/admin/void', { flagId: id, restore: !!f?.voided });
});

// ---- results ------------------------------------------------------------------
function renderResults() {
  if (!resTab || !F.categories.some((c) => c.id === resTab)) resTab = F.categories[0]?.id ?? null;
  const tk = `${resTab}|${F.categories.map((c) => `${c.id}:${c.title}`).join('|')}`;
  if (tk !== tabsKey) {
    tabsKey = tk;
    $('resTabs').innerHTML = F.categories.map((c) => `<button data-id="${esc(c.id)}" class="${c.id === resTab ? 'on' : ''}">${esc(c.title)}</button>`).join('');
  }
  const cat = F.categories.find((c) => c.id === resTab);
  if (!cat) return;
  const q = $('resFilter').value;
  const keep = q.trim() ? new Set(search(buildIndex(F.candidates), q).map((r) => r.id)) : null;
  const rows = rankCounts(F.candidates, cat.counts).filter((r) => !keep || keep.has(r.id));
  $('resTable').querySelector('tbody').innerHTML = rows.map((r) => `<tr><td class="mono">${r.rank}</td><td>${esc(r.name)}</td><td class="mono">${r.votes}</td></tr>`).join('');
}
$('resTabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-id]'); if (b) { resTab = b.dataset.id; renderResults(); } });
$('resFilter').addEventListener('input', renderResults);
$('csv').addEventListener('click', () => {
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  let out = 'category,rank,name,votes\n';
  for (const c of F.categories) for (const r of rankCounts(F.candidates, c.counts)) out += `${q(c.title)},${r.rank},${q(r.name)},${r.votes}\n`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([out], { type: 'text/csv' }));
  a.download = `live-vote-results-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// ---- frames & clock -------------------------------------------------------------
let clockOffset = 0;
function onFrame(f) {
  clockOffset = f.now - Date.now(); // admin-grade precision is plenty here
  const first = !F;
  F = f;
  const cfgKey = `${f.listVersion}|${f.categories.map((c) => `${c.id}:${c.title}:${c.picks}`).join('|')}`;
  if (first || (cfgKey !== lastCfgKey && !dirty)) fillFromServer();
  lastCfgKey = cfgKey;
  if (first) maybeOfferRestore();
  validate();
  renderBoard();
  renderFlags();
  renderResults();
}
function tick() {
  if (F) {
    const now = Date.now() + clockOffset;
    for (const row of document.querySelectorAll('#board .board-row')) {
      const c = F.categories.find((x) => x.id === row.dataset.id);
      row.querySelector('.tm').textContent = c?.phase === 'open' ? mmss(c.endsAt - now) : '';
    }
  }
  requestAnimationFrame(tick);
}

$('loginBtn').addEventListener('click', login);
$('token').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
fetch('/admin/session').then((r) => r.json()).then((s) => (s.authenticated ? start() : showLogin())).catch(showLogin);
requestAnimationFrame(tick);
```

Note: when `renderBoard` does rebuild, it carries the checkbox selection across (`sel`), so a phase change never unticks what the host selected.

- [ ] **Step 5: Run the checks**

Run: `npm run check:vote`
Expected: every section ✔. Look at `admin.png` and `admin-phone.png`.

- [ ] **Step 6: Commit**

```bash
git add public/vote/admin.html src/server.js scripts/vote-check.mjs
git commit -m "Live Vote: admin — setup, control board, stage, entry lock, fraud panel, results"
```

---

### Task 8: Docs, checklist and full regression

**Files:**
- Modify: `README.md`, `PLAN.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing new — documentation and a clean verification record.

- [ ] **Step 1: README** — under "Run locally", add the three URLs:

```
# Live Vote  → phone http://localhost:8080/vote · screen /vote/screen · admin /vote/admin
```

and a short "## Live Vote" section after the Sequência one: what it is (3 sentences from the spec intro), the room-code flow ("open `/vote/screen` on the projector and log in; phones scan the rotating QR"), the anti-fraud layers in one line each, what still gets through (one person, several devices), and `npm run check:vote`. Note: "Client IP for fraud flags is the rightmost `X-Forwarded-For` entry — correct on plain Cloud Run; behind an external load balancer it would be the LB's address, which collapses clusters to user-agent + entry window."

- [ ] **Step 2: Full regression**

Run each and confirm:
- `npm test` → every suite passes (Tap Race, Sequência, names, and the three Live Vote suites).
- `npm run check:contract` → 0 failed.
- `npm run check:browser` → 0 failed.
- `npm run check:vote` → 0 failed.
- `node --check src/server.js` → no output.

If anything fails, stop and fix the root cause before ticking this step (superpowers:systematic-debugging).

- [ ] **Step 3: Visual review** — open every PNG in `/tmp/vote-check/` and check against the spec: phone (search sticky, highlights legible, tray clear of the home indicator, 60-char name wraps cleanly at 360 px), screen (readable at 1920×1080, the 2-column stage, podium), admin (desktop + phone). Fix anything clipped or unreadable, rerun `npm run check:vote`.

- [ ] **Step 4: PLAN.md** — tick every item in the `## Live Vote — a real-time voting companion` checklist (added to PLAN.md together with this plan).

- [ ] **Step 5: Commit**

```bash
git add README.md PLAN.md
git commit -m "Live Vote: README and PLAN checklist"
```
