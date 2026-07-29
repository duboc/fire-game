// Portuguese. Adjective follows the noun and agrees with its gender; the
// epithet trails as a noun in apposition and never inflects.
//
// Both adjective forms are written out rather than derived. A "-o becomes -a"
// rule looks clean and then mangles Turbo, Laser and Relâmpago — which is
// exactly why those moved to `nouns`, where nothing has to agree with anything.
import { GENDER_INDEX } from './animals.js';

export default {
  code: 'pt',

  animals: {
    penguin: ['Pinguim', 'm'], tiger: ['Tigre', 'm'], capybara: ['Capivara', 'f'],
    falcon: ['Falcão', 'm'], llama: ['Lhama', 'f'], shark: ['Tubarão', 'm'],
    owl: ['Coruja', 'f'], jaguar: ['Onça', 'f'], wolf: ['Lobo', 'm'],
    fox: ['Raposa', 'f'], bear: ['Urso', 'm'], lion: ['Leão', 'm'],
    panda: ['Panda', 'm'], seal: ['Foca', 'f'], octopus: ['Polvo', 'm'],
    dragon: ['Dragão', 'm'], rhino: ['Rinoceronte', 'm'], bull: ['Touro', 'm'],
    rabbit: ['Coelho', 'm'], cat: ['Gato', 'm'], bee: ['Abelha', 'f'],
    dolphin: ['Golfinho', 'm'], zebra: ['Zebra', 'f'], giraffe: ['Girafa', 'f'],
    kangaroo: ['Canguru', 'm'], rooster: ['Galo', 'm'], swan: ['Cisne', 'm'],
    bat: ['Morcego', 'm'], lizard: ['Lagarto', 'm'], unicorn: ['Unicórnio', 'm'],
    otter: ['Lontra', 'f'], hedgehog: ['Ouriço', 'm'], flamingo: ['Flamingo', 'm'],
    bison: ['Bisão', 'm'], koala: ['Coala', 'm'], squirrel: ['Esquilo', 'm'],
    scorpion: ['Escorpião', 'm'], crocodile: ['Crocodilo', 'm'], lobster: ['Lagosta', 'f'],
    trex: ['Tiranossauro', 'm'], hamster: ['Hamster', 'm'], brontosaurus: ['Brontossauro', 'm'],
    cricket: ['Grilo', 'm'], beetle: ['Besouro', 'm'], spider: ['Aranha', 'f'],
  },

  adjectives: [
    ['Furioso', 'Furiosa'], ['Veloz', 'Veloz'], ['Lendário', 'Lendária'],
    ['Feroz', 'Feroz'], ['Elétrico', 'Elétrica'], ['Implacável', 'Implacável'],
    ['Sônico', 'Sônica'], ['Imparável', 'Imparável'], ['Selvagem', 'Selvagem'],
    ['Cósmico', 'Cósmica'], ['Atômico', 'Atômica'], ['Explosivo', 'Explosiva'],
    ['Radical', 'Radical'], ['Supremo', 'Suprema'], ['Vulcânico', 'Vulcânica'],
    ['Frenético', 'Frenética'], ['Galáctico', 'Galáctica'], ['Invencível', 'Invencível'],
    ['Brutal', 'Brutal'], ['Hipersônico', 'Hipersônica'], ['Colossal', 'Colossal'],
    ['Audaz', 'Audaz'], ['Místico', 'Mística'], ['Flamejante', 'Flamejante'],
    ['Quântico', 'Quântica'], ['Diabólico', 'Diabólica'], ['Épico', 'Épica'],
    ['Imortal', 'Imortal'], ['Blindado', 'Blindada'], ['Magnético', 'Magnética'],
    ['Nuclear', 'Nuclear'], ['Sinistro', 'Sinistra'], ['Glorioso', 'Gloriosa'],
    ['Indomável', 'Indomável'], ['Destemido', 'Destemida'], ['Poderoso', 'Poderosa'],
    ['Rápido', 'Rápida'], ['Titânico', 'Titânica'], ['Dourado', 'Dourada'],
    ['Férreo', 'Férrea'],
  ],

  nouns: [
    'Ninja', 'Laser', 'Turbo', 'Trovão', 'Relâmpago', 'Furacão', 'Foguete', 'Vulcão',
    'Ciclone', 'Tsunami', 'Nitro', 'Plasma', 'Neon', 'Titã', 'Fênix', 'Vórtice',
  ],

  compose: (animal, adj, noun) => `${animal.name} ${adj[GENDER_INDEX[animal.g]]} ${noun}`,
};
