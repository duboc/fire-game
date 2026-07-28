// Spanish. Adjective follows the noun and agrees with its gender.
import { GENDER_INDEX } from './animals.js';

export default {
  code: 'es',

  animals: {
    penguin: ['Pingüino', 'm'], tiger: ['Tigre', 'm'], capybara: ['Capibara', 'm'],
    falcon: ['Halcón', 'm'], llama: ['Llama', 'f'], shark: ['Tiburón', 'm'],
    owl: ['Búho', 'm'], jaguar: ['Jaguar', 'm'], wolf: ['Lobo', 'm'],
    fox: ['Zorro', 'm'], bear: ['Oso', 'm'], lion: ['León', 'm'],
    panda: ['Panda', 'm'], seal: ['Foca', 'f'], octopus: ['Pulpo', 'm'],
    dragon: ['Dragón', 'm'], monkey: ['Mono', 'm'], rhino: ['Rinoceronte', 'm'],
    bull: ['Toro', 'm'], rabbit: ['Conejo', 'm'], cat: ['Gato', 'm'],
    frog: ['Rana', 'f'], bee: ['Abeja', 'f'], dolphin: ['Delfín', 'm'],
    horse: ['Caballo', 'm'], elephant: ['Elefante', 'm'], camel: ['Camello', 'm'],
    zebra: ['Cebra', 'f'], giraffe: ['Jirafa', 'f'], gorilla: ['Gorila', 'm'],
    kangaroo: ['Canguro', 'm'], goat: ['Cabra', 'f'], rooster: ['Gallo', 'm'],
    peacock: ['Pavo Real', 'm'], swan: ['Cisne', 'm'], bat: ['Murciélago', 'm'],
    boar: ['Jabalí', 'm'], lizard: ['Lagarto', 'm'], snake: ['Serpiente', 'f'],
    turtle: ['Tortuga', 'f'], whale: ['Ballena', 'f'], unicorn: ['Unicornio', 'm'],
  },

  adjectives: [
    ['Furioso', 'Furiosa'], ['Veloz', 'Veloz'], ['Turbo', 'Turbo'],
    ['Legendario', 'Legendaria'], ['Feroz', 'Feroz'], ['Eléctrico', 'Eléctrica'],
    ['Implacable', 'Implacable'], ['Sónico', 'Sónica'], ['Relámpago', 'Relámpago'],
    ['Imparable', 'Imparable'], ['Salvaje', 'Salvaje'], ['Cósmico', 'Cósmica'],
    ['Atómico', 'Atómica'], ['Explosivo', 'Explosiva'], ['Radical', 'Radical'],
    ['Supremo', 'Suprema'], ['Volcánico', 'Volcánica'], ['Frenético', 'Frenética'],
    ['Galáctico', 'Galáctica'], ['Invencible', 'Invencible'], ['Brutal', 'Brutal'],
    ['Colosal', 'Colosal'], ['Loco', 'Loca'], ['Ninja', 'Ninja'],
    ['Místico', 'Mística'], ['Llameante', 'Llameante'], ['Huracán', 'Huracán'],
    ['Trueno', 'Trueno'], ['Láser', 'Láser'], ['Cuántico', 'Cuántica'],
    ['Diabólico', 'Diabólica'], ['Épico', 'Épica'], ['Inmortal', 'Inmortal'],
    ['Blindado', 'Blindada'], ['Magnético', 'Magnética'], ['Nuclear', 'Nuclear'],
    ['Siniestro', 'Siniestra'], ['Glorioso', 'Gloriosa'], ['Indomable', 'Indomable'],
  ],

  compose: (animal, adj) => `${animal.name} ${adj[GENDER_INDEX[animal.g]]}`,
};
