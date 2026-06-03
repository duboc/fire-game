# Active Context — Tap Race: Enterprise Edition (TREE)

## Current Focus
We are converting the monolithic, single-instance local Tap Race game into a highly overengineered multi-service GCP architecture. The goal is to maximize the utilization of GCP resources (API Gateways, queues, streams, distributed databases, machine learning, tasks, storage, and visualization) in a Software Design Document (SDD) style.

---

## 🚀 Recent Changes
- Initialized the multi-agent workflow file [AGENTS.md](file:///home/admin_renanvn_altostrat_com/projects/GitHub/fire-game/AGENTS.md).
- Created the core **Memory Bank** structure under `memory-bank/` ([projectbrief.md](file:///home/admin_renanvn_altostrat_com/projects/GitHub/fire-game/memory-bank/projectbrief.md), [productContext.md](file:///home/admin_renanvn_altostrat_com/projects/GitHub/fire-game/memory-bank/productContext.md), [systemPatterns.md](file:///home/admin_renanvn_altostrat_com/projects/GitHub/fire-game/memory-bank/systemPatterns.md), [techContext.md](file:///home/admin_renanvn_altostrat_com/projects/GitHub/fire-game/memory-bank/techContext.md)).
- Evaluated the existing single-file codebase (`src/server.js`, `src/game.js`, `src/persist.js`).

---

## ⚡ Active Architectural Decisions
1. **Pub/Sub buffering**: `/tap` endpoints will write directly to Pub/Sub. This guarantees that API nodes can process inputs at high velocity without clogging database connections.
2. **Cloud MemoryStore (Redis)**: Redis will act as the single source of truth for dynamic, live leaderboards during active gameplay. Since it's in-memory, lookup query speeds are minimal.
3. **Spanner for Admin Actions**: To protect round-state transitions (e.g. going from `COUNTDOWN` to `RUNNING`), Spanner's strict serializable isolation level is selected.
4. **Vertex AI Sidecar**: The API service will perform a light gRPC call to Vertex AI to run anomaly detection models on the tap frequencies of players.

---

## 📋 Next Steps
1. **Scaffold Local Emulators**: Write docker-compose configuration or scripts to spin up Spanner, Pub/Sub, Bigtable, and Redis emulators.
2. **Refactor Ingestion API**:
   - Extract the state-holding parts of `src/game.js`.
   - Update `src/server.js` (or create `src/ingest-server.js`) to publish tap requests directly to Pub/Sub.
3. **Implement Stream Processor**:
   - Create `src/stream-processor.js` (simulating Dataflow behavior locally or using GCP clients) that aggregates Pub/Sub messages and pipes them to Redis.
4. **Implement SSE Broadcast Service**:
   - Create `src/broadcast-server.js` which handles the long-lived screen connections, subscribing to Redis updates.
