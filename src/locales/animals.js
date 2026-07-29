// The canonical animal roster: a stable key and the emoji that goes with it.
//
// Defined once, here, so every language describes the *same* 38 animals with
// the same emoji. Each locale file supplies only the words. A locale that
// forgets one is a boot-time error (src/names.js), never an `undefined` that
// reaches the projector.
//
// Deliberately absent, and not to be re-added to "round out the list": monkey
// and gorilla (racist slurs when they land on a person — and here they always
// land on a person), whale and elephant (the same joke about their body). The
// roster is assigned at random to real people whose names go up on a projector
// in front of the whole room, so an animal only earns a slot if it reads as a
// compliment. test/names.test.js enforces this list.

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
  { key: 'rhino', emoji: '🦏' },
  { key: 'bull', emoji: '🐂' },
  { key: 'rabbit', emoji: '🐰' },
  { key: 'cat', emoji: '🐱' },
  { key: 'frog', emoji: '🐸' },
  { key: 'bee', emoji: '🐝' },
  { key: 'dolphin', emoji: '🐬' },
  { key: 'horse', emoji: '🐴' },
  { key: 'camel', emoji: '🐫' },
  { key: 'zebra', emoji: '🦓' },
  { key: 'giraffe', emoji: '🦒' },
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
  { key: 'unicorn', emoji: '🦄' },
];

/** Gender -> index into a locale's adjective forms. Unused slots never resolve. */
export const GENDER_INDEX = { m: 0, f: 1, n: 2 };
