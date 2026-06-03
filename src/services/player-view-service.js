// Player View Service — constructs client-side payloads stateless-ly from Redis & Spanner
import { redis, spanner } from '../gcp/index.js';
import { getActiveRound, getPlayer } from './db-service.js';

export async function getPlayerView(id, now) {
  const activeRound = await getActiveRound();
  const roundId = activeRound.roundId;
  const phase = activeRound.phase;

  // Compute total registered players
  let totalPlayers = 0;
  try {
    if (phase === 'lobby') {
      // In lobby, pull player count directly from Spanner
      const db = spanner.client.instance('tree-instance').database('tree-db');
      const [rows] = await db.run('SELECT COUNT(*) as count FROM Players');
      totalPlayers = parseInt(rows[0]?.count || '0', 10);
    } else {
      // In game, pull from Redis sorted set card
      totalPlayers = await redis.client.zcard(`round:${roundId}:scores`);
      if (totalPlayers === 0) {
        // Fallback to Spanner if Redis is empty/fresh
        const db = spanner.client.instance('tree-instance').database('tree-db');
        const [rows] = await db.run('SELECT COUNT(*) as count FROM Players');
        totalPlayers = parseInt(rows[0]?.count || '0', 10);
      }
    }
  } catch (err) {
    console.error('[player-view-service] Player count retrieval failed:', err.message);
  }

  const base = {
    phase,
    serverNow: now,
    startsAt: activeRound.startsAt,
    endsAt: activeRound.endsAt,
    countdownMs: 3000,
    durationMs: activeRound.durationMs,
    total: totalPlayers || 1,
    roundId,
  };

  if (!id) {
    return { ...base, known: false };
  }

  const player = await getPlayer(id);
  if (!player) {
    return { ...base, known: false };
  }

  let yourCount = 0;
  let yourRank = totalPlayers || 1;

  try {
    // Read count from Redis sorted set
    const countStr = await redis.client.zscore(`round:${roundId}:scores`, id);
    if (countStr !== null) {
      yourCount = parseInt(countStr, 10);
    }

    // Read reverse rank from Redis sorted set (0-based)
    const rankIdx = await redis.client.zrevrank(`round:${roundId}:scores`, id);
    if (rankIdx !== null) {
      yourRank = rankIdx + 1;
    } else {
      yourRank = totalPlayers || 1;
    }
  } catch (err) {
    console.error('[player-view-service] Redis score/rank fetch failed:', err.message);
  }

  return {
    ...base,
    known: true,
    id: player.id,
    name: player.name,
    emoji: player.emoji,
    label: `${player.name} #${player.seq}`,
    yourRank,
    yourCount,
  };
}

export async function getPublicState(now) {
  const activeRound = await getActiveRound();
  const roundId = activeRound.roundId;
  const phase = activeRound.phase;

  let totalPlayers = 0;
  let totalTaps = 0;
  let top = [];

  try {
    // 1. Total players
    totalPlayers = await redis.client.zcard(`round:${roundId}:scores`);
    if (totalPlayers === 0) {
      const db = spanner.client.instance('tree-instance').database('tree-db');
      const [rows] = await db.run('SELECT COUNT(*) as count FROM Players');
      totalPlayers = parseInt(rows[0]?.count || '0', 10);
    }

    // 2. Total taps
    const totalTapsStr = await redis.client.get(`round:${roundId}:totalTaps`);
    totalTaps = totalTapsStr ? parseInt(totalTapsStr, 10) : 0;

    // 3. Fetch Top 10 from Redis
    const scores = await redis.client.client.zrevrange(`round:${roundId}:scores`, 0, 9, 'WITHSCORES');
    for (let i = 0; i < scores.length; i += 2) {
      const pId = scores[i];
      const pScore = parseInt(scores[i+1], 10);
      const player = await getPlayer(pId);
      if (player) {
        top.push({
          rank: (i / 2) + 1,
          id: pId,
          name: player.name,
          emoji: player.emoji,
          seq: player.seq,
          count: pScore,
        });
      }
    }
  } catch (err) {
    console.error('[player-view-service] Redis public state fetch failed:', err.message);
  }

  // If top is empty (e.g. in lobby), return empty or Spanner defaults
  return {
    phase,
    serverNow: now,
    startsAt: activeRound.startsAt,
    endsAt: activeRound.endsAt,
    countdownMs: 3000,
    durationMs: activeRound.durationMs,
    total: totalPlayers || 0,
    totalTaps,
    top,
    winner: activeRound.winner,
    roundId,
  };
}
