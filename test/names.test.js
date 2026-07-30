import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeNameFactory, normalizeLocale, renderSlot, SUPPORTED, DEFAULT_LOCALE,
  COMBINATIONS, ADJECTIVE_COUNT, TITLE_COUNT,
} from '../src/names.js';
import { ROSTER, GENDER_INDEX } from '../src/locales/animals.js';
import de from '../src/locales/de.js';
import en from '../src/locales/en.js';
import es from '../src/locales/es.js';
import fr from '../src/locales/fr.js';
import it from '../src/locales/it.js';
import pt from '../src/locales/pt.js';

const MODULES = { de, en, es, fr, it, pt };

/** The slot index of one exact combination — animal varies fastest. */
const slotFor = (key, adjIdx = 0, titleIdx = 0) =>
  ROSTER.findIndex((a) => a.key === key) + ROSTER.length * (adjIdx + ADJECTIVE_COUNT * titleIdx);

test('sequence numbers are unique and monotonic', () => {
  const next = makeNameFactory();
  const seqs = new Set();
  for (let i = 0; i < 1000; i++) {
    const id = next('pt');
    assert.equal(id.seq, i + 1);
    assert.ok(!seqs.has(id.seq));
    seqs.add(id.seq);
  }
});

// ----------------------------------------------------------------- uniqueness
test('the room holds more than 5.000 distinct names', () => {
  assert.ok(COMBINATIONS >= 5000, `only ${COMBINATIONS} combinations`);
});

test('5.000 players all get a different name, in every language', () => {
  for (const code of SUPPORTED) {
    const next = makeNameFactory();
    const names = new Set();
    for (let i = 0; i < 5000; i++) names.add(next(code).name);
    assert.equal(names.size, 5000, `locale "${code}" repeated a name inside 5.000 players`);
  }
});

test('every slot in the grid renders a distinct name', () => {
  // Not just the first 5.000: if two slots collide the shuffle can still deal
  // a duplicate to two unlucky players.
  for (const code of SUPPORTED) {
    const names = new Set();
    for (let slot = 0; slot < COMBINATIONS; slot++) names.add(renderSlot(code, slot).name);
    assert.equal(names.size, COMBINATIONS, `locale "${code}" has colliding slots`);
  }
});

test('past the last slot the deal wraps, and #seq keeps the label unique', () => {
  const next = makeNameFactory();
  const labels = new Set();
  let first = null;
  for (let i = 0; i < COMBINATIONS + 2; i++) {
    const id = next('pt');
    if (i === 0) first = id;
    labels.add(id.label);
    if (i === COMBINATIONS) {
      assert.equal(id.name, first.name, 'the deal should restart, not run out');
      assert.notEqual(id.label, first.label);
    }
  }
  assert.equal(labels.size, COMBINATIONS + 2);
});

test('two factories deal different orders', () => {
  const a = makeNameFactory();
  const b = makeNameFactory();
  const from = (next) => Array.from({ length: 20 }, () => next('en').name).join('|');
  assert.notEqual(from(a), from(b)); // 1 in 45^20 of a false failure
});

test('emoji always present, in every language', () => {
  const next = makeNameFactory();
  for (const code of SUPPORTED) {
    for (let i = 0; i < 50; i++) assert.ok(next(code).emoji.length > 0);
  }
});

// ------------------------------------------------------------------ coverage
test('every locale translates the whole roster', () => {
  for (const [code, mod] of Object.entries(MODULES)) {
    for (const { key } of ROSTER) {
      assert.ok(mod.animals[key], `locale "${code}" is missing "${key}"`);
      assert.ok(mod.animals[key][0].length > 0, `locale "${code}" has an empty "${key}"`);
    }
    assert.equal(Object.keys(mod.animals).length, ROSTER.length,
      `locale "${code}" has animals outside the roster`);
  }
});

