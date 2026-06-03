// GCP MemoryStore Redis client wrapper with transparent in-memory local fallback.
import { EventEmitter } from 'node:events';

// In-memory Redis simulation class
class MockRedisClient extends EventEmitter {
  constructor() {
    super();
    this.zsets = new Map(); // key -> Map(member -> score) or value string
    this.subscribers = new Map(); // channel -> Set(callback)
  }

  async incr(key) {
    const val = this.zsets.get(key);
    const next = (val !== undefined ? Number(val) : 0) + 1;
    this.zsets.set(key, String(next));
    return next;
  }

  async incrby(key, increment) {
    const val = this.zsets.get(key);
    const next = (val !== undefined ? Number(val) : 0) + Number(increment);
    this.zsets.set(key, String(next));
    return next;
  }

  async hset(key, ...args) {
    if (!this.zsets.has(key)) {
      this.zsets.set(key, new Map());
    }
    const map = this.zsets.get(key);
    if (!(map instanceof Map)) {
      this.zsets.set(key, new Map());
    }
    const activeMap = this.zsets.get(key);
    
    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
      for (const [f, v] of Object.entries(args[0])) {
        activeMap.set(f, String(v));
      }
    } else {
      const [field, value] = args;
      activeMap.set(field, String(value));
    }
    return 1;
  }

  async hgetall(key) {
    const map = this.zsets.get(key);
    if (!map || !(map instanceof Map)) return {};
    return Object.fromEntries(map.entries());
  }

  async expire(key, seconds) {
    return 1;
  }

  async get(key) {
    const val = this.zsets.get(key);
    if (val instanceof Map) return null;
    return val !== undefined ? String(val) : null;
  }

  async set(key, value) {
    this.zsets.set(key, String(value));
    return 'OK';
  }

  async zcard(key) {
    const zset = this.zsets.get(key);
    if (!zset || !(zset instanceof Map)) return 0;
    return zset.size;
  }

  // Zincrby
  async zincrby(key, increment, member) {
    if (!this.zsets.has(key)) {
      this.zsets.set(key, new Map());
    }
    const zset = this.zsets.get(key);
    if (!(zset instanceof Map)) {
      this.zsets.set(key, new Map());
    }
    const activeZset = this.zsets.get(key);
    const current = activeZset.get(member) || 0;
    const next = Number(current) + Number(increment);
    activeZset.set(member, next);
    return next;
  }

  // Zscore
  async zscore(key, member) {
    const zset = this.zsets.get(key);
    if (!zset || !(zset instanceof Map)) return null;
    const val = zset.get(member);
    return val !== undefined ? String(val) : null;
  }

  // Zrevrank (0-based rank)
  async zrevrank(key, member) {
    const zset = this.zsets.get(key);
    if (!zset || !(zset instanceof Map) || !zset.has(member)) return null;
    
    // Sort descending by score, ties broken alphabetically
    const sorted = Array.from(zset.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const idx = sorted.findIndex(entry => entry[0] === member);
    return idx !== -1 ? idx : null;
  }

  // Zrevrange (retrieves elements descending)
  async zrevrange(key, start, stop, withScores) {
    const zset = this.zsets.get(key);
    if (!zset || !(zset instanceof Map)) return [];

    const sorted = Array.from(zset.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const slice = sorted.slice(start, stop === -1 ? undefined : stop + 1);

    if (withScores === 'WITHSCORES') {
      const res = [];
      for (const [member, score] of slice) {
        res.push(member, String(score));
      }
      return res;
    }
    return slice.map(entry => entry[0]);
  }

  // Del
  async del(key) {
    this.zsets.delete(key);
    return 1;
  }

  // Pub/Sub Publish
  async publish(channel, message) {
    setImmediate(() => {
      this.emit(`message:${channel}`, channel, message);
    });
    return 1;
  }

  // Pub/Sub Subscribe (Duplicated for ioredis compatibility)
  duplicate() {
    const dup = new MockRedisClient();
    dup.zsets = this.zsets; // Share storage
    return dup;
  }

  async subscribe(channel) {
    // In ioredis, subscribe takes a channel name and then emits 'message' event on the client
    this.on(`message:${channel}`, (chan, msg) => {
      this.emit('message', chan, msg);
    });
    return 1;
  }
}

export class RedisClient {
  constructor() {
    this.redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    this.useMock = !process.env.REDIS_HOST && (process.env.NODE_ENV !== 'production' || process.env.USE_MOCKS === 'true');
    this.client = null;
  }

  async init() {
    if (this.useMock) {
      console.log('🧠 [Redis] Using in-memory local fallback client');
      this.client = new MockRedisClient();
      return;
    }
    try {
      const { default: Redis } = await import('ioredis');
      this.client = new Redis(this.redisUrl, {
        maxRetriesPerRequest: 3,
        enableOfflineQueue: true,
      });
      console.log(`🧠 [Redis] Initialized official ioredis client (${this.redisUrl})`);
    } catch (err) {
      console.warn('⚠️ [Redis] Failed to load official library/connect, falling back to in-memory:', err.message);
      this.useMock = true;
      this.client = new MockRedisClient();
    }
  }

  getClient() {
    return this.client;
  }
}
