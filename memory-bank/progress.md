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
- [ ] Write a `docker-compose.emulator.yml` file to initialize:
  - Google Pub/Sub emulator.
  - Google Cloud Spanner emulator.
  - Google Cloud Bigtable emulator.
  - Local Redis.
- [ ] Create helper setup script (`emulators-init.sh`) to pre-create Spanner schemas, Pub/Sub topics, and Redis configurations.

### Phase 2: Microservice Split & API Refactoring
- [ ] **State-Free Ingestion API**:
  - Refactor `/tap` endpoint to publish raw tap events to Pub/Sub.
  - Refactor `/join` to record identities inside Cloud Spanner and return values.
- [ ] **Stream Aggregate Pipeline (Dataflow Mock / Implementation)**:
  - Consume Pub/Sub tap streams, accumulate totals, update MemoryStore Redis ZSET tables, and stream logs to Cloud Bigtable.
- [ ] **SSE Leaderboard Streamer**:
  - Subscribe to Redis Pub/Sub topics, fetch Leaderboard ranges, and broadcast them as Server-Sent Events to the big screen.

### Phase 3: Enterprise Logging, Operations & AI
- [ ] **Vertex AI Anti-Cheat sidecar**:
  - Interface dynamic tap streams with Vertex AI endpoints for anomaly detection.
- [ ] **Round Closure Cloud Task**:
  - Transition round phases securely via Cloud Tasks timers.
- [ ] **Winner Certificate Cloud Run Job**:
  - Automatically output high-resolution victory PDFs to Cloud Storage.
- [ ] **Looker Studio Dashboard & BigQuery integration**:
  - Direct logs to BigQuery for tournament telemetry.
- [ ] **Terraform Infrastructure-as-Code Setup**:
  - Configure resource definitions for GKE, Spanner, Redis, Pub/Sub, and Armor rules.

### Phase 4: CI/CD & Deployment Automation
- [x] Create GitHub Actions workflow (`.github/workflows/deploy.yml`) to run tests and deploy to Cloud Run automatically.
- [x] Document hosting and operational database architecture mapping.

