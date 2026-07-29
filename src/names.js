// Auto-generated player identities — adjective + animal + epithet + `#seq`, in
// the player's own language. No user input, no moderation, no keyboard on
// mobile.
//
// Two different guarantees, deliberately kept apart:
//   - the `#seq` suffix makes the *label* unique, always, forever;
//   - the words themselves are dealt from a shuffled permutation of the whole
//     grid, so the first COMBINATIONS players also get a unique *name*. At
//     45 animals x 40 adjectives x 16 epithets that is 28.800 — an event would
//     have to fill six times over before anyone sees a repeat.
// Drawing at random would not do that: with 5.000 players out of 28.800 slots,
// the birthday bound puts a collision at essentially certainty.
//
// Six languages, chosen because the self-hosted Roboto renders all of them.
// Anything else falls back to English — a readable name beats tofu boxes on
// the projector.
import { ROSTER } from './locales/animals.js';
import de from './locales/de.js';
import en from './locales/en.js';
import es from './locales/es.js';
import fr from './locales/fr.js';
import it from './locales/it.js';
import pt from './locales/pt.js';

export const DEFAULT_LOCALE = 'en';

// A Map, not an object: locale tags come off the wire, and a Map cannot be
// reached through `__proto__` or `constructor`.
const LOCALES = new Map([['de', de], ['en', en], ['es', es], ['fr', fr], ['it', it], ['pt', pt]]);

export const SUPPORTED = [...LOCALES.keys()];

// Join each locale's words to the shared roster once, at boot. A locale that
// forgot an animal fails here, loudly, instead of rendering `undefined` to a
// room of 5.000 people.
const ANIMALS_BY_LOCALE = new Map();
for (const [code, locale] of LOCALES) {
  ANIMALS_BY_LOCALE.set(code, ROSTER.map(({ key, emoji }) => {
    const word = locale.animals[key];
    if (!word) throw new Error(`locale "${code}" is missing the animal "${key}"`);
    return { name: word[0], g: word[1] || 'm', emoji, key };
  }));
}

// One slot index has to mean "the same combination" in every language, because
// a player's locale is only known after the slot has been handed out. So the
// lists must be the same length everywhere; a short list is a boot error.
export const ADJECTIVE_COUNT = en.adjectives.length;
export const NOUN_COUNT = en.nouns.length;
for (const [code, locale] of LOCALES) {
  if (locale.adjectives.length !== ADJECTIVE_COUNT) {
    throw new Error(`locale "${code}" has ${locale.adjectives.length} adjectives, expected ${ADJECTIVE_COUNT}`);
  }
  if (locale.nouns.length !== NOUN_COUNT) {
    throw new Error(`locale "${code}" has ${locale.nouns.length} epithets, expected ${NOUN_COUNT}`);
  }
}

/** How many distinct names exist. Every event must fit inside this. */
export const COMBINATIONS = ROSTER.length * ADJECTIVE_COUNT * NOUN_COUNT;

/**
 * Maps anything a client might send to a supported locale tag.
 *
 * Accepts a bare tag (`pt`), a regional one (`pt-BR`, `pt_br`) or a full
 * `Accept-Language` list (`zh-CN,fr;q=0.9,en;q=0.8`), returning the first tag
 * we actually speak — so a Chinese browser that also asks for French gets
 * French rather than the fallback. Everything else, including hostile input,
 * yields DEFAULT_LOCALE.
 *
 * @param {unknown} input
 * @returns {string} one of SUPPORTED
 */
export function normalizeLocale(input) {
  if (typeof input !== 'string' || input.length === 0 || input.length > 200) return DEFAULT_LOCALE;
  // Bounded: a header with 500 tags must not turn into 500 iterations per join.
  const tags = input.split(',', 10);
  for (const raw of tags) {
    const tag = raw.trim().split(';')[0].split(/[-_]/)[0].toLowerCase();
    if (LOCALES.has(tag)) return tag;
  }
  return DEFAULT_LOCALE;
}

/**
 * Renders one slot of the grid in one language. Pure — same inputs, same name.
 *
 * @param {string} code - a supported locale tag
 * @param {number} slot - 0 <= slot < COMBINATIONS
 * @returns {{name: string, emoji: string}}
 */
export function renderSlot(code, slot) {
  const animals = ANIMALS_BY_LOCALE.get(code);
  const { adjectives, nouns, compose } = LOCALES.get(code);

  // Animal varies fastest, so consecutive slots look maximally different.
  const ai = slot % animals.length;
  const rest = (slot - ai) / animals.length;
  const ji = rest % ADJECTIVE_COUNT;
  const ni = (rest - ji) / ADJECTIVE_COUNT;

  const animal = animals[ai];
  return { name: compose(animal, adjectives[ji], nouns[ni]), emoji: animal.emoji };
}

/** Fisher-Yates over [0, COMBINATIONS). ~115 kB and a millisecond, once per round. */
function shuffledSlots(rng) {
  const order = new Uint32Array(COMBINATIONS);
  for (let i = 0; i < COMBINATIONS; i++) order[i] = i;
  for (let i = COMBINATIONS - 1; i > 0; i--) {
    // Clamped: a test rng that returns exactly 1 must not index off the end.
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    const tmp = order[i];
    order[i] = order[j];
    order[j] = tmp;
  }
  return order;
}

/**
 * Creates a stateful name factory. Each call to the returned function yields a
 * unique identity in the requested language.
 *
 * The factory owns one shuffle, so a fresh factory (see Game#reset) means a
 * fresh deal — the same room playing twice does not see the same names.
 *
 * @param {() => number} [rng] - random source in [0,1), injectable for tests.
 * @returns {(locale?: unknown) => {name: string, emoji: string, seq: number, label: string, locale: string}}
 */
export function makeNameFactory(rng = Math.random) {
  const order = shuffledSlots(rng);
  let seq = 0;
  return function next(locale) {
    const code = normalizeLocale(locale);
    // Past COMBINATIONS the deal starts over; `#seq` keeps the label unique.
    const slot = order[seq % COMBINATIONS];
    seq += 1;
    const { name, emoji } = renderSlot(code, slot);
    return { name, emoji, seq, label: `${name} #${seq}`, locale: code };
  };
}
