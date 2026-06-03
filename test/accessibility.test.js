import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateEphemeralGeminiToken, parseSyllablesToTaps, dispatchVocalTapsToPubSub } from '../src/accessibility/gemini-gateway.js';
import { initGcpServices, pubsub } from '../src/gcp/index.js';
import { app, server } from '../src/accessibility/server.js';

test('Accessibility Core - generateEphemeralGeminiToken produces valid credentials', async () => {
  // Ensure GCP Mocks are active
  process.env.USE_MOCKS = 'true';
  await initGcpServices();

  const playerId = 'test-player-acc-123';
  const creds = await generateEphemeralGeminiToken(playerId);

  assert.ok(creds.token);
  assert.ok(creds.endpoint);
  assert.ok(creds.expiresAt > Date.now());
  assert.equal(creds.playerId, playerId);
});

test('Accessibility Core - parseSyllablesToTaps extracts correct rhythmic syllable counts', () => {
  assert.equal(parseSyllablesToTaps('la la la'), 3);
  assert.equal(parseSyllablesToTaps('ta-ta-ta'), 3);
  assert.equal(parseSyllablesToTaps('la ta pa da'), 4);
  assert.equal(parseSyllablesToTaps('xyz'), 0);
  assert.equal(parseSyllablesToTaps('pop tap pop lah'), 4);
  assert.equal(parseSyllablesToTaps('LALALALA'), 4); // Case insensitive
});

test('Accessibility Core - dispatchVocalTapsToPubSub successfully dispatches to topic', async () => {
  process.env.USE_MOCKS = 'true';
  await initGcpServices();

  const playerId = 'test-player-acc-123';
  const messageId = await dispatchVocalTapsToPubSub(playerId, 5);

  assert.ok(messageId);
  assert.match(messageId, /^msg-/);
});

test('Accessibility Microservice API - Token vending responds successfully', async () => {
  process.env.USE_MOCKS = 'true';
  await initGcpServices();

  // We can test the Express app directly by importing/invoking the handler 
  // or testing mock requests without listening on a port to prevent collision.
  const req = {
    body: { playerId: 'test-api-acc-456' }
  };
  
  let jsonResponse = null;
  let statusSet = null;
  
  const res = {
    json: (data) => {
      jsonResponse = data;
      return res;
    },
    status: (code) => {
      statusSet = code;
      return res;
    }
  };

  // Extract the handler for POST /auth/gemini-live
  const route = app._router.stack.find(s => s.route && s.route.path === '/auth/gemini-live');
  assert.ok(route);

  await route.route.stack[0].handle(req, res);

  assert.equal(statusSet, null); // 200 OK
  assert.ok(jsonResponse.token);
  assert.ok(jsonResponse.endpoint);
  assert.equal(jsonResponse.playerId, 'test-api-acc-456');
});

test('Accessibility Microservice API - Vocal tap ingestion extracts and dispatches', async () => {
  process.env.USE_MOCKS = 'true';
  await initGcpServices();

  const req = {
    body: {
      playerId: 'test-api-acc-456',
      text: 'la la la pop'
    }
  };
  
  let jsonResponse = null;
  let statusSet = null;
  
  const res = {
    json: (data) => {
      jsonResponse = data;
      return res;
    },
    status: (code) => {
      statusSet = code;
      return res;
    }
  };

  const route = app._router.stack.find(s => s.route && s.route.path === '/vocal-tap');
  assert.ok(route);

  await route.route.stack[0].handle(req, res);

  assert.equal(statusSet, null); // 200 OK
  assert.equal(jsonResponse.ok, true);
  assert.equal(jsonResponse.detectedSyllables, 4);
  assert.ok(jsonResponse.dispatchedMessageId);
});
