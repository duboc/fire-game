// Italian. Adjective follows the noun and agrees with its gender; the epithet
// trails as a noun in apposition and never inflects.
// Note `tigre`, `volpe` and `ape` are feminine — a false friend for anyone
// reading across from the Portuguese list.
import { GENDER_INDEX } from './animals.js';

export default {
  code: 'it',

  animals: {
    penguin: ['Pinguino', 'm'], tiger: ['Tigre', 'f'], capybara: ['Capibara', 'm'],
    falcon: ['Falco', 'm'], llama: ['Lama', 'm'], shark: ['Squalo', 'm'],
    owl: ['Gufo', 'm'], jaguar: ['Giaguaro', 'm'], wolf: ['Lupo', 'm'],
    fox: ['Volpe', 'f'], bear: ['Orso', 'm'], lion: ['Leone', 'm'],
    panda: ['Panda', 'm'], seal: ['Foca', 'f'], octopus: ['Polpo', 'm'],
    dragon: ['Drago', 'm'], rhino: ['Rinoceronte', 'm'], bull: ['Toro', 'm'],
    rabbit: ['Coniglio', 'm'], cat: ['Gatto', 'm'], bee: ['Ape', 'f'],
    dolphin: ['Delfino', 'm'], zebra: ['Zebra', 'f'], giraffe: ['Giraffa', 'f'],
    kangaroo: ['Canguro', 'm'], rooster: ['Gallo', 'm'], swan: ['Cigno', 'm'],
    bat: ['Pipistrello', 'm'], lizard: ['Lucertola', 'f'], unicorn: ['Unicorno', 'm'],
    otter: ['Lontra', 'f'], hedgehog: ['Riccio', 'm'], flamingo: ['Fenicottero', 'm'],
    bison: ['Bisonte', 'm'], koala: ['Koala', 'm'], squirrel: ['Scoiattolo', 'm'],
    scorpion: ['Scorpione', 'm'], crocodile: ['Coccodrillo', 'm'], lobster: ['Aragosta', 'f'],
    trex: ['Tirannosauro', 'm'], hamster: ['Criceto', 'm'], brontosaurus: ['Brontosauro', 'm'],
    cricket: ['Grillo', 'm'], beetle: ['Scarabeo', 'm'], spider: ['Ragno', 'm'],
  },

  adjectives: [
    ['Furioso', 'Furiosa'], ['Veloce', 'Veloce'], ['Leggendario', 'Leggendaria'],
    ['Feroce', 'Feroce'], ['Elettrico', 'Elettrica'], ['Implacabile', 'Implacabile'],
    ['Sonico', 'Sonica'], ['Inarrestabile', 'Inarrestabile'], ['Selvaggio', 'Selvaggia'],
    ['Cosmico', 'Cosmica'], ['Atomico', 'Atomica'], ['Esplosivo', 'Esplosiva'],
    ['Radicale', 'Radicale'], ['Supremo', 'Suprema'], ['Vulcanico', 'Vulcanica'],
    ['Frenetico', 'Frenetica'], ['Galattico', 'Galattica'], ['Invincibile', 'Invincibile'],
    ['Brutale', 'Brutale'], ['Ipersonico', 'Ipersonica'], ['Colossale', 'Colossale'],
    ['Audace', 'Audace'], ['Mistico', 'Mistica'], ['Fiammeggiante', 'Fiammeggiante'],
    ['Quantico', 'Quantica'], ['Diabolico', 'Diabolica'], ['Epico', 'Epica'],
    ['Immortale', 'Immortale'], ['Blindato', 'Blindata'], ['Magnetico', 'Magnetica'],
    ['Nucleare', 'Nucleare'], ['Sinistro', 'Sinistra'], ['Glorioso', 'Gloriosa'],
    ['Indomabile', 'Indomabile'], ['Impavido', 'Impavida'], ['Potente', 'Potente'],
    ['Rapido', 'Rapida'], ['Titanico', 'Titanica'], ['Dorato', 'Dorata'],
    ['Ferreo', 'Ferrea'],
  ],

  nouns: [
    'Ninja', 'Laser', 'Turbo', 'Tuono', 'Fulmine', 'Uragano', 'Razzo', 'Vulcano',
    'Ciclone', 'Tsunami', 'Nitro', 'Plasma', 'Neon', 'Titano', 'Fenice', 'Vortice',
  ],

  compose: (animal, adj, noun) => `${animal.name} ${adj[GENDER_INDEX[animal.g]]} ${noun}`,
};
