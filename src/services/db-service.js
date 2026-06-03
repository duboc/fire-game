// DB Service — handles relational and transient storage operations in Spanner and Redis
import { redis, spanner } from '../gcp/index.js';

// Local memory cache for players to avoid querying Spanner/Redis constantly on the hot path
const playerCache = new Map();

export async function getPlayer(id) {
  if (!id) return null;
  if (playerCache.has(id)) {
    return playerCache.get(id);
  }

  // 1. Try Redis cache
  try {
    const cached = await redis.client.hgetall(`player:${id}`);
    if (cached && cached.name) {
      const p = {
        id,
        name: cached.name,
        emoji: cached.emoji,
        seq: parseInt(cached.seq, 10),
      };
      playerCache.set(id, p);
      return p;
    }
  } catch (err) {
    console.error('[db-service] Redis hash get failed:', err.message);
  }

  // 2. Try Spanner system of record
  try {
    const db = spanner.client.instance('tree-instance').database('tree-db');
    const [rows] = await db.run({
      sql: 'SELECT * FROM Players WHERE player_id = @id',
      params: { id }
    });
    if (rows && rows.length > 0) {
      const row = rows[0];
      const p = {
        id,
        name: row.name,
        emoji: row.emoji,
        seq: parseInt(row.seq, 10),
      };
      playerCache.set(id, p);
      
      // Sync back to Redis cache
      await redis.client.hset(`player:${id}`, {
        name: p.name,
        emoji: p.emoji,
        seq: String(p.seq),
      }).catch(() => {});

      return p;
    }
  } catch (err) {
    console.error('[db-service] Spanner player lookup failed:', err.message);
  }

  return null;
}

export async function registerPlayer(id, profile) {
  const player = {
    id,
    name: profile.name,
    emoji: profile.emoji,
    seq: profile.seq,
  };

  playerCache.set(id, player);

  // 1. Write to Spanner (transactional registration)
  try {
    const db = spanner.client.instance('tree-instance').database('tree-db');
    await db.runTransactionAsync(async (transaction) => {
      await transaction.insert('Players', {
        player_id: id,
        name: player.name,
        emoji: player.emoji,
        seq: player.seq,
        created_at: 'spanner.commitTimestamp', // In production, Spanner inserts server timestamp
      });
    });
  } catch (err) {
    console.error('[db-service] Spanner player insert failed:', err.message);
  }

  // 2. Cache in Redis
  try {
    await redis.client.hset(`player:${id}`, {
      name: player.name,
      emoji: player.emoji,
      seq: String(player.seq),
    });
    // Set TTL on player cache so it self-cleans
    await redis.client.expire(`player:${id}`, 86400); // 24 hours
  } catch (err) {
    console.error('[db-service] Redis player caching failed:', err.message);
  }

  return player;
}

export async function getActiveRound() {
  // 1. Check Redis first
  try {
    const roundStr = await redis.client.get('round:active');
    if (roundStr) {
      const active = JSON.parse(roundStr);
      return active;
    }
  } catch (err) {
    console.error('[db-service] Redis getActiveRound failed:', err.message);
  }

  // 2. Check Spanner system of record
  try {
    const db = spanner.client.instance('tree-instance').database('tree-db');
    const [rows] = await db.run({
      sql: 'SELECT * FROM Rounds ORDER BY round_id DESC LIMIT 1'
    });
    if (rows && rows.length > 0) {
      const row = rows[0];
      const active = {
        roundId: parseInt(row.round_id, 10),
        phase: row.status,
        startsAt: row.starts_at ? parseInt(row.starts_at, 10) : null,
        endsAt: row.ends_at ? parseInt(row.ends_at, 10) : null,
        durationMs: parseInt(row.duration_ms, 10),
        totalTaps: parseInt(row.total_taps, 10),
        winner: row.winner_id ? {
          id: row.winner_id,
          name: row.winner_name,
          count: parseInt(row.winner_count, 10),
        } : null,
      };

      // Populate Redis cache
      await redis.client.set('round:active', JSON.stringify(active)).catch(() => {});
      return active;
    }
  } catch (err) {
    console.error('[db-service] Spanner getActiveRound failed:', err.message);
  }

  // Default initial lobby if nothing exists yet
  const defaultRound = {
    roundId: 0,
    phase: 'lobby',
    startsAt: null,
    endsAt: null,
    durationMs: 30000,
    totalTaps: 0,
    winner: null,
  };
  
  await saveActiveRound(defaultRound).catch(() => {});
  return defaultRound;
}

export async function saveActiveRound(roundState) {
  // 1. Save to Redis
  try {
    await redis.client.set('round:active', JSON.stringify(roundState));
    await redis.client.publish('round-updates', JSON.stringify(roundState));
  } catch (err) {
    console.error('[db-service] Redis saveActiveRound failed:', err.message);
  }

  // 2. Save to Spanner
  try {
    const db = spanner.client.instance('tree-instance').database('tree-db');
    await db.runTransactionAsync(async (transaction) => {
      // Upsert round details
      await transaction.update('Rounds', {
        round_id: roundState.roundId,
        status: roundState.phase,
        starts_at: roundState.startsAt,
        ends_at: roundState.endsAt,
        duration_ms: roundState.durationMs,
        total_taps: roundState.totalTaps,
        winner_id: roundState.winner?.id || null,
        winner_name: roundState.winner?.name || null,
        winner_count: roundState.winner?.count || null,
      }).catch(async () => {
        // If update failed because row doesn't exist, insert instead
        await transaction.insert('Rounds', {
          round_id: roundState.roundId,
          status: roundState.phase,
          starts_at: roundState.startsAt,
          ends_at: roundState.endsAt,
          duration_ms: roundState.durationMs,
          total_taps: roundState.totalTaps,
          winner_id: roundState.winner?.id || null,
          winner_name: roundState.winner?.name || null,
          winner_count: roundState.winner?.count || null,
        });
      });
    });
  } catch (err) {
    console.error('[db-service] Spanner saveActiveRound failed:', err.message);
  }
}
