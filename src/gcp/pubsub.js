// GCP Pub/Sub client wrapper with transparent in-memory local fallback.
import { EventEmitter } from 'node:events';

// In-memory Pub/Sub broker for local development/testing without emulators.
class InMemoryBroker extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
  }
}

const broker = new InMemoryBroker();

export class PubSubClient {
  constructor(opts = {}) {
    this.projectId = opts.projectId || process.env.GCP_PROJECT_ID || 'tree-dev';
    this.emulatorHost = process.env.PUBSUB_EMULATOR_HOST;
    this.useMock = !this.emulatorHost && (process.env.NODE_ENV !== 'production' || process.env.USE_MOCKS === 'true');
    this.client = null;
  }

  async init() {
    if (this.useMock) {
      console.log('📨 [Pub/Sub] Using in-memory local fallback broker');
      return;
    }
    try {
      const { PubSub } = await import('@google-cloud/pubsub');
      this.client = new PubSub({ projectId: this.projectId });
      console.log(`📨 [Pub/Sub] Initialized official client (${this.emulatorHost ? 'Emulator' : 'Production'})`);
    } catch (err) {
      console.warn('⚠️ [Pub/Sub] Failed to load official library, falling back to in-memory broker:', err.message);
      this.useMock = true;
    }
  }

  topic(name) {
    if (this.useMock) {
      return {
        name,
        publishMessage: async (message) => {
          const data = message.json || JSON.parse(Buffer.from(message.data).toString());
          // Run asynchronously to simulate network latency
          setImmediate(() => {
            broker.emit(`topic:${name}`, {
              data: Buffer.from(JSON.stringify(data)),
              attributes: message.attributes || {},
              publishTime: new Date().toISOString(),
              messageId: Math.random().toString(36).substring(2),
            });
          });
          return 'msg-' + Math.random().toString(36).substring(2);
        },
        publish: async (dataBuffer) => {
          const data = JSON.parse(dataBuffer.toString());
          setImmediate(() => {
            broker.emit(`topic:${name}`, {
              data: dataBuffer,
              attributes: {},
              publishTime: new Date().toISOString(),
              messageId: Math.random().toString(36).substring(2),
            });
          });
          return 'msg-' + Math.random().toString(36).substring(2);
        }
      };
    }

    const t = this.client.topic(name);
    return {
      name,
      publishMessage: (msg) => t.publishMessage(msg),
      publish: (buf) => t.publish(buf)
    };
  }

  subscription(name, opts = {}) {
    const topicName = opts.topic || 'tap-events-topic';
    if (this.useMock) {
      const subEmitter = new EventEmitter();
      const listener = (msg) => {
        // Wrap message with standard ack/nack mock interface
        const mockedMessage = {
          ...msg,
          ack: () => {},
          nack: () => {},
        };
        subEmitter.emit('message', mockedMessage);
      };

      return {
        name,
        on: (event, cb) => {
          if (event === 'message') {
            broker.on(`topic:${topicName}`, listener);
          }
          subEmitter.on(event, cb);
          return this;
        },
        removeListener: (event, cb) => {
          if (event === 'message') {
            broker.removeListener(`topic:${topicName}`, listener);
          }
          subEmitter.removeListener(event, cb);
          return this;
        },
        close: async () => {
          broker.removeListener(`topic:${topicName}`, listener);
        }
      };
    }

    return this.client.subscription(name);
  }
}

export const pubSubBroker = broker; // For local coordination
