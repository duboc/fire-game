// Italian. Adjective follows the noun and agrees with its gender.
// Note `tigre`, `volpe` and `scimmia` are feminine — a false friend for anyone
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
    dragon: ['Drago', 'm'], monkey: ['Scimmia', 'f'], rhino: ['Rinoceronte', 'm'],
    bull: ['Toro', 'm'], rabbit: ['Coniglio', 'm'], cat: ['Gatto', 'm'],
    frog: ['Rana', 'f'], bee: ['Ape', 'f'], dolphin: ['Delfino', 'm'],
    horse: ['Cavallo', 'm'], elephant: ['Elefante', 'm'], camel: ['Cammello', 'm'],
    zebra: ['Zebra', 'f'], giraffe: ['Giraffa', 'f'], gorilla: ['Gorilla', 'm'],
    kangaroo: ['Canguro', 'm'], goat: ['Capra', 'f'], rooster: ['Gallo', 'm'],
    peacock: ['Pavone', 'm'], swan: ['Cigno', 'm'], bat: ['Pipistrello', 'm'],
    boar: ['Cinghiale', 'm'], lizard: ['Lucertola', 'f'], snake: ['Serpente', 'm'],
    turtle: ['Tartaruga', 'f'], whale: ['Balena', 'f'], unicorn: ['Unicorno', 'm'],
  },

  adjectives: [
    ['Furioso', 'Furiosa'], ['Veloce', 'Veloce'], ['Turbo', 'Turbo'],
    ['Leggendario', 'Leggendaria'], ['Feroce', 'Feroce'], ['Elettrico', 'Elettrica'],
    ['Implacabile', 'Implacabile'], ['Sonico', 'Sonica'], ['Fulmine', 'Fulmine'],
    ['Inarrestabile', 'Inarrestabile'], ['Selvaggio', 'Selvaggia'], ['Cosmico', 'Cosmica'],
    ['Atomico', 'Atomica'], ['Esplosivo', 'Esplosiva'], ['Radicale', 'Radicale'],
    ['Supremo', 'Suprema'], ['Vulcanico', 'Vulcanica'], ['Frenetico', 'Frenetica'],
    ['Galattico', 'Galattica'], ['Invincibile', 'Invincibile'], ['Brutale', 'Brutale'],
    ['Colossale', 'Colossale'], ['Pazzo', 'Pazza'], ['Ninja', 'Ninja'],
    ['Mistico', 'Mistica'], ['Fiammeggiante', 'Fiammeggiante'], ['Uragano', 'Uragano'],
    ['Tuono', 'Tuono'], ['Laser', 'Laser'], ['Quantico', 'Quantica'],
    ['Diabolico', 'Diabolica'], ['Epico', 'Epica'], ['Immortale', 'Immortale'],
    ['Blindato', 'Blindata'], ['Magnetico', 'Magnetica'], ['Nucleare', 'Nucleare'],
    ['Sinistro', 'Sinistra'], ['Glorioso', 'Gloriosa'], ['Indomabile', 'Indomabile'],
  ],

  compose: (animal, adj) => `${animal.name} ${adj[GENDER_INDEX[animal.g]]}`,
};
