// GCP BigQuery client wrapper with transparent in-memory local fallback.

class MockDataset {
  constructor() {
    this.tables = {};
  }

  table(tableId) {
    if (!this.tables[tableId]) {
      this.tables[tableId] = {
        rows: [],
        insert: async (rows) => {
          const arr = Array.isArray(rows) ? rows : [rows];
          this.tables[tableId].rows.push(...arr);
          console.log(`📊 [BigQuery Mock] Inserted ${arr.length} rows into table '${tableId}'`);
        },
        getRows: async () => this.tables[tableId].rows
      };
    }
    return this.tables[tableId];
  }
}

export class BigQueryClient {
  constructor(opts = {}) {
    this.projectId = opts.projectId || process.env.GCP_PROJECT_ID || 'project-pt-internal';
    this.useMock = process.env.NODE_ENV !== 'production' || process.env.USE_MOCKS === 'true';
    this.client = null;
    this.mockDatasetInstance = null;
  }

  async init() {
    if (this.useMock) {
      console.log('📊 [BigQuery] Using in-memory local fallback dataset');
      this.mockDatasetInstance = new MockDataset();
      this.client = {
        dataset: (id) => this.mockDatasetInstance
      };
      return;
    }

    try {
      const { BigQuery } = await import('@google-cloud/bigquery');
      this.client = new BigQuery({ projectId: this.projectId });
      console.log(`📊 [BigQuery] Initialized official client for project: ${this.projectId}`);

      // Ensure dataset and tables exist
      await this.ensureDatasetAndTables();
    } catch (err) {
      console.warn('⚠️ [BigQuery] Failed to load official library, falling back to in-memory dataset:', err.message);
      this.useMock = true;
      this.mockDatasetInstance = new MockDataset();
      this.client = {
        dataset: (id) => this.mockDatasetInstance
      };
    }
  }

  async ensureDatasetAndTables() {
    const datasetId = 'tree_analytics';
    const dataset = this.client.dataset(datasetId);

    try {
      const [exists] = await dataset.exists();
      if (!exists) {
        console.log(`📊 [BigQuery] Creating dataset '${datasetId}'...`);
        await dataset.create({ location: 'us-central1' });
      }

      // Ensure clickstream_logs table exists
      const clickstreamTable = dataset.table('clickstream_logs');
      const [csExists] = await clickstreamTable.exists();
      if (!csExists) {
        console.log(`📊 [BigQuery] Creating table 'clickstream_logs'...`);
        await clickstreamTable.create({
          schema: [
            { name: 'round_id', type: 'STRING', mode: 'REQUIRED' },
            { name: 'player_id', type: 'STRING', mode: 'REQUIRED' },
            { name: 'tap_count', type: 'INTEGER', mode: 'REQUIRED' },
            { name: 'timestamp', type: 'TIMESTAMP', mode: 'REQUIRED' }
          ]
        });
      }

      // Ensure round_summaries table exists
      const summariesTable = dataset.table('round_summaries');
      const [sumExists] = await summariesTable.exists();
      if (!sumExists) {
        console.log(`📊 [BigQuery] Creating table 'round_summaries'...`);
        await summariesTable.create({
          schema: [
            { name: 'round_id', type: 'STRING', mode: 'REQUIRED' },
            { name: 'duration_ms', type: 'INTEGER', mode: 'REQUIRED' },
            { name: 'total_players', type: 'INTEGER', mode: 'REQUIRED' },
            { name: 'total_taps', type: 'INTEGER', mode: 'REQUIRED' },
            { name: 'winner_id', type: 'STRING', mode: 'NULLABLE' },
            { name: 'winner_score', type: 'INTEGER', mode: 'NULLABLE' },
            { name: 'timestamp', type: 'TIMESTAMP', mode: 'REQUIRED' }
          ]
        });
      }
    } catch (err) {
      console.error('❌ [BigQuery] Error ensuring dataset/tables exist:', err.message);
    }
  }

  dataset(id) {
    if (this.useMock) {
      return this.mockDatasetInstance;
    }
    return this.client.dataset(id);
  }
}
