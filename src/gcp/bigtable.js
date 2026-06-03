// GCP Bigtable client wrapper with transparent in-memory local fallback.

class MockTable {
  constructor() {
    this.rows = [];
  }

  async insert(rows) {
    const arr = Array.isArray(rows) ? rows : [rows];
    this.rows.push(...arr);
    // Limit in-memory size
    if (this.rows.length > 5000) {
      this.rows = this.rows.slice(-5000);
    }
  }

  async getRows() {
    return this.rows;
  }
}

export class BigtableClient {
  constructor(opts = {}) {
    this.projectId = opts.projectId || process.env.GCP_PROJECT_ID || 'tree-dev';
    this.emulatorHost = process.env.BIGTABLE_EMULATOR_HOST;
    this.useMock = !this.emulatorHost && (process.env.NODE_ENV !== 'production' || process.env.USE_MOCKS === 'true');
    this.client = null;
    this.mockTableInstance = null;
  }

  async init() {
    if (this.useMock) {
      console.log('📊 [Bigtable] Using in-memory local fallback tables');
      this.mockTableInstance = new MockTable();
      this.client = {
        instance: (id) => ({
          table: (tableId) => this.mockTableInstance
        })
      };
      return;
    }
    try {
      const { Bigtable } = await import('@google-cloud/bigtable');
      this.client = new Bigtable({ projectId: this.projectId });
      console.log(`📊 [Bigtable] Initialized official client (${this.emulatorHost ? 'Emulator' : 'Production'})`);
    } catch (err) {
      console.warn('⚠️ [Bigtable] Failed to load official library, falling back to in-memory tables:', err.message);
      this.useMock = true;
      this.mockTableInstance = new MockTable();
      this.client = {
        instance: (id) => ({
          table: (tableId) => this.mockTableInstance
        })
      };
    }
  }

  instance(id) {
    if (this.useMock) {
      return {
        table: (tableId) => this.mockTableInstance
      };
    }
    const inst = this.client.instance(id);
    return {
      table: (tableId) => {
        const tbl = inst.table(tableId);
        return {
          insert: (rows) => tbl.insert(rows)
        };
      }
    };
  }
}
