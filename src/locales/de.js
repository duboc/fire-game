// German. Adjective precedes the noun and, with no article in front of it,
// takes the *strong* declension: -er masculine, -e feminine, -es neuter.
// Hence three forms per adjective, and a third gender on the animals.
//
// The epithet sits between adjective and animal ("Wütender Ninja Wolf"). Proper
// German would compound it into "Ninjawolf"; three separate words is the
// nickname register, and it keeps the animal as the head noun the adjective
// agrees with.
import { GENDER_INDEX } from './animals.js';

export default {
  code: 'de',

  animals: {
    penguin: ['Pinguin', 'm'], tiger: ['Tiger', 'm'], capybara: ['Capybara', 'n'],
    falcon: ['Falke', 'm'], llama: ['Lama', 'n'], shark: ['Hai', 'm'],
    owl: ['Eule', 'f'], jaguar: ['Jaguar', 'm'], wolf: ['Wolf', 'm'],
    fox: ['Fuchs', 'm'], bear: ['Bär', 'm'], lion: ['Löwe', 'm'],
    panda: ['Panda', 'm'], seal: ['Robbe', 'f'], octopus: ['Krake', 'm'],
    dragon: ['Drache', 'm'], rhino: ['Nashorn', 'n'], bull: ['Stier', 'm'],
    rabbit: ['Hase', 'm'], cat: ['Katze', 'f'], bee: ['Biene', 'f'],
    dolphin: ['Delfin', 'm'], zebra: ['Zebra', 'n'], giraffe: ['Giraffe', 'f'],
    kangaroo: ['Känguru', 'n'], rooster: ['Hahn', 'm'], swan: ['Schwan', 'm'],
    bat: ['Fledermaus', 'f'], lizard: ['Echse', 'f'], unicorn: ['Einhorn', 'n'],
    otter: ['Otter', 'm'], hedgehog: ['Igel', 'm'], flamingo: ['Flamingo', 'm'],
    bison: ['Bison', 'm'], koala: ['Koala', 'm'], squirrel: ['Eichhörnchen', 'n'],
    scorpion: ['Skorpion', 'm'], crocodile: ['Krokodil', 'n'], lobster: ['Hummer', 'm'],
    trex: ['Tyrannosaurus', 'm'], hamster: ['Hamster', 'm'], brontosaurus: ['Brontosaurus', 'm'],
    cricket: ['Grille', 'f'], beetle: ['Käfer', 'm'], spider: ['Spinne', 'f'],
  },

  adjectives: [
    ['Wütender', 'Wütende', 'Wütendes'], ['Schneller', 'Schnelle', 'Schnelles'],
    ['Legendärer', 'Legendäre', 'Legendäres'], ['Wilder', 'Wilde', 'Wildes'],
    ['Elektrischer', 'Elektrische', 'Elektrisches'], ['Unerbittlicher', 'Unerbittliche', 'Unerbittliches'],
    ['Sonischer', 'Sonische', 'Sonisches'], ['Unaufhaltsamer', 'Unaufhaltsame', 'Unaufhaltsames'],
    ['Ungezähmter', 'Ungezähmte', 'Ungezähmtes'], ['Kosmischer', 'Kosmische', 'Kosmisches'],
    ['Atomarer', 'Atomare', 'Atomares'], ['Explosiver', 'Explosive', 'Explosives'],
    ['Radikaler', 'Radikale', 'Radikales'], ['Höchster', 'Höchste', 'Höchstes'],
    ['Vulkanischer', 'Vulkanische', 'Vulkanisches'], ['Hektischer', 'Hektische', 'Hektisches'],
    ['Galaktischer', 'Galaktische', 'Galaktisches'], ['Unbesiegbarer', 'Unbesiegbare', 'Unbesiegbares'],
    ['Brutaler', 'Brutale', 'Brutales'], ['Rasanter', 'Rasante', 'Rasantes'],
    ['Riesiger', 'Riesige', 'Riesiges'], ['Kühner', 'Kühne', 'Kühnes'],
    ['Mystischer', 'Mystische', 'Mystisches'], ['Flammender', 'Flammende', 'Flammendes'],
    ['Magischer', 'Magische', 'Magisches'], ['Teuflischer', 'Teuflische', 'Teuflisches'],
    ['Epischer', 'Epische', 'Episches'], ['Unsterblicher', 'Unsterbliche', 'Unsterbliches'],
    ['Gepanzerter', 'Gepanzerte', 'Gepanzertes'], ['Magnetischer', 'Magnetische', 'Magnetisches'],
    ['Nuklearer', 'Nukleare', 'Nukleares'], ['Finsterer', 'Finstere', 'Finsteres'],
    ['Glorreicher', 'Glorreiche', 'Glorreiches'], ['Unzähmbarer', 'Unzähmbare', 'Unzähmbares'],
    ['Furchtloser', 'Furchtlose', 'Furchtloses'], ['Mächtiger', 'Mächtige', 'Mächtiges'],
    ['Blitzschneller', 'Blitzschnelle', 'Blitzschnelles'], ['Titanischer', 'Titanische', 'Titanisches'],
    ['Goldener', 'Goldene', 'Goldenes'], ['Eiserner', 'Eiserne', 'Eisernes'],
  ],

  nouns: [
    'Ninja', 'Laser', 'Turbo', 'Donner', 'Blitz', 'Orkan', 'Rakete', 'Vulkan',
    'Zyklon', 'Tsunami', 'Nitro', 'Plasma', 'Neon', 'Titan', 'Phönix', 'Vortex',
  ],

  compose: (animal, adj, noun) => `${adj[GENDER_INDEX[animal.g]]} ${noun} ${animal.name}`,
};
