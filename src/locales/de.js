// German. Adjective precedes the noun and, with no article in front of it,
// takes the *strong* declension: -er masculine, -e feminine, -es neuter.
// Hence three forms per adjective, and a third gender on the animals.
import { GENDER_INDEX } from './animals.js';

export default {
  code: 'de',

  animals: {
    penguin: ['Pinguin', 'm'], tiger: ['Tiger', 'm'], capybara: ['Wasserschwein', 'n'],
    falcon: ['Falke', 'm'], llama: ['Lama', 'n'], shark: ['Hai', 'm'],
    owl: ['Eule', 'f'], jaguar: ['Jaguar', 'm'], wolf: ['Wolf', 'm'],
    fox: ['Fuchs', 'm'], bear: ['Bär', 'm'], lion: ['Löwe', 'm'],
    panda: ['Panda', 'm'], seal: ['Robbe', 'f'], octopus: ['Tintenfisch', 'm'],
    dragon: ['Drache', 'm'], rhino: ['Nashorn', 'n'], bull: ['Stier', 'm'],
    rabbit: ['Hase', 'm'], cat: ['Katze', 'f'], frog: ['Frosch', 'm'],
    bee: ['Biene', 'f'], dolphin: ['Delfin', 'm'], horse: ['Pferd', 'n'],
    camel: ['Kamel', 'n'], zebra: ['Zebra', 'n'], giraffe: ['Giraffe', 'f'],
    kangaroo: ['Känguru', 'n'], goat: ['Ziege', 'f'], rooster: ['Hahn', 'm'],
    peacock: ['Pfau', 'm'], swan: ['Schwan', 'm'], bat: ['Fledermaus', 'f'],
    boar: ['Wildschwein', 'n'], lizard: ['Eidechse', 'f'], snake: ['Schlange', 'f'],
    turtle: ['Schildkröte', 'f'], unicorn: ['Einhorn', 'n'],
  },

  adjectives: [
    ['Wütender', 'Wütende', 'Wütendes'], ['Schneller', 'Schnelle', 'Schnelles'],
    ['Wilder', 'Wilde', 'Wildes'], ['Legendärer', 'Legendäre', 'Legendäres'],
    ['Elektrischer', 'Elektrische', 'Elektrisches'], ['Kosmischer', 'Kosmische', 'Kosmisches'],
    ['Unaufhaltsamer', 'Unaufhaltsame', 'Unaufhaltsames'], ['Atomarer', 'Atomare', 'Atomares'],
    ['Explosiver', 'Explosive', 'Explosives'], ['Radikaler', 'Radikale', 'Radikales'],
    ['Vulkanischer', 'Vulkanische', 'Vulkanisches'], ['Hektischer', 'Hektische', 'Hektisches'],
    ['Galaktischer', 'Galaktische', 'Galaktisches'], ['Unbesiegbarer', 'Unbesiegbare', 'Unbesiegbares'],
    ['Brutaler', 'Brutale', 'Brutales'], ['Riesiger', 'Riesige', 'Riesiges'],
    ['Verrückter', 'Verrückte', 'Verrücktes'], ['Mystischer', 'Mystische', 'Mystisches'],
    ['Flammender', 'Flammende', 'Flammendes'], ['Donnernder', 'Donnernde', 'Donnerndes'],
    ['Teuflischer', 'Teuflische', 'Teuflisches'], ['Epischer', 'Epische', 'Episches'],
    ['Unsterblicher', 'Unsterbliche', 'Unsterbliches'], ['Gepanzerter', 'Gepanzerte', 'Gepanzertes'],
    ['Magnetischer', 'Magnetische', 'Magnetisches'], ['Nuklearer', 'Nukleare', 'Nukleares'],
    ['Finsterer', 'Finstere', 'Finsteres'], ['Glorreicher', 'Glorreiche', 'Glorreiches'],
    ['Unzähmbarer', 'Unzähmbare', 'Unzähmbares'], ['Blitzschneller', 'Blitzschnelle', 'Blitzschnelles'],
    ['Furchtloser', 'Furchtlose', 'Furchtloses'], ['Eiserner', 'Eiserne', 'Eisernes'],
    ['Mächtiger', 'Mächtige', 'Mächtiges'], ['Tapferer', 'Tapfere', 'Tapferes'],
    ['Grimmiger', 'Grimmige', 'Grimmiges'],
  ],

  compose: (animal, adj) => `${adj[GENDER_INDEX[animal.g]]} ${animal.name}`,
};
