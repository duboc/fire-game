// Auto-generated player identities — animal + adjective + `#seq`, in the
// player's own language. No user input, no moderation, no keyboard on mobile.
// Uniqueness is guaranteed by the monotonically increasing sequence number
// (not by the random pair, which may repeat by design).
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
 * Creates a stateful name factory. Each call to the returned function yields a
 * unique identity in the requested language.
 *
 * @param {() => number} [rng] - random source in [0,1), injectable for tests.
 * @returns {(locale?: unknown) => {name: string, emoji: string, seq: number, label: string, locale: string}}
 */
export function makeNameFactory(rng = Math.random) {
  let seq = 0;
  return function next(locale) {
    seq += 1;
    const code = normalizeLocale(locale);
    const { adjectives, compose } = LOCALES.get(code);
    const animals = ANIMALS_BY_LOCALE.get(code);
    const animal = animals[Math.floor(rng() * animals.length)];
    const adjective = adjectives[Math.floor(rng() * adjectives.length)];
    const name = compose(animal, adjective);
    return {
      name,
      emoji: animal.emoji,
      seq,
      label: `${name} #${seq}`,
      locale: code,
    };
  };
}
