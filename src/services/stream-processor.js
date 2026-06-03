// Stream Processor — simulates GCP Dataflow stream aggregation
import { pubsub, redis, bigtable } from '../gcp/index.js';
import { getActiveRound, getPlayer } from './db-service.js';

let subscription = null;
let running = false;

export async function startStreamProcessor() {
  if (running) return;
  running = true;
  
  console.log('🌊 [StreamProcessor] Starting streaming data aggregation loop...');
  
  const topicName = 'tap-events-topic';
  const subName = 'tap-events-sub';
  
  // Connect to Pub/Sub subscription
  subscription = pubsub.subscription(subName, { topic: topicName });
  
  subscription.on('message', async (message) => {
    try {
      const data = JSON.parse(message.data.toString());
      const { id, n, timestamp } = data;
      
      if (!id || !n) {
        message.ack();
        return;
      }
      
      const activeRound = await getActiveRound();
      if (activeRound && activeRound.phase === 'running') {
        const roundId = activeRound.roundId;
        
        // 1. Write transactional tap aggregation to MemoryStore Redis Cluster
        const currentCount = await redis.client.zincrby(`round:${roundId}:scores`, n, id);
        const currentTotal = await redis.client.getClient().incrby(`round:${roundId}:totalTaps`, n);
        
        // 2. Stream raw clickstream record to Cloud Bigtable (Column NoSQL)
        try {
          const btTable = bigtable.client.instance('tree-instance').table('clickstream-raw-logs');
          
          // Row Key Design: round_id#player_id#reversed_timestamp
          const reversedTs = String(9999999999999 - (timestamp || Date.now()));
          const rowKey = `${roundId}#${id}#${reversedTs}`;
          
          await btTable.insert({
            key: rowKey,
            data: {
              taps: {
                count: {
                  value: String(n),
                  timestamp: new Date(timestamp || Date.now()),
                },
                player_id: {
                  value: id,
                  timestamp: new Date(timestamp || Date.now()),
                }
              }
            }
          });
        } catch (btErr) {
          // Stream processing must gracefully degrade if Bigtable log audit trails fail
          console.error('⚠️ [StreamProcessor] Failed to stream to Bigtable (audit log degraded):', btErr.message);
        }
      }
      
      // Acknowledge message delivery
      message.ack();
    } catch (err) {
      console.error('❌ [StreamProcessor] Message processing error:', err.message);
      message.nack(); // Redeliver
    }
  });

  console.log('🌊 [StreamProcessor] Active subscription bound, listening for tap spikes...');
}

export async function stopStreamProcessor() {
  if (!running) return;
  running = false;
  if (subscription) {
    await subscription.close().catch(() => {});
  }
  console.log('🌊 [StreamProcessor] Stopped stream aggregation loop.');
}
