# System Patterns — Tap Race: Enterprise Edition (TREE)

## Core Architecture Design
To transition from the monolithic design to a highly resilient distributed system, we adopt an **Event-Driven CQRS (Command Query Responsibility Segregation)** pattern. Detailed design choices are recorded in our [Architecture Decision Records (ADRs)](file:///home/admin_renanvn_altostrat_com/projects/GitHub/fire-game/docs/adr/README.md):

- **Write Path (Command)**: Client Taps -> Load Balancer -> Apigee -> Cloud Run Ingest -> Pub/Sub -> Dataflow. *(See [ADR 0004](file:///home/admin_renanvn_altostrat_com/projects/GitHub/fire-game/docs/adr/0004-decoupled-tap-ingestion-pubsub-dataflow.md))*
- **Read Path (Query)**: Client / Screen -> Load Balancer -> Firebase Realtime DB / Redis -> Client SSE. *(See [ADR 0001](file:///home/admin_renanvn_altostrat_com/projects/GitHub/fire-game/docs/adr/0001-hosting-on-cloud-run.md))*
- **System of Record**: Cloud Spanner (Transactional states, metadata, rounds, admin actions). *(See [ADR 0002](file:///home/admin_renanvn_altostrat_com/projects/GitHub/fire-game/docs/adr/0002-operational-databases-spanner-redis.md))*


---

## 🛠️ GCP Service Component Breakdown

### 1. Ingress & Gateways
- **Cloud Load Balancing (GLB)**: Distributes global HTTPS requests. Integrates with **Cloud Armor** to apply Web Application Firewall (WAF) rules, prevent DDoS attacks, and implement rate limits per player IP.
- **Cloud Storage (GCS) + Cloud CDN**: Serves pre-compiled static files (`index.html`, `screen.html`, `host.html`) globally from the nearest edge.
- **Apigee API Gateway**: Inspects incoming API headers, validates token signatures, enforces request-level schemas, and handles API keys for developer analytics.

### 2. Ingestion Tier (Stateless APIs)
- **Cloud Run (Ingest Service)**: A highly-scaled Node.js or Go microservice.
  - `/join`: Connects to **Cloud Spanner** to write a new player registration and pulls an auto-generated identity from a shared name-generator module.
  - `/tap`: Accepts client-side batched taps. Instead of recording them to databases directly, it validates payload schema, checks with **Vertex AI** for cheat detection, and publishes a JSON event payload to Cloud Pub/Sub.

### 3. Real-Time Stream Processor
- **Cloud Pub/Sub (`tap-events-topic`)**: Buffer layer that absorbs sudden spikes in taps without throttling the APIs.
- **Cloud Dataflow (Apache Beam)**: A streaming aggregation job.
  - Reads tap events in real-time.
  - Applies a 100ms sliding window.
  - Increments scores in **MemoryStore for Redis** via `ZINCRBY`.
  - Publishes aggregated leaderboard updates.
  - Writes raw tap records (timestamp, player UUID, count) to **Cloud Bigtable** for audit logging.

### 4. Storage & State Databases
- **MemoryStore for Redis (Cluster Mode)**:
  - Stores dynamic game session scores in a Sorted Set (ZSET).
  - Enables O(1) retrieval of single player ranks and O(log N) updates.
  - Enables the SSE microservice to subscribe to channel updates.
- **Cloud Spanner**:
  - Multi-region relational database.
  - Houses schema tables: `Rounds` (id, status, duration, start_time, end_time) and `OfficialWinners` (round_id, player_id, score).
  - Handles administrative transactions (e.g. Host clicking "INICIAR" triggers a transaction updating `Rounds` status).
- **Cloud Bigtable**:
  - Column-family NoSQL database.
  - Handles extreme write throughput for storing every single tap event received.
  - Row Key Design: `round_id#player_id#reversed_timestamp` to optimize scanning tap histories.
- **Cloud BigQuery**:
  - Collects events from Pub/Sub via direct BigQuery subscription.
  - Runs analytical aggregations for Looker Studio visualization.

### 5. Control & Async Triggers
- **Cloud Tasks**: Managed queue for executing tasks asynchronously with delay (e.g., executing a callback to close a round after `DURATION_MS` expires).
- **Cloud Run Jobs**: Spawned once at round-end. Pulls data from Spanner, compiles HTML, uses Puppeteer to render a high-quality PDF certificate of victory, and writes the PDF file to a GCS Bucket.

---

## ⚡ Critical Communication Paths

### The Tap Processing Loop
```
[Client Phone] --(HTTP POST /tap)--> [GLB/Apigee]
                                            |
                                  [Cloud Run Ingest API]
                                            |
                                  [Vertex AI Fraud Filter]
                                            |
                                 [Pub/Sub: tap-events]
                                            |
                                  [Dataflow Stream Job]
                                    /                 \
                                   /                   \
        [MemoryStore Redis: ZINCRBY]               [Cloud Bigtable: RAW LOG]
                    |
      [Cloud Run: Broadcast SSE]
                    |
             [Client Screen]
```

### The Round Lifecycle Flow
1. **Lobby / Countdown Phase**:
   - Host clicks `/admin/start`.
   - Admin service writes `RUNNING` status to Cloud Spanner and Schedules a Cloud Task to trigger after `durationMs`.
   - Status updates are published to Redis Pub/Sub, notifying SSE stream listeners (Screen & Phones transition).
2. **Running Phase**:
   - Tap Loop executes (described above).
3. **Ended Phase**:
   - Cloud Task fires, invoking the `/admin/end` endpoint.
   - Admin service updates Spanner to `ENDED`.
   - Dataflow aggregates final counts, commits final leaderboard snapshot to Spanner, and shuts down ingestion for that round.
   - Cloud Run Job starts to generate the victory PDF.
