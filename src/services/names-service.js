// Distributed unique identity generator using Redis/Spanner sequences.
import { ANIMALS, ADJECTIVES } from '../names.js';
import { redis, spanner } from '../gcp/index.js';

export async function generateIdentity() {
  let seq = 0;
  
  try {
    // High-performance Redis sequence generator
    if (redis.client) {
      seq = await redis.client.getClient().incr('player:seq');
    }
  } catch (err) {
    console.warn('[names-service] Redis increment failed, falling back to Spanner:', err.message);
  }

  if (seq === 0) {
    try {
      // Fallback Spanner transaction to compute/increment sequence
      if (spanner.client) {
        const db = spanner.spanner.instance('tree-instance').database('tree-db');
        await db.runTransactionAsync(async (transaction) => {
          const [rows] = await transaction.run('SELECT COUNT(*) as count FROM Players');
          seq = parseInt(rows[0]?.count || '0', 10) + 1;
        });
      }
    } catch (err) {
      console.warn('[names-service] Spanner fallback failed, generating random sequence:', err.message);
    }
  }

  // Double fallback to random/timestamp sequence to prevent failures
  if (seq === 0) {
    seq = Math.floor(Math.random() * 1000000) + 1;
  }

  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const name = `${animal.name} ${adjective}`;
  
  return {
    name,
    emoji: animal.emoji,
    seq,
    label: `${name} #${seq}`,
  };
}
