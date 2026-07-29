// English, and the fallback for every language this app does not speak.
// No agreement to worry about, so adjectives are plain strings. Both modifiers
// precede the animal — "Furious Ninja Capybara", gamer-tag word order.

export default {
  code: 'en',

  animals: {
    penguin: ['Penguin'], tiger: ['Tiger'], capybara: ['Capybara'],
    falcon: ['Falcon'], llama: ['Llama'], shark: ['Shark'],
    owl: ['Owl'], jaguar: ['Jaguar'], wolf: ['Wolf'],
    fox: ['Fox'], bear: ['Bear'], lion: ['Lion'],
    panda: ['Panda'], seal: ['Seal'], octopus: ['Octopus'],
    dragon: ['Dragon'], rhino: ['Rhino'], bull: ['Bull'],
    rabbit: ['Rabbit'], cat: ['Cat'], bee: ['Bee'],
    dolphin: ['Dolphin'], zebra: ['Zebra'], giraffe: ['Giraffe'],
    kangaroo: ['Kangaroo'], rooster: ['Rooster'], swan: ['Swan'],
    bat: ['Bat'], lizard: ['Lizard'], unicorn: ['Unicorn'],
    otter: ['Otter'], hedgehog: ['Hedgehog'], flamingo: ['Flamingo'],
    bison: ['Bison'], koala: ['Koala'], squirrel: ['Squirrel'],
    scorpion: ['Scorpion'], crocodile: ['Crocodile'], lobster: ['Lobster'],
    trex: ['T-Rex'], hamster: ['Hamster'], brontosaurus: ['Brontosaurus'],
    cricket: ['Cricket'], beetle: ['Beetle'], spider: ['Spider'],
  },

  adjectives: [
    'Furious', 'Swift', 'Legendary', 'Ferocious', 'Electric', 'Relentless',
    'Sonic', 'Unstoppable', 'Wild', 'Cosmic', 'Atomic', 'Explosive',
    'Radical', 'Supreme', 'Volcanic', 'Frenetic', 'Galactic', 'Invincible',
    'Brutal', 'Hypersonic', 'Colossal', 'Bold', 'Mystic', 'Flaming',
    'Quantum', 'Diabolical', 'Epic', 'Immortal', 'Armored', 'Magnetic',
    'Nuclear', 'Sinister', 'Glorious', 'Untamable', 'Fearless', 'Mighty',
    'Rapid', 'Titanic', 'Golden', 'Iron',
  ],

  nouns: [
    'Ninja', 'Laser', 'Turbo', 'Thunder', 'Lightning', 'Hurricane', 'Rocket', 'Volcano',
    'Cyclone', 'Tsunami', 'Nitro', 'Plasma', 'Neon', 'Titan', 'Phoenix', 'Vortex',
  ],

  compose: (animal, adj, noun) => `${adj} ${noun} ${animal.name}`,
};
