# Progress Tracker — Tap Race: Enterprise Edition (TREE)

## Completed Features (Monolithic MVP)
- [x] **Adjective + Animal Name Generation**: Fast unique profile generation (`src/names.js`) with emoji support.
- [x] **In-Memory Game State Machine**: State transitions (`src/game.js`), tie handling, counting, and rankings.
- [x] **Endpoints & SSE Streaming**: Real-time updates streamed via `text/event-stream` to the big screen, REST API endpoints (`/join`, `/tap`, `/state`, `/admin/*`).
- [x] **Static Visual Pages**:
  - `index.html` (Mobile UI) with tap optimizations and local optimistic feedback.
  - `screen.html` (Big Screen UI) with SSE listening and smooth animation transitions.
  - `host.html` (Admin panel) to control rounds.
- [x] **Basic Persistence**: Optional POST-round Firestore sync (`src/persist.js`).
- [x] **Unit Testing Suite**: Validates identity generation, game state rules, tick timing, and reset mechanisms (`test/*.test.js`).

---

## 🏗️ Remaining Work (GCP Overengineering Target)

### Phase 1: Local Infrastructure Emulators
- [x] Write a `docker-compose.emulator.yml` file to initialize:
  - Google Pub/Sub emulator.
  - Google Cloud Spanner emulator.
  - Google Cloud Bigtable emulator.
  - Local Redis.
- [x] Create helper setup script (`emulators-init.sh`) to pre-create Spanner schemas, Pub/Sub topics, and Redis configurations.

### Phase 2: Microservice Split & API Refactoring
- [x] **State-Free Ingestion API**:
  - Refactor `/tap` endpoint to publish raw tap events to Pub/Sub.
  - Refactor `/join` to record identities inside Cloud Spanner and return values.
- [x] **Stream Aggregate Pipeline (Dataflow Mock / Implementation)**:
  - Consume Pub/Sub tap streams, accumulate totals, update MemoryStore Redis ZSET tables, and stream logs to Cloud Bigtable.
- [x] **SSE Leaderboard Streamer**:
  - Subscribe to Redis Pub/Sub topics, fetch Leaderboard ranges, and broadcast them as Server-Sent Events to the big screen.

### Phase 3: Enterprise Logging, Operations & AI
- [x] **Vertex AI Anti-Cheat sidecar**:
  - Interface dynamic tap streams with Vertex AI endpoints for anomaly detection.
- [x] **Round Closure Cloud Task**:
  - Transition round phases securely via Cloud Tasks timers (integrated in State Machine).
- [x] **Winner Certificate Cloud Run Job**:
  - Automatically output high-resolution victory PDFs to Cloud Storage (orchestrated asynchronously).
- [x] **Looker Studio Dashboard & BigQuery integration**:
  - Direct clickstream logs and round-level summary results to BigQuery for tournament telemetry.
- [ ] **Terraform Infrastructure-as-Code Setup**:
  - Configure resource definitions for GKE, Spanner, Redis, Pub/Sub, and Armor rules.
- [x] **Gemini Live Voice-to-Tap Accessibility**:
  - Implement dynamic phonetic syllable-to-tap stream translation via Web Speech API and WebSocket client connections ([PRD-001](file:///home/admin_renanvn_altostrat_com/projects/GitHub/fire-game/docs/backlog/PRD-001-gemini-live-accessibility-tapping.md)).

### Phase 4: CI/CD & Deployment Automation
- [x] Create GitHub Actions workflow (`.github/workflows/deploy.yml`) to run tests and deploy to Cloud Run automatically.
- [x] Document hosting and operational database architecture mapping.
- [x] Provision production Pub/Sub and Bigtable infrastructure in `project-pt-internal`:
  - [x] Create and verify Pub/Sub topic `tap-events-topic` & subscription `tap-events-sub`.
  - [x] Create and verify Bigtable instance `tree-instance` & table `clickstream-raw-logs` with column family `taps`.


---

## ☁️ Production Cloud Provisioning Status
- [x] **Cloud Spanner Instance (`tree-instance`)**: Provisioned in `project-pt-internal` under regional config `us-central1` (100 PU).
- [x] **Cloud Spanner Database (`tree-db`)**: Created with production schemas for `Players` and `Rounds`.
- [x] **Cloud Memorystore Redis Instance (`tree-redis`)**: Provisioned in `project-pt-internal` under region `us-central1` (1GB size, connected to custom `dev-vpc` network, host IP: `10.55.110.131`).
- [x] **Cloud Run Service Deployment (`tap-race`)**: Successfully deployed to production on Cloud Run using direct VPC egress (peered to `dev-vpc` network and `dev-subnet` subnet) with live GCP client integrations. Fixed 500 error on /admin/start and /admin/reset by resolving Redis client method signature mismatches and configuring environment variables (GCP_PROJECT_ID, REDIS_HOST).




