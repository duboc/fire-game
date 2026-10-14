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
