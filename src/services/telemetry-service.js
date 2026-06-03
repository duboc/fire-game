// Telemetry & Observability Service — streams telemetry to Cloud Monitoring & BigQuery
import { bigquery, redis } from '../gcp/index.js';

let monitoringClient = null;
const useMock = process.env.NODE_ENV !== 'production' || process.env.USE_MOCKS === 'true';
const projectId = process.env.GCP_PROJECT_ID || 'project-pt-internal';

// Cache for metric descriptor creations
let metricsInitialized = false;

export async function initTelemetry() {
  if (useMock) {
    console.log('📈 [Telemetry] Using local console-based mock telemetry provider');
    return;
  }

  try {
    const { MetricServiceClient } = await import('@google-cloud/monitoring');
    monitoringClient = new MetricServiceClient({ projectId });
    console.log('📈 [Telemetry] Initialized GCP MetricServiceClient');
    await ensureMetricDescriptors();
  } catch (err) {
    console.warn('⚠️ [Telemetry] Failed to load GCP Monitoring client, fallback to mock:', err.message);
  }
}

async function ensureMetricDescriptors() {
  if (!monitoringClient || metricsInitialized) return;
  
  try {
    const defaultLabels = [
      { key: 'environment', valueType: 'STRING', description: 'Development or Production environment' }
    ];

    // 1. Custom metric: active_players
    const activePlayersDescriptor = {
      name: monitoringClient.projectMetricDescriptorPath(projectId, 'custom.googleapis.com/tree/active_players'),
      type: 'custom.googleapis.com/tree/active_players',
      metricKind: 'GAUGE',
      valueType: 'INT64',
      unit: '1',
      description: 'The number of active tapping players currently registered in the round.',
      displayName: 'TREE Active Players',
    };

    // 2. Custom metric: tap_rate (taps/second or taps per batch)
    const tapRateDescriptor = {
      name: monitoringClient.projectMetricDescriptorPath(projectId, 'custom.googleapis.com/tree/tap_rate'),
      type: 'custom.googleapis.com/tree/tap_rate',
      metricKind: 'GAUGE',
      valueType: 'DOUBLE',
      unit: '1',
      description: 'The rate of taps processed by the stream ingestion aggregator.',
      displayName: 'TREE Tap Velocity Rate',
    };

    await monitoringClient.createMetricDescriptor({
      name: monitoringClient.projectPath(projectId),
      metricDescriptor: activePlayersDescriptor,
    }).catch(err => {
      if (!err.message.includes('AlreadyExists')) console.error('Error creating active_players descriptor:', err.message);
    });

    await monitoringClient.createMetricDescriptor({
      name: monitoringClient.projectPath(projectId),
      metricDescriptor: tapRateDescriptor,
    }).catch(err => {
      if (!err.message.includes('AlreadyExists')) console.error('Error creating tap_rate descriptor:', err.message);
    });

    metricsInitialized = true;
    console.log('📈 [Telemetry] Custom GCP Metric Descriptors registered successfully.');
  } catch (err) {
    console.error('❌ [Telemetry] Error setting up Metric Descriptors:', err.message);
  }
}

/**
 * Publishes a custom metric data point to GCP Cloud Monitoring (or logs if mock)
 * @param {string} metricType e.g., 'custom.googleapis.com/tree/active_players'
 * @param {number} value value of the metric
 * @param {string} valueType 'INT64' or 'DOUBLE'
 */
async function publishMetric(metricType, value, valueType = 'INT64') {
  if (useMock || !monitoringClient) {
    // Only log occasionally to avoid flooding console in development
    if (Math.random() < 0.05) {
      console.log(`📈 [Telemetry Mock] Published metric: ${metricType} = ${value}`);
    }
    return;
  }

  try {
    const dataPoint = {
      interval: {
        endTime: {
          seconds: Math.floor(Date.now() / 1000),
        },
      },
      value: valueType === 'INT64' ? { int64Value: String(value) } : { doubleValue: Number(value) },
    };

    const timeSeries = {
      metric: {
        type: metricType,
        labels: {
          environment: process.env.NODE_ENV || 'production'
        }
      },
      resource: {
        type: 'global',
        labels: {
          project_id: projectId,
        },
      },
      points: [dataPoint],
    };

    const request = {
      name: monitoringClient.projectPath(projectId),
      timeSeries: [timeSeries],
    };

    await monitoringClient.createTimeSeries(request);
  } catch (err) {
    // Graceful degradation so monitoring failures don't disrupt the core gameplay
    if (Math.random() < 0.05) {
      console.warn('⚠️ [Telemetry] Failed to write TimeSeries to Cloud Monitoring:', err.message);
    }
  }
}

// Public API

export async function recordActivePlayers(count) {
  await publishMetric('custom.googleapis.com/tree/active_players', count, 'INT64');
}

export async function recordTapRate(rate) {
  await publishMetric('custom.googleapis.com/tree/tap_rate', rate, 'DOUBLE');
}

/**
 * Exports a finished round summary to BigQuery for analytical warehousing
 */
export async function exportRoundSummaryToBigQuery(activeRound) {
  try {
    const roundIdStr = String(activeRound.roundId);
    
    // Get total players from Redis ZSET cardinality
    let totalPlayers = 0;
    try {
      totalPlayers = await redis.getClient().zcard(`round:${activeRound.roundId}:scores`);
    } catch (e) {
      console.error('⚠️ [Telemetry] Could not retrieve player card from Redis:', e.message);
    }

    const summaryRecord = {
      round_id: roundIdStr,
      duration_ms: Number(activeRound.durationMs),
      total_players: Number(totalPlayers),
      total_taps: Number(activeRound.totalTaps),
      winner_id: activeRound.winner?.id || null,
      winner_score: activeRound.winner ? Number(activeRound.winner.count) : null,
      timestamp: new Date()
    };

    console.log(`📊 [Telemetry] Exporting round ${roundIdStr} summary to BigQuery...`);
    const bqTable = bigquery.client.dataset('tree_analytics').table('round_summaries');
    await bqTable.insert(summaryRecord);
    console.log(`📊 [Telemetry] Round ${roundIdStr} summary successfully written to BigQuery.`);
  } catch (err) {
    console.error('❌ [Telemetry] BigQuery round summary export failed:', err.message);
  }
}
