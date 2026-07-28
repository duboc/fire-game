// French. Adjective follows the noun and agrees with its gender.
//
// Feminine forms are irregular often enough (fou -> folle, explosif -> explosive,
// immortel -> immortelle) that deriving them would be guesswork. Written out.
import { GENDER_INDEX } from './animals.js';

export default {
  code: 'fr',

  animals: {
    penguin: ['Manchot', 'm'], tiger: ['Tigre', 'm'], capybara: ['Capybara', 'm'],
    falcon: ['Faucon', 'm'], llama: ['Lama', 'm'], shark: ['Requin', 'm'],
    owl: ['Hibou', 'm'], jaguar: ['Jaguar', 'm'], wolf: ['Loup', 'm'],
    fox: ['Renard', 'm'], bear: ['Ours', 'm'], lion: ['Lion', 'm'],
    panda: ['Panda', 'm'], seal: ['Phoque', 'm'], octopus: ['Poulpe', 'm'],
    dragon: ['Dragon', 'm'], monkey: ['Singe', 'm'], rhino: ['Rhinocéros', 'm'],
    bull: ['Taureau', 'm'], rabbit: ['Lapin', 'm'], cat: ['Chat', 'm'],
    frog: ['Grenouille', 'f'], bee: ['Abeille', 'f'], dolphin: ['Dauphin', 'm'],
    horse: ['Cheval', 'm'], elephant: ['Éléphant', 'm'], camel: ['Chameau', 'm'],
    zebra: ['Zèbre', 'm'], giraffe: ['Girafe', 'f'], gorilla: ['Gorille', 'm'],
    kangaroo: ['Kangourou', 'm'], goat: ['Chèvre', 'f'], rooster: ['Coq', 'm'],
    peacock: ['Paon', 'm'], swan: ['Cygne', 'm'], bat: ['Chauve-souris', 'f'],
    boar: ['Sanglier', 'm'], lizard: ['Lézard', 'm'], snake: ['Serpent', 'm'],
    turtle: ['Tortue', 'f'], whale: ['Baleine', 'f'], unicorn: ['Licorne', 'f'],
  },

  adjectives: [
    ['Furieux', 'Furieuse'], ['Rapide', 'Rapide'], ['Turbo', 'Turbo'],
    ['Légendaire', 'Légendaire'], ['Féroce', 'Féroce'], ['Électrique', 'Électrique'],
    ['Implacable', 'Implacable'], ['Sonique', 'Sonique'], ['Éclair', 'Éclair'],
    ['Imparable', 'Imparable'], ['Sauvage', 'Sauvage'], ['Cosmique', 'Cosmique'],
    ['Atomique', 'Atomique'], ['Explosif', 'Explosive'], ['Radical', 'Radicale'],
    ['Suprême', 'Suprême'], ['Volcanique', 'Volcanique'], ['Frénétique', 'Frénétique'],
    ['Galactique', 'Galactique'], ['Invincible', 'Invincible'], ['Brutal', 'Brutale'],
    ['Colossal', 'Colossale'], ['Fou', 'Folle'], ['Ninja', 'Ninja'],
    ['Mystique', 'Mystique'], ['Flamboyant', 'Flamboyante'], ['Ouragan', 'Ouragan'],
    ['Tonnerre', 'Tonnerre'], ['Laser', 'Laser'], ['Quantique', 'Quantique'],
    ['Diabolique', 'Diabolique'], ['Épique', 'Épique'], ['Immortel', 'Immortelle'],
    ['Blindé', 'Blindée'], ['Magnétique', 'Magnétique'], ['Nucléaire', 'Nucléaire'],
    ['Sinistre', 'Sinistre'], ['Glorieux', 'Glorieuse'], ['Indomptable', 'Indomptable'],
  ],

  compose: (animal, adj) => `${animal.name} ${adj[GENDER_INDEX[animal.g]]}`,
};
