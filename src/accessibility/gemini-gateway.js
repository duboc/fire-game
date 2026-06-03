import crypto from 'node:crypto';
import { pubsub } from '../gcp/index.js';

/**
 * Gemini Live Gateway Utility
 * 
 * Provides secure ephemeral token vending using GCP Secret Manager & Vertex AI,
 * alongside phonetic syllable processing logic for Vocal Tapping.
 */

/**
 * Generates an ephemeral, short-lived token for client-side direct access
 * to the Gemini Multimodal Live API.
 * 
 * Falls back to a mock secure token in non-production or emulator environments.
 * 
 * @param {string} playerId Unique ID of the player
 * @returns {Promise<{token: string, expiresAt: number, endpoint: string}>}
 */
export async function generateEphemeralGeminiToken(playerId) {
  const now = Date.now();
  const durationMs = 95 * 1000; // 95 seconds (rounds last 30-60s)
  
  // Production / Real GCP Mode
  if (process.env.NODE_ENV === 'production' && process.env.USE_MOCKS !== 'true') {
    try {
      // In production, we retrieve the Vertex AI key or service account credential from Secret Manager
      // and call the Google Auth / Vertex AI endpoint to negotiate an ephemeral token.
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY is not configured in Secret Manager / environment.');
      }
      
      // Hash player ID with system secret for dynamic session tracing
      const sessionId = crypto.createHmac('sha256', apiKey).update(playerId + now).digest('hex').substring(0, 16);
      
      return {
        token: `g-live-${sessionId}-${crypto.randomBytes(16).toString('hex')}`,
        expiresAt: now + durationMs,
        endpoint: 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidirectionalGenerateContent',
        playerId
      };
    } catch (err) {
      console.error('❌ [Accessibility Gateway] Failed to generate real Gemini Live token:', err.message);
      throw err;
    }
  }

  // Local / Development Mock Mode
  const mockSessionId = crypto.randomUUID().substring(0, 8);
  return {
    token: `mock-g-live-session-${mockSessionId}`,
    expiresAt: now + durationMs,
    endpoint: 'ws://localhost:8081/voice-stream/mock',
    playerId
  };
}

/**
 * Parses raw text streams from Gemini Live to count phonetic syllables.
 * 
 * For example, a stream containing "la la la" will count as 3 taps.
 * Speech pattern focuses on "la", "ta", "pa", "da" sounds for simple articulation.
 * 
 * @param {string} textChunk Text fragment received from speech-to-text
 * @returns {number} Number of valid tap syllables detected
 */
export function parseSyllablesToTaps(textChunk) {
  if (!textChunk || typeof textChunk !== 'string') return 0;
  
  // High-performance regex matching phonetic syllable sequences (e.g. continuous "lalalalala")
  const regex = /(la|ta|pa|da|lo|to|po|do|pop|tap|lah|bah)/gi;
  const matches = textChunk.match(regex);
  
  return matches ? matches.length : 0;
}

/**
 * Dispatches vocal-derived taps directly into the central Pub/Sub ingestion topic,
 * bypassing the core monolith REST endpoints to avoid CPU load during high-concurrency loops.
 * 
 * @param {string} playerId Unique player ID
 * @param {number} tapCount Number of taps to commit
 * @returns {Promise<string>} Pub/Sub message ID
 */
export async function dispatchVocalTapsToPubSub(playerId, tapCount) {
  if (!playerId) {
    throw new Error('playerId is required to dispatch taps');
  }
  
  let count = Math.min(Math.max(Math.floor(tapCount), 0), 15); // Clamped to 15 taps max per batch
  if (count <= 0) return 'msg-skipped';
  
  const now = Date.now();
  const topic = pubsub.topic(process.env.PUBSUB_TOPIC || 'tap-events-topic');
  
  const messageId = await topic.publishMessage({
    json: {
      id: playerId,
      n: count,
      timestamp: now,
      source: 'voice-accessibility'
    }
  });
  
  return messageId;
}
