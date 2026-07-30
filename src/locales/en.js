// English, and the fallback for every language this app does not speak.
// No agreement to worry about, so adjectives and titles are plain strings.
// Title first, then adjective, then animal — "Baron Mystic Zebra".

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

  // Ten ranks of nobility, four dramatic ones, two adventurous. No office jobs.
  // Nothing religious and nothing from 20th-century politics. Plain strings:
  // English titles do not inflect.
  titles: [
    'Baron', 'Duke', 'Count', 'Viscount', 'Marquis', 'Emperor', 'Prince',
    'King', 'Archduke', 'Knight', 'Admiral', 'Marshal', 'Captain', 'Maestro',
    'Astronaut', 'Detective',
  ],

  compose: (animal, adj, title) => `${title} ${adj} ${animal.name}`,
};
