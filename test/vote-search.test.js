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
