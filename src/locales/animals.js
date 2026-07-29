// The canonical animal roster: a stable key and the emoji that goes with it.
//
// Defined once, here, so every language describes the *same* 45 animals with
// the same emoji. Each locale file supplies only the words. A locale that
// forgets one is a boot-time error (src/names.js), never an `undefined` that
// reaches the projector.
//
// An animal only earns a slot if it reads as a compliment in all six
// languages. Deliberately absent, and not to be re-added to "round out the
// list":
//   - monkey, gorilla        racist slurs when they land on a person, and here
//                            they always land on a person
//   - whale, elephant, hippo the same joke about their body
//   - turtle, sloth, snail   "you are slow", in a game about tapping fast
//   - snake, rat             "you are a traitor"
//   - goat, boar, pig, cow   insults in at least one of the six languages
//                            (ES "cabra", DE "Schwein", PT "vaca")
//   - frog, camel            EN "frog" and FR "chameau"/"raton" carry ethnic
//                            slurs; FR "blaireau" is "loser"
//   - deer, duck, parrot     PT "veado" is a homophobic slur; "pato" is
//                            "sucker"; "papagaio" is "parrots everything"
//   - butterfly, ladybug     ES "mariposa" and "mariquita" are homophobic slurs
// test/names.test.js enforces the list. When adding an animal, check the word
// in every one of the six languages, not just English.

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
  { key: 'bee', emoji: '🐝' },
  { key: 'dolphin', emoji: '🐬' },
  { key: 'zebra', emoji: '🦓' },
  { key: 'giraffe', emoji: '🦒' },
  { key: 'kangaroo', emoji: '🦘' },
  { key: 'rooster', emoji: '🐓' },
  { key: 'swan', emoji: '🦢' },
  { key: 'bat', emoji: '🦇' },
  { key: 'lizard', emoji: '🦎' },
  { key: 'unicorn', emoji: '🦄' },
  { key: 'otter', emoji: '🦦' },
  { key: 'hedgehog', emoji: '🦔' },
  { key: 'flamingo', emoji: '🦩' },
  { key: 'bison', emoji: '🦬' },
  { key: 'koala', emoji: '🐨' },
  { key: 'squirrel', emoji: '🐿️' },
  { key: 'scorpion', emoji: '🦂' },
  { key: 'crocodile', emoji: '🐊' },
  { key: 'lobster', emoji: '🦞' },
  { key: 'trex', emoji: '🦖' },
  { key: 'hamster', emoji: '🐹' },
  { key: 'brontosaurus', emoji: '🦕' },
  { key: 'cricket', emoji: '🦗' },
  { key: 'beetle', emoji: '🪲' },
  { key: 'spider', emoji: '🕷️' },
];

/** Gender -> index into a locale's adjective forms. Unused slots never resolve. */
export const GENDER_INDEX = { m: 0, f: 1, n: 2 };
