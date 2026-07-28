// English, and the fallback for every language this app does not speak.
// No agreement to worry about, so adjectives are plain strings; they simply
// precede the noun.

export default {
  code: 'en',

  animals: {
    penguin: ['Penguin'], tiger: ['Tiger'], capybara: ['Capybara'],
    falcon: ['Falcon'], llama: ['Llama'], shark: ['Shark'],
    owl: ['Owl'], jaguar: ['Jaguar'], wolf: ['Wolf'],
    fox: ['Fox'], bear: ['Bear'], lion: ['Lion'],
    panda: ['Panda'], seal: ['Seal'], octopus: ['Octopus'],
    dragon: ['Dragon'], monkey: ['Monkey'], rhino: ['Rhino'],
    bull: ['Bull'], rabbit: ['Rabbit'], cat: ['Cat'],
    frog: ['Frog'], bee: ['Bee'], dolphin: ['Dolphin'],
    horse: ['Horse'], elephant: ['Elephant'], camel: ['Camel'],
    zebra: ['Zebra'], giraffe: ['Giraffe'], gorilla: ['Gorilla'],
    kangaroo: ['Kangaroo'], goat: ['Goat'], rooster: ['Rooster'],
    peacock: ['Peacock'], swan: ['Swan'], bat: ['Bat'],
    boar: ['Boar'], lizard: ['Lizard'], snake: ['Snake'],
    turtle: ['Turtle'], whale: ['Whale'], unicorn: ['Unicorn'],
  },

  adjectives: [
    'Furious', 'Swift', 'Turbo', 'Legendary', 'Ferocious', 'Electric',
    'Relentless', 'Sonic', 'Lightning', 'Unstoppable', 'Wild', 'Cosmic',
    'Atomic', 'Explosive', 'Radical', 'Supreme', 'Volcanic', 'Frenetic',
    'Galactic', 'Invincible', 'Brutal', 'Hypersonic', 'Colossal', 'Crazy',
    'Ninja', 'Mystic', 'Flaming', 'Hurricane', 'Thunder', 'Laser',
    'Quantum', 'Diabolical', 'Epic', 'Immortal', 'Armored', 'Magnetic',
    'Nuclear', 'Sinister', 'Glorious', 'Untamable',
  ],

  compose: (animal, adj) => `${adj} ${animal.name}`,
};