test('every locale offers the same number of adjectives and titles', () => {
  // A short list would make one slot index mean two different names, and the
  // locale is only known after the slot has been dealt.
  const lead = (t) => (Array.isArray(t) ? t[0] : t);
  for (const [code, mod] of Object.entries(MODULES)) {
    assert.equal(mod.adjectives.length, ADJECTIVE_COUNT, `locale "${code}" adjectives`);
    assert.equal(mod.titles.length, TITLE_COUNT, `locale "${code}" titles`);
    assert.equal(new Set(mod.titles.map(lead)).size, TITLE_COUNT, `locale "${code}" repeats a title`);
    for (const title of mod.titles) assert.ok(lead(title).length > 0);
  }
});

test('each animal owns one emoji, and no two share it', () => {
  const emojis = new Set(ROSTER.map((a) => a.emoji));
  assert.equal(emojis.size, ROSTER.length, 'two animals share an emoji');
  const keys = new Set(ROSTER.map((a) => a.key));
  assert.equal(keys.size, ROSTER.length, 'duplicate key in the roster');
});

test('slurs and body jokes stay out of the roster', () => {
  // These names are dealt at random to real people and then projected in front
  // of the room. Guarded by word as well as by key, so re-adding one under a
  // different key — or in a single locale — fails here rather than on stage.
  const BLOCKED_KEYS = [
    'monkey', 'gorilla', 'whale', 'elephant', 'hippo',
    'frog', 'camel', 'goat', 'snake', 'boar', 'turtle', 'peacock', 'horse',
    'pig', 'cow', 'rat', 'sloth', 'deer', 'duck', 'parrot', 'butterfly', 'ladybug',
  ];
  const BLOCKED_WORDS = new Set([
    'monkey', 'macaco', 'mono', 'singe', 'affe', 'scimmia',
    'gorilla', 'gorila', 'gorille',
    'whale', 'baleia', 'ballena', 'baleine', 'balena', 'wal',
    'elephant', 'elefante', 'éléphant', 'elefant',
    'frog', 'sapo', 'rana', 'grenouille', 'frosch',
    'camel', 'camelo', 'camello', 'chameau', 'cammello', 'kamel',
    'goat', 'bode', 'cabra', 'chèvre', 'capra', 'ziege',
    'snake', 'cobra', 'serpiente', 'serpent', 'serpente', 'schlange',
    'boar', 'javali', 'jabalí', 'sanglier', 'cinghiale', 'wildschwein',
    'turtle', 'tartaruga', 'tortuga', 'tortue', 'schildkröte',
    'peacock', 'pavão', 'pavo real', 'paon', 'pavone', 'pfau',
    'horse', 'cavalo', 'caballo', 'cheval', 'cavallo', 'pferd',
    'raccoon', 'raton laveur', 'blaireau', 'mariposa', 'mariquita',
    'veado', 'pato', 'papagaio', 'wasserschwein', 'schwein',
  ]);

  for (const key of BLOCKED_KEYS) {
    assert.ok(!ROSTER.some((a) => a.key === key), `"${key}" is back in the roster`);
  }
  for (const [code, mod] of Object.entries(MODULES)) {
    for (const [key, word] of Object.entries(mod.animals)) {
      assert.ok(!BLOCKED_KEYS.includes(key), `locale "${code}" still defines "${key}"`);
      assert.ok(!BLOCKED_WORDS.has(word[0].toLowerCase()),
        `locale "${code}" renders a blocked animal as "${word[0]}"`);
    }
  }
});

test('titles stay pompous, never sacred and never political', () => {
  // A title is funny when it is puffed up (Arquiduquesa Capivara Furiosa) and
  // ugly when it is someone's faith or someone's dictator. The policy is
  // written in each locale file; this is what keeps it true.
  const BLOCKED = new Set([
    'führer', 'fuhrer', 'duce', 'caudillo', 'reichsführer',
    'czar', 'zar', 'tsar', 'zsar',
    'papa', 'pope', 'cardeal', 'cardenal', 'cardinal', 'kardinal',
    'bispo', 'obispo', 'évêque', 'vescovo', 'bischof', 'bishop',
    'imam', 'imã', 'ayatollah', 'rabino', 'rabbi', 'rabbiner',
    'santo', 'santa', 'saint', 'sainte', 'heiliger',
    'messias', 'messiah', 'profeta', 'prophet',
  ]);
  for (const [code, mod] of Object.entries(MODULES)) {
    for (const title of mod.titles) {
      for (const form of Array.isArray(title) ? title : [title]) {
        assert.ok(!BLOCKED.has(form.toLowerCase()), `locale "${code}" offers the title "${form}"`);
      }
    }
  }
});

