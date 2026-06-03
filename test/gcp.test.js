import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pubsub, redis, spanner, initGcpServices } from '../src/gcp/index.js';
import { generateIdentity } from '../src/services/names-service.js';
import { registerPlayer, getPlayer, getActiveRound, saveActiveRound } from '../src/services/db-service.js';
import { getPlayerView, getPublicState } from '../src/services/player-view-service.js';

// Setup environment and initialize mock services
test('GCP mock services initialize correctly', async () => {
  process.env.USE_MOCKS = 'true';
  await initGcpServices();
  
  assert.ok(pubsub.useMock);
  assert.ok(redis.useMock);
  assert.ok(spanner.useMock);
});

test('Distributed Names Service produces stable, unique names', async () => {
  const profile1 = await generateIdentity();
  const profile2 = await generateIdentity();
  
  assert.ok(profile1.name);
  assert.ok(profile1.emoji);
  assert.notEqual(profile1.seq, profile2.seq); // Monotonically unique sequence IDs
});

test('Spanner & Redis DB Service registers players transactionally', async () => {
  const id = 'player-test-uuid-123';
  const profile = { name: 'Panda Ninja', emoji: '🐼', seq: 42 };
  
  const registered = await registerPlayer(id, profile);
  assert.equal(registered.name, 'Panda Ninja');
  
  const fetched = await getPlayer(id);
  assert.ok(fetched);
  assert.equal(fetched.name, 'Panda Ninja');
  assert.equal(fetched.seq, 42);
});

test('Redis Mock sorted set ranking operations work correctly', async () => {
  const r = redis.client;
  const key = 'test:leaderboard';
  
  await r.zincrby(key, 10, 'player_a');
  await r.zincrby(key, 25, 'player_b');
  await r.zincrby(key, 5, 'player_c');
  
  const scoreB = await r.zscore(key, 'player_b');
  assert.equal(scoreB, '25');
  
  const rankB = await r.zrevrank(key, 'player_b');
  assert.equal(rankB, 0); // Highest score gets rank 0
  
  const rankC = await r.zrevrank(key, 'player_c');
  assert.equal(rankC, 2); // Lowest score gets rank 2
});

test('State Machine metadata round operations propagate through Spanner & Redis', async () => {
  const roundState = {
    roundId: 99,
    phase: 'countdown',
    startsAt: Date.now() + 3000,
    endsAt: Date.now() + 33000,
    durationMs: 30000,
    totalTaps: 0,
    winner: null,
  };
  
  await saveActiveRound(roundState);
  
  const active = await getActiveRound();
  assert.equal(active.roundId, 99);
  assert.equal(active.phase, 'countdown');
});
