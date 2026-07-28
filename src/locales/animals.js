// The canonical animal roster: a stable key and the emoji that goes with it.
//
// Defined once, here, so every language describes the *same* 42 animals with
// the same emoji. Each locale file supplies only the words. A locale that
// forgets one is a boot-time error (src/names.js), never an `undefined` that
// reaches the projector.

export const ROSTER = [
  { key: 'penguin', emoji: '🐧' },
  { key: 'tiger', emoji: '🐯' },
  { key: 'capybara', emoji: '🦫' },
  { key: 'falcon', emoji: '🦅' },
  { key: 'llama', emoji: '🦙' },
  { key: 'shark', emoji: '🦈' },
  { key: 'owl', emoji: '🦉' },
  { key: 'jaguar', emoji: '🐆' },
  { key: 'wolf', emoji: '🐺' },
  { key: 'fox', emoji: '🦊' },
  { key: 'bear', emoji: '🐻' },
  { key: 'lion', emoji: '🦁' },
  { key: 'panda', emoji: '🐼' },
  { key: 'seal', emoji: '🦭' },
  { key: 'octopus', emoji: '🐙' },
  { key: 'dragon', emoji: '🐉' },
  { key: 'monkey', emoji: '🐵' },
  { key: 'rhino', emoji: '🦏' },
  { key: 'bull', emoji: '🐂' },
  { key: 'rabbit', emoji: '🐰' },
  { key: 'cat', emoji: '🐱' },
  { key: 'frog', emoji: '🐸' },
  { key: 'bee', emoji: '🐝' },
  { key: 'dolphin', emoji: '🐬' },
  { key: 'horse', emoji: '🐴' },
  { key: 'elephant', emoji: '🐘' },
  { key: 'camel', emoji: '🐫' },
  { key: 'zebra', emoji: '🦓' },
  { key: 'giraffe', emoji: '🦒' },
  { key: 'gorilla', emoji: '🦍' },
  { key: 'kangaroo', emoji: '🦘' },
  { key: 'goat', emoji: '🐐' },
  { key: 'rooster', emoji: '🐓' },
  { key: 'peacock', emoji: '🦚' },
  { key: 'swan', emoji: '🦢' },
  { key: 'bat', emoji: '🦇' },
  { key: 'boar', emoji: '🐗' },
  { key: 'lizard', emoji: '🦎' },
  { key: 'snake', emoji: '🐍' },
  { key: 'turtle', emoji: '🐢' },
  { key: 'whale', emoji: '🐳' },
  { key: 'unicorn', emoji: '🦄' },
];

/** Gender -> index into a locale's adjective forms. Unused slots never resolve. */
export const GENDER_INDEX = { m: 0, f: 1, n: 2 };
