// Portuguese. Adjective follows the noun and agrees with its gender.
//
// Both forms are written out rather than derived. A "-o becomes -a" rule looks
// clean and then mangles Turbo, Laser, Ninja, Furacão, Trovão and Relâmpago,
// which are nouns in apposition and never inflect. Explicit pairs cost a few
// lines and can be checked by eye.
import { GENDER_INDEX } from './animals.js';

export default {
  code: 'pt',

  animals: {
    penguin: ['Pinguim', 'm'], tiger: ['Tigre', 'm'], capybara: ['Capivara', 'f'],
    falcon: ['Falcão', 'm'], llama: ['Lhama', 'f'], shark: ['Tubarão', 'm'],
    owl: ['Coruja', 'f'], jaguar: ['Jaguar', 'm'], wolf: ['Lobo', 'm'],
    fox: ['Raposa', 'f'], bear: ['Urso', 'm'], lion: ['Leão', 'm'],
    panda: ['Panda', 'm'], seal: ['Foca', 'f'], octopus: ['Polvo', 'm'],
    dragon: ['Dragão', 'm'], monkey: ['Macaco', 'm'], rhino: ['Rinoceronte', 'm'],
    bull: ['Touro', 'm'], rabbit: ['Coelho', 'm'], cat: ['Gato', 'm'],
    frog: ['Sapo', 'm'], bee: ['Abelha', 'f'], dolphin: ['Golfinho', 'm'],
    horse: ['Cavalo', 'm'], elephant: ['Elefante', 'm'], camel: ['Camelo', 'm'],
    zebra: ['Zebra', 'f'], giraffe: ['Girafa', 'f'], gorilla: ['Gorila', 'm'],
    kangaroo: ['Canguru', 'm'], goat: ['Bode', 'm'], rooster: ['Galo', 'm'],
    peacock: ['Pavão', 'm'], swan: ['Cisne', 'm'], bat: ['Morcego', 'm'],
    boar: ['Javali', 'm'], lizard: ['Lagarto', 'm'], snake: ['Cobra', 'f'],
    turtle: ['Tartaruga', 'f'], whale: ['Baleia', 'f'], unicorn: ['Unicórnio', 'm'],
  },

  adjectives: [
    ['Furioso', 'Furiosa'], ['Veloz', 'Veloz'], ['Turbo', 'Turbo'],
    ['Lendário', 'Lendária'], ['Feroz', 'Feroz'], ['Elétrico', 'Elétrica'],
    ['Implacável', 'Implacável'], ['Sônico', 'Sônica'], ['Relâmpago', 'Relâmpago'],
    ['Imparável', 'Imparável'], ['Selvagem', 'Selvagem'], ['Cósmico', 'Cósmica'],
    ['Atômico', 'Atômica'], ['Explosivo', 'Explosiva'], ['Radical', 'Radical'],
    ['Supremo', 'Suprema'], ['Vulcânico', 'Vulcânica'], ['Frenético', 'Frenética'],
    ['Galáctico', 'Galáctica'], ['Invencível', 'Invencível'], ['Brutal', 'Brutal'],
    ['Hipersônico', 'Hipersônica'], ['Colossal', 'Colossal'], ['Maluco', 'Maluca'],
    ['Ninja', 'Ninja'], ['Místico', 'Mística'], ['Flamejante', 'Flamejante'],
    ['Furacão', 'Furacão'], ['Trovão', 'Trovão'], ['Laser', 'Laser'],
    ['Quântico', 'Quântica'], ['Diabólico', 'Diabólica'], ['Épico', 'Épica'],
    ['Imortal', 'Imortal'], ['Blindado', 'Blindada'], ['Magnético', 'Magnética'],
    ['Nuclear', 'Nuclear'], ['Selvático', 'Selvática'], ['Sinistro', 'Sinistra'],
    ['Glorioso', 'Gloriosa'], ['Indomável', 'Indomável'],
  ],

  compose: (animal, adj) => `${animal.name} ${adj[GENDER_INDEX[animal.g]]}`,
};