test('the same animal carries the same emoji in every language', () => {
  for (let i = 0; i < ROSTER.length; i++) {
    // Slots 0..44 are the animals in order, all with adjective 0 and title 0.
    const seen = new Set(SUPPORTED.map((code) => renderSlot(code, i).emoji));
    assert.equal(seen.size, 1, `animal ${i} disagrees on emoji across locales`);
    assert.equal([...seen][0], ROSTER[i].emoji);
  }
});

test('every adjective and title supplies a form for each gender the locale uses', () => {
  const forms = { pt: 2, es: 2, it: 2, fr: 2, de: 3 };
  for (const [code, arity] of Object.entries(forms)) {
    for (const adj of MODULES[code].adjectives) {
      assert.equal(adj.length, arity, `locale "${code}": "${adj[0]}" has ${adj.length} forms`);
      for (const form of adj) assert.ok(form.length > 0);
    }
    // Titles inflect too now — Barão/Baronesa, Erzherzog/Erzherzogin — so a
    // missing form would render `undefined` next to the animal.
    for (const title of MODULES[code].titles) {
      assert.equal(title.length, arity, `locale "${code}": "${title[0]}" has ${title.length} forms`);
      for (const form of title) assert.ok(form.length > 0);
    }
  }
  for (const adj of en.adjectives) assert.equal(typeof adj, 'string');
  for (const title of en.titles) assert.equal(typeof title, 'string');
});

// ------------------------------------------------------------------- grammar
test('adjectives agree with the gender of the animal', () => {
  const cases = [
    // [locale, animal key, expected name] — adjective 0 is the "Furioso"
    // family and title 0 is the "Barão" family in all four lists.
    ['pt', 'capybara', 'Baronesa Capivara Furiosa'],
    ['es', 'seal', 'Baronesa Foca Furiosa'],
    ['it', 'tiger', 'Baronessa Tigre Furiosa'],
    ['fr', 'bee', 'Baronne Abeille Furieuse'],
  ];
  for (const [code, key, expected] of cases) {
    assert.equal(renderSlot(code, slotFor(key)).name, expected, `${code} failed agreement`);
  }
});

test('masculine animals keep the masculine adjective', () => {
  assert.equal(renderSlot('pt', slotFor('wolf')).name, 'Barão Lobo Furioso');
});

test('German declines strongly across all three genders', () => {
  assert.equal(renderSlot('de', slotFor('wolf')).name, 'Baron Wütender Wolf'); // m
  assert.equal(renderSlot('de', slotFor('owl')).name, 'Baronin Wütende Eule'); // f
  // Neuter animal, masculine title: German has no neuter one, and the
  // adjective still agrees with the animal, which is the head noun.
  assert.equal(renderSlot('de', slotFor('kangaroo')).name, 'Baron Wütendes Känguru'); // n
});

test('the title agrees with the animal, like the adjective does', () => {
  // The whole phrase lines up on one gender — it is the capybara that is a
  // baroness, not the person holding the phone.
  assert.equal(renderSlot('pt', slotFor('capybara')).name, 'Baronesa Capivara Furiosa');
  assert.equal(renderSlot('pt', slotFor('wolf')).name, 'Barão Lobo Furioso');
  // Every title inflects, not just the first one.
  const knight = pt.titles.findIndex(([m]) => m === 'Cavaleiro');
  assert.ok(knight >= 0);
  assert.equal(renderSlot('pt', slotFor('capybara', 0, knight)).name, 'Cavaleira Capivara Furiosa');
  assert.equal(renderSlot('pt', slotFor('wolf', 0, knight)).name, 'Cavaleiro Lobo Furioso');
});

