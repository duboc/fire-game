// GCP Services Coordinator for TREE
import { PubSubClient } from './pubsub.js';
import { SpannerClient } from './spanner.js';
import { BigtableClient } from './bigtable.js';
import { RedisClient } from './redis.js';
import { BigQueryClient } from './bigquery.js';

export const pubsub = new PubSubClient();
export const spanner = new SpannerClient();
export const bigtable = new BigtableClient();
export const redis = new RedisClient();
export const bigquery = new BigQueryClient();

let initialized = false;

export async function initGcpServices() {
  if (initialized) return;
  
  console.log('🌴 TREE: Initializing Distributed GCP Services Integration Layer...');
  
  await pubsub.init();
  await spanner.init();
  await bigtable.init();
  await redis.init();
  await bigquery.init();
  
  initialized = true;
  console.log('🌴 TREE: All GCP Services successfully initialized.');
}

