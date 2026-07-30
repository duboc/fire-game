// Portuguese: title + animal + adjective ("Baronesa Zebra Mística"). Title and
// adjective both agree with the *animal's* grammatical gender, so the phrase
// lines up with itself — it is the zebra that is a baroness, never the player.
//
// Every form is written out rather than derived. A "-o becomes -a" rule looks
// clean right up until it turns Imperador into "Imperadora" and Capitão into
// "Capitãoa".
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

  // Nobility, then dramatic ranks, then jobs with no glamour at all — the last
  // five are the joke ("Estagiária Capivara Furiosa"). Nothing religious and
  // nothing from 20th-century politics: a title is funny when it is pompous,
  // not when it is somebody's actual flag.
  titles: [
    ['Barão', 'Baronesa'], ['Duque', 'Duquesa'], ['Conde', 'Condessa'],
    ['Visconde', 'Viscondessa'], ['Marquês', 'Marquesa'], ['Imperador', 'Imperatriz'],
    ['Príncipe', 'Princesa'], ['Almirante', 'Almirante'], ['Marechal', 'Marechal'],
    ['Capitão', 'Capitã'], ['Maestro', 'Maestrina'], ['Estagiário', 'Estagiária'],
    ['Auditor', 'Auditora'], ['CEO', 'CEO'], ['Astronauta', 'Astronauta'],
    ['Detetive', 'Detetive'],
  ],

  compose: (animal, adj, title) =>
    `${title[GENDER_INDEX[animal.g]]} ${animal.name} ${adj[GENDER_INDEX[animal.g]]}`,
};