test('an epicene title keeps one form for both genders', () => {
  // "Almirante" has no feminine form to give it, and inventing one would be
  // worse than reusing it.
  const admiral = pt.titles.findIndex(([m]) => m === 'Almirante');
  assert.ok(admiral >= 0);
  assert.equal(renderSlot('pt', slotFor('capybara', 0, admiral)).name, 'Almirante Capivara Furiosa');
  assert.equal(renderSlot('pt', slotFor('wolf', 0, admiral)).name, 'Almirante Lobo Furioso');
});

test('word order follows the language, not the code', () => {
  const first = (code) => renderSlot(code, 0).name;
  assert.equal(first('pt'), 'Barão Pinguim Furioso'); // romance: adjective trails
  assert.equal(first('en'), 'Baron Furious Penguin'); // germanic: modifiers lead
  assert.equal(first('de'), 'Baron Wütender Pinguin');
  assert.equal(first('fr'), 'Baron Manchot Furieux');
});

test('German gender tags only ever use forms that exist', () => {
  // A stray 'x' gender would silently index past the adjective array.
  for (const [code, mod] of Object.entries(MODULES)) {
    if (code === 'en') continue;
    const allowed = code === 'de' ? ['m', 'f', 'n'] : ['m', 'f'];
    for (const [key, word] of Object.entries(mod.animals)) {
      assert.ok(allowed.includes(word[1]), `locale "${code}": "${key}" has gender "${word[1]}"`);
      assert.ok(GENDER_INDEX[word[1]] < (code === 'de' ? 3 : 2));
    }
  }
});

// -------------------------------------------------------- locale negotiation
test('regional tags collapse to the language', () => {
  assert.equal(normalizeLocale('pt-BR'), 'pt');
  assert.equal(normalizeLocale('pt_br'), 'pt');
  assert.equal(normalizeLocale('ES-419'), 'es');
  assert.equal(normalizeLocale('de-CH'), 'de');
});

test('an Accept-Language list picks the first language we speak', () => {
  assert.equal(normalizeLocale('pt-BR,pt;q=0.9,en-US;q=0.8'), 'pt');
  // Not merely the first tag — the first *supported* one.
  assert.equal(normalizeLocale('zh-CN,fr;q=0.9,en;q=0.8'), 'fr');
  assert.equal(normalizeLocale('ja,ko;q=0.9'), DEFAULT_LOCALE);
});

test('hostile or absent input falls back instead of throwing', () => {
  const hostile = [
    undefined, null, '', 42, {}, [], () => {}, Symbol('x'),
    '__proto__', 'constructor', 'prototype', 'toString',
    'pt'.repeat(500), 'a,'.repeat(5000) + 'pt',
    '../../etc/passwd', '<script>',
  ];
  for (const input of hostile) {
    const code = normalizeLocale(input);
    assert.ok(SUPPORTED.includes(code), `normalizeLocale(${String(input)}) -> ${code}`);
  }
  // And the factory survives them too.
  const next = makeNameFactory();
  for (const input of hostile) {
    const id = next(input);
    assert.ok(id.name.length > 0 && id.emoji.length > 0);
    assert.equal(id.locale, DEFAULT_LOCALE);
  }
});

test('surrounding whitespace does not cost you your language', () => {
  // Not hostile input, just a sloppy header. Trimmed, not rejected.
  assert.equal(normalizeLocale(' pt'), 'pt');
  assert.equal(normalizeLocale('pt '), 'pt');
  assert.equal(normalizeLocale('zh-CN, fr;q=0.9'), 'fr');
});

test('an unsupported language gets English, not Portuguese', () => {
  assert.equal(normalizeLocale('ja-JP'), 'en');
  assert.equal(makeNameFactory()('ja-JP').locale, 'en');
});

test('the identity reports which language it chose', () => {
  assert.equal(makeNameFactory()('pt-BR').locale, 'pt');
  assert.equal(makeNameFactory()('nl').locale, 'en');
});

test('a broken rng cannot deal a name off the end of the grid', () => {
  for (const rng of [() => 0, () => 1, () => 0.999999999, () => -1, () => NaN]) {
    const next = makeNameFactory(rng);
    for (let i = 0; i < 50; i++) {
      const id = next('pt');
      assert.ok(id.name.length > 0 && !id.name.includes('undefined'), `rng broke on ${id.name}`);
    }
  }
});
