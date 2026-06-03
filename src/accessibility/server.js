import express from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import { generateEphemeralGeminiToken, parseSyllablesToTaps, dispatchVocalTapsToPubSub } from './gemini-gateway.js';
import { initGcpServices } from '../gcp/index.js';

const PORT = Number(process.env.ACCESSIBILITY_PORT) || 8081;
const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));

// Allow CORS from main site origins during development
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// 1. Ephemeral Token Vending Machine Endpoint
app.post('/auth/gemini-live', async (req, res) => {
  const { playerId } = req.body || {};
  if (!playerId) {
    return res.status(400).json({ error: 'playerId is required' });
  }

  try {
    const creds = await generateEphemeralGeminiToken(playerId);
    res.json(creds);
  } catch (err) {
    console.error('❌ [Accessibility Service] Token generation error:', err.message);
    res.status(500).json({ error: 'Failed to negotiate voice gateway credentials' });
  }
});

// 2. Direct REST Voice Ingestion Endpoint (Optional lightweight alternative to WebSocket)
app.post('/vocal-tap', async (req, res) => {
  const { playerId, text } = req.body || {};
  if (!playerId) {
    return res.status(400).json({ error: 'playerId is required' });
  }

  try {
    const count = parseSyllablesToTaps(text);
    if (count > 0) {
      const msgId = await dispatchVocalTapsToPubSub(playerId, count);
      return res.json({
        ok: true,
        detectedSyllables: count,
        dispatchedMessageId: msgId,
        pacingClampApplied: count > 12
      });
    }

    res.json({ ok: true, detectedSyllables: 0, msg: 'No phonetic tapping sounds detected' });
  } catch (err) {
    console.error('❌ [Accessibility Service] Vocal tap dispatch error:', err.message);
    res.status(500).json({ error: 'Ingestion pipeline error' });
  }
});

// 3. Health & Readiness
app.get(['/healthz', '/livez'], (_req, res) => {
  res.json({ ok: true, service: 'tree-accessibility-gateway' });
});

const server = http.createServer(app);

// 4. WebSocket Upgrade Handler for Simulated Local Audio/STT Streaming
server.on('upgrade', (req, socket, head) => {
  const url = req.url || '';
  if (url.startsWith('/voice-stream/mock')) {
    // Perform standard WebSocket handshake
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    const acceptKey = crypto
      .createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');

    const headers = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey}`
    ];

    socket.write(headers.concat('\r\n').join('\r\n'));

    console.log('🎙️ [Accessibility Service] Mock WebSocket established. Simulating audio streaming...');

    // Parse simple incoming frames containing vocal text packets or mock audio binary indicators
    socket.on('data', async (chunk) => {
      // In a real Gemini Multimodal Live API, client sends base64/binary PCM audio frames, 
      // and server replies with text/json frames. Here we mock a simple text-trigger loop 
      // where client can write voice syllables directly as strings inside websocket frames.
      try {
        // Extract basic payload from WebSocket text frame if masked
        // Frame format: [FIN, RSV, Opcode] [Mask, Payload Length] [Masking Key] [Payload Data]
        if (chunk.length < 2) return;
        const secondByte = chunk[1];
        const isMasked = (secondByte & 0x80) !== 0;
        let payloadLength = secondByte & 0x7F;
        
        let dataStart = 2;
        if (payloadLength === 126) {
          dataStart = 4;
        } else if (payloadLength === 127) {
          dataStart = 10;
        }
        
        let maskingKey;
        if (isMasked) {
          maskingKey = chunk.subarray(dataStart, dataStart + 4);
          dataStart += 4;
        }
        
        let payload = chunk.subarray(dataStart);
        if (isMasked && maskingKey) {
          payload = Buffer.from(payload.map((byte, i) => byte ^ maskingKey[i % 4]));
        }
        
        const decodedText = payload.toString('utf8').replace(/[\p{C}]/gu, '').trim();
        if (decodedText.length > 0) {
          console.log(`🎙️ [Accessibility Service] Mock Audio STT Recognized: "${decodedText}"`);
          const count = parseSyllablesToTaps(decodedText);
          
          if (count > 0) {
            // For mock demo, we extract player ID from query string or use a mock player ID
            const urlObj = new URL(url, 'http://localhost');
            const playerId = urlObj.searchParams.get('playerId') || 'mock-accessibility-player';
            
            const msgId = await dispatchVocalTapsToPubSub(playerId, count);
            
            // Write JSON response frame back to WebSocket client
            const resPayload = JSON.stringify({
              type: 'vocal-tap-processed',
              detectedSyllables: count,
              messageId: msgId
            });
            
            const responseFrame = Buffer.concat([
              Buffer.from([0x81, resPayload.length]), // Text frame, FIN
              Buffer.from(resPayload)
            ]);
            socket.write(responseFrame);
          }
        }
      } catch (err) {
        // Ignore framing errors in tests
      }
    });

    socket.on('close', () => {
      console.log('🎙️ [Accessibility Service] Mock WebSocket closed.');
    });
  } else {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
  }
});

// 5. Bootstrap
async function main() {
  await initGcpServices();
  server.listen(PORT, () => {
    console.log(`🎙️ TREE Accessibility Service running on :${PORT}`);
    console.log(`   Vending Token: POST http://localhost:${PORT}/auth/gemini-live`);
    console.log(`   Mock Voice WS: ws://localhost:${PORT}/voice-stream/mock`);
  });
}

// Only run automatically if executed directly
if (import.meta.url.startsWith('file:') && process.argv[1] === import.meta.url.replace('file://', '')) {
  main().catch(err => {
    console.error('❌ Service failed to start:', err.message);
    process.exit(1);
  });
}

export { app, server };
