// GCP Spanner client wrapper with transparent in-memory local fallback.

class MockTransaction {
  constructor(db) {
    this.db = db;
  }

  async run(querySpec) {
    const { sql, params } = typeof querySpec === 'string' ? { sql: querySpec, params: {} } : querySpec;
    
    // Simple query routing to match Spanner behavior
    if (sql.includes('SELECT * FROM Players WHERE player_id =')) {
      const id = params?.id || sql.match(/'([^']+)'/)?.[1];
      const player = this.db.store.players.get(id);
      return [[player].filter(Boolean)];
    }

    if (sql.includes('SELECT * FROM Rounds WHERE round_id =')) {
      const id = params?.id || parseInt(sql.match(/round_id = (\d+)/)?.[1] || '0', 10);
      const round = this.db.store.rounds.get(id);
      return [[round].filter(Boolean)];
    }

    if (sql.includes('SELECT * FROM Rounds ORDER BY round_id DESC LIMIT 1')) {
      const rounds = Array.from(this.db.store.rounds.values()).sort((a, b) => b.round_id - a.round_id);
      return [[rounds[0]].filter(Boolean)];
    }

    return [[]];
  }

  async insert(table, rows) {
    const arr = Array.isArray(rows) ? rows : [rows];
    if (table.toLowerCase() === 'players') {
      for (const row of arr) {
        this.db.store.players.set(row.player_id, { ...row, count: 0 });
      }
    } else if (table.toLowerCase() === 'rounds') {
      for (const row of arr) {
        this.db.store.rounds.set(row.round_id, { ...row });
      }
    }
  }

  async update(table, rows) {
    const arr = Array.isArray(rows) ? rows : [rows];
    if (table.toLowerCase() === 'players') {
      for (const row of arr) {
        const existing = this.db.store.players.get(row.player_id) || {};
        this.db.store.players.set(row.player_id, { ...existing, ...row });
      }
    } else if (table.toLowerCase() === 'rounds') {
      for (const row of arr) {
        const existing = this.db.store.rounds.get(row.round_id) || {};
        this.db.store.rounds.set(row.round_id, { ...existing, ...row });
      }
    }
  }

  async commit() {
    // No-op in memory
  }
}

class MockDatabase {
  constructor() {
    this.store = {
      players: new Map(),
      rounds: new Map(),
    };
  }

  async runTransactionAsync(fn) {
    const transaction = new MockTransaction(this);
    try {
      const result = await fn(transaction);
      await transaction.commit();
      return result;
    } catch (err) {
      throw err;
    }
  }

  async run(querySpec) {
    const transaction = new MockTransaction(this);
    return transaction.run(querySpec);
  }
}

export class SpannerClient {
  constructor(opts = {}) {
    this.projectId = opts.projectId || process.env.GCP_PROJECT_ID || 'tree-dev';
    this.emulatorHost = process.env.SPANNER_EMULATOR_HOST;
    this.useMock = !this.emulatorHost && (process.env.NODE_ENV !== 'production' || process.env.USE_MOCKS === 'true');
    this.client = null;
    this.mockDbInstance = null;
  }

  async init() {
    if (this.useMock) {
      console.log('💾 [Spanner] Using in-memory local fallback database');
      this.mockDbInstance = new MockDatabase();
      return;
    }
    try {
      const { Spanner } = await import('@google-cloud/spanner');
      this.client = new Spanner({ projectId: this.projectId });
      console.log(`💾 [Spanner] Initialized official client (${this.emulatorHost ? 'Emulator' : 'Production'})`);
    } catch (err) {
      console.warn('⚠️ [Spanner] Failed to load official library, falling back to in-memory store:', err.message);
      this.useMock = true;
      this.mockDbInstance = new MockDatabase();
    }
  }

  instance(id) {
    if (this.useMock) {
      return {
        database: (dbId) => this.mockDbInstance
      };
    }
    const inst = this.client.instance(id);
    return {
      database: (dbId) => {
        const db = inst.database(dbId);
        return {
          runTransactionAsync: (fn) => db.runTransactionAsync(fn),
          run: (q) => db.run(q),
        };
      }
    };
  }
}
