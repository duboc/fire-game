// French: title + animal + adjective ("Baronne Zèbre Mystique"). Title and
// adjective both agree with the *animal's* grammatical gender, so the phrase
// lines up with itself — it is the zebra that is a baroness, never the player.
//
// Feminine forms are irregular often enough (explosif -> explosive, immortel ->
// immortelle, furieux -> furieuse) that deriving them would be guesswork.
// Written out.
import { GENDER_INDEX } from './animals.js';

export default {
  code: 'fr',

  animals: {
    penguin: ['Manchot', 'm'], tiger: ['Tigre', 'm'], capybara: ['Capybara', 'm'],
    falcon: ['Faucon', 'm'], llama: ['Lama', 'm'], shark: ['Requin', 'm'],
    owl: ['Hibou', 'm'], jaguar: ['Jaguar', 'm'], wolf: ['Loup', 'm'],
    fox: ['Renard', 'm'], bear: ['Ours', 'm'], lion: ['Lion', 'm'],
    panda: ['Panda', 'm'], seal: ['Phoque', 'm'], octopus: ['Poulpe', 'm'],
    dragon: ['Dragon', 'm'], rhino: ['Rhinocéros', 'm'], bull: ['Taureau', 'm'],
    rabbit: ['Lapin', 'm'], cat: ['Chat', 'm'], bee: ['Abeille', 'f'],
    dolphin: ['Dauphin', 'm'], zebra: ['Zèbre', 'm'], giraffe: ['Girafe', 'f'],
    kangaroo: ['Kangourou', 'm'], rooster: ['Coq', 'm'], swan: ['Cygne', 'm'],
    bat: ['Chauve-souris', 'f'], lizard: ['Lézard', 'm'], unicorn: ['Licorne', 'f'],
    otter: ['Loutre', 'f'], hedgehog: ['Hérisson', 'm'], flamingo: ['Flamant', 'm'],
    bison: ['Bison', 'm'], koala: ['Koala', 'm'], squirrel: ['Écureuil', 'm'],
    scorpion: ['Scorpion', 'm'], crocodile: ['Crocodile', 'm'], lobster: ['Homard', 'm'],
    trex: ['Tyrannosaure', 'm'], hamster: ['Hamster', 'm'], brontosaurus: ['Brontosaure', 'm'],
    cricket: ['Grillon', 'm'], beetle: ['Scarabée', 'm'], spider: ['Araignée', 'f'],
  },

  adjectives: [
    ['Furieux', 'Furieuse'], ['Rapide', 'Rapide'], ['Légendaire', 'Légendaire'],
    ['Féroce', 'Féroce'], ['Électrique', 'Électrique'], ['Implacable', 'Implacable'],
    ['Sonique', 'Sonique'], ['Imparable', 'Imparable'], ['Sauvage', 'Sauvage'],
    ['Cosmique', 'Cosmique'], ['Atomique', 'Atomique'], ['Explosif', 'Explosive'],
    ['Radical', 'Radicale'], ['Suprême', 'Suprême'], ['Volcanique', 'Volcanique'],
    ['Frénétique', 'Frénétique'], ['Galactique', 'Galactique'], ['Invincible', 'Invincible'],
    ['Brutal', 'Brutale'], ['Hypersonique', 'Hypersonique'], ['Colossal', 'Colossale'],
    ['Audacieux', 'Audacieuse'], ['Mystique', 'Mystique'], ['Flamboyant', 'Flamboyante'],
    ['Quantique', 'Quantique'], ['Diabolique', 'Diabolique'], ['Épique', 'Épique'],
    ['Immortel', 'Immortelle'], ['Blindé', 'Blindée'], ['Magnétique', 'Magnétique'],
    ['Nucléaire', 'Nucléaire'], ['Sinistre', 'Sinistre'], ['Glorieux', 'Glorieuse'],
    ['Indomptable', 'Indomptable'], ['Intrépide', 'Intrépide'], ['Puissant', 'Puissante'],
    ['Véloce', 'Véloce'], ['Titanesque', 'Titanesque'], ['Doré', 'Dorée'],
    ['Inflexible', 'Inflexible'],
  ],

  // Nobility, dramatic ranks, then jobs with no glamour at all — the last five
  // are the joke ("Stagiaire Zèbre Mystique"). Nothing religious and nothing
  // from 20th-century politics.
  titles: [
    ['Baron', 'Baronne'], ['Duc', 'Duchesse'], ['Comte', 'Comtesse'],
    ['Vicomte', 'Vicomtesse'], ['Marquis', 'Marquise'], ['Empereur', 'Impératrice'],
    ['Prince', 'Princesse'], ['Amiral', 'Amirale'], ['Maréchal', 'Maréchale'],
    ['Capitaine', 'Capitaine'], ['Maestro', 'Maestro'], ['Stagiaire', 'Stagiaire'],
    ['Auditeur', 'Auditrice'], ['PDG', 'PDG'], ['Astronaute', 'Astronaute'],
    ['Détective', 'Détective'],
  ],

  compose: (animal, adj, title) =>
    `${title[GENDER_INDEX[animal.g]]} ${animal.name} ${adj[GENDER_INDEX[animal.g]]}`,
};
