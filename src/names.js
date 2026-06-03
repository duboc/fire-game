// Auto-generated player identities — adjective + animal + sequential number.
// No user input, no moderation, no keyboard on mobile. Uniqueness is guaranteed
// by the monotonically increasing sequence number (not by the random pair).

export const ANIMALS = [
  { name: 'Pinguim', emoji: '🐧' },
  { name: 'Tigre', emoji: '🐯' },
  { name: 'Capivara', emoji: '🦫' },
  { name: 'Falcão', emoji: '🦅' },
  { name: 'Lhama', emoji: '🦙' },
  { name: 'Tubarão', emoji: '🦈' },
  { name: 'Coruja', emoji: '🦉' },
  { name: 'Jaguar', emoji: '🐆' },
  { name: 'Lobo', emoji: '🐺' },
  { name: 'Raposa', emoji: '🦊' },
  { name: 'Urso', emoji: '🐻' },
  { name: 'Leão', emoji: '🦁' },
  { name: 'Panda', emoji: '🐼' },
  { name: 'Foca', emoji: '🦭' },
  { name: 'Polvo', emoji: '🐙' },
  { name: 'Dragão', emoji: '🐉' },
  { name: 'Macaco', emoji: '🐵' },
  { name: 'Rinoceronte', emoji: '🦏' },
  { name: 'Touro', emoji: '🐂' },
  { name: 'Coelho', emoji: '🐰' },
  { name: 'Gato', emoji: '🐱' },
  { name: 'Sapo', emoji: '🐸' },
  { name: 'Abelha', emoji: '🐝' },
  { name: 'Golfinho', emoji: '🐬' },
  { name: 'Cavalo', emoji: '🐴' },
  { name: 'Elefante', emoji: '🐘' },
  { name: 'Camelo', emoji: '🐫' },
  { name: 'Zebra', emoji: '🦓' },
  { name: 'Girafa', emoji: '🦒' },
  { name: 'Gorila', emoji: '🦍' },
  { name: 'Canguru', emoji: '🦘' },
  { name: 'Bode', emoji: '🐐' },
  { name: 'Galo', emoji: '🐓' },
  { name: 'Pavão', emoji: '🦚' },
  { name: 'Cisne', emoji: '🦢' },
  { name: 'Morcego', emoji: '🦇' },
  { name: 'Javali', emoji: '🐗' },
  { name: 'Lagarto', emoji: '🦎' },
  { name: 'Cobra', emoji: '🐍' },
  { name: 'Tartaruga', emoji: '🐢' },
  { name: 'Baleia', emoji: '🐳' },
  { name: 'Unicórnio', emoji: '🦄' },
];

export const ADJECTIVES = [
  'Furioso', 'Veloz', 'Turbo', 'Lendário', 'Feroz', 'Elétrico', 'Implacável',
  'Sônico', 'Relâmpago', 'Imparável', 'Selvagem', 'Cósmico', 'Atômico',
  'Explosivo', 'Radical', 'Supremo', 'Vulcânico', 'Frenético', 'Galáctico',
  'Invencível', 'Brutal', 'Hipersônico', 'Colossal', 'Maluco', 'Ninja',
  'Místico', 'Flamejante', 'Furacão', 'Trovão', 'Laser', 'Quântico',
  'Diabólico', 'Épico', 'Imortal', 'Blindado', 'Magnético', 'Nuclear',
  'Selvático', 'Sinistro', 'Glorioso', 'Indomável',
];

/**
 * Creates a stateful name factory. Each call to the returned function yields a
 * unique identity. Uniqueness comes from `seq`; the adjective/animal pair is
 * cosmetic and may repeat across players.
 *
 * @param {() => number} [rng] - random source in [0,1), injectable for tests.
 * @returns {() => {name: string, emoji: string, seq: number, label: string}}
 */
export function makeNameFactory(rng = Math.random) {
  let seq = 0;
  return function next() {
    seq += 1;
    const animal = ANIMALS[Math.floor(rng() * ANIMALS.length)];
    const adjective = ADJECTIVES[Math.floor(rng() * ADJECTIVES.length)];
    const name = `${animal.name} ${adjective}`;
    return {
      name,
      emoji: animal.emoji,
      seq,
      label: `${name} #${seq}`,
    };
  };
}
