// Spanish. Adjective follows the noun and agrees with its gender; the epithet
// trails as a noun in apposition and never inflects.
import { GENDER_INDEX } from './animals.js';

export default {
  code: 'es',

  animals: {
    penguin: ['Pingüino', 'm'], tiger: ['Tigre', 'm'], capybara: ['Capibara', 'm'],
    falcon: ['Halcón', 'm'], llama: ['Llama', 'f'], shark: ['Tiburón', 'm'],
    owl: ['Búho', 'm'], jaguar: ['Jaguar', 'm'], wolf: ['Lobo', 'm'],
    fox: ['Zorro', 'm'], bear: ['Oso', 'm'], lion: ['León', 'm'],
    panda: ['Panda', 'm'], seal: ['Foca', 'f'], octopus: ['Pulpo', 'm'],
    dragon: ['Dragón', 'm'], rhino: ['Rinoceronte', 'm'], bull: ['Toro', 'm'],
    rabbit: ['Conejo', 'm'], cat: ['Gato', 'm'], bee: ['Abeja', 'f'],
    dolphin: ['Delfín', 'm'], zebra: ['Cebra', 'f'], giraffe: ['Jirafa', 'f'],
    kangaroo: ['Canguro', 'm'], rooster: ['Gallo', 'm'], swan: ['Cisne', 'm'],
    bat: ['Murciélago', 'm'], lizard: ['Lagarto', 'm'], unicorn: ['Unicornio', 'm'],
    otter: ['Nutria', 'f'], hedgehog: ['Erizo', 'm'], flamingo: ['Flamenco', 'm'],
    bison: ['Bisonte', 'm'], koala: ['Koala', 'm'], squirrel: ['Ardilla', 'f'],
    scorpion: ['Escorpión', 'm'], crocodile: ['Cocodrilo', 'm'], lobster: ['Langosta', 'f'],
    trex: ['Tiranosaurio', 'm'], hamster: ['Hámster', 'm'], brontosaurus: ['Brontosaurio', 'm'],
    cricket: ['Grillo', 'm'], beetle: ['Escarabajo', 'm'], spider: ['Araña', 'f'],
  },

  adjectives: [
    ['Furioso', 'Furiosa'], ['Veloz', 'Veloz'], ['Legendario', 'Legendaria'],
    ['Feroz', 'Feroz'], ['Eléctrico', 'Eléctrica'], ['Implacable', 'Implacable'],
    ['Sónico', 'Sónica'], ['Imparable', 'Imparable'], ['Salvaje', 'Salvaje'],
    ['Cósmico', 'Cósmica'], ['Atómico', 'Atómica'], ['Explosivo', 'Explosiva'],
    ['Radical', 'Radical'], ['Supremo', 'Suprema'], ['Volcánico', 'Volcánica'],
    ['Frenético', 'Frenética'], ['Galáctico', 'Galáctica'], ['Invencible', 'Invencible'],
    ['Brutal', 'Brutal'], ['Hipersónico', 'Hipersónica'], ['Colosal', 'Colosal'],
    ['Audaz', 'Audaz'], ['Místico', 'Mística'], ['Llameante', 'Llameante'],
    ['Cuántico', 'Cuántica'], ['Diabólico', 'Diabólica'], ['Épico', 'Épica'],
    ['Inmortal', 'Inmortal'], ['Blindado', 'Blindada'], ['Magnético', 'Magnética'],
    ['Nuclear', 'Nuclear'], ['Siniestro', 'Siniestra'], ['Glorioso', 'Gloriosa'],
    ['Indomable', 'Indomable'], ['Intrépido', 'Intrépida'], ['Poderoso', 'Poderosa'],
    ['Rápido', 'Rápida'], ['Titánico', 'Titánica'], ['Dorado', 'Dorada'],
    ['Férreo', 'Férrea'],
  ],

  nouns: [
    'Ninja', 'Láser', 'Turbo', 'Trueno', 'Relámpago', 'Huracán', 'Cohete', 'Volcán',
    'Ciclón', 'Tsunami', 'Nitro', 'Plasma', 'Neón', 'Titán', 'Fénix', 'Vórtice',
  ],

  compose: (animal, adj, noun) => `${animal.name} ${adj[GENDER_INDEX[animal.g]]} ${noun}`,
};
