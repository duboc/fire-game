# Active Context — Tap Race: Enterprise Edition (TREE)

## Current Focus
We are converting the monolithic, single-instance local Tap Race game into a highly overengineered multi-service GCP architecture. The goal is to maximize the utilization of GCP resources (API Gateways, queues, streams, distributed databases, machine learning, tasks, storage, and visualization) in a Software Design Document (SDD) style.

---

## 🚀 Recent Changes
- Initialized the multi-agent workflow file [AGENTS.md](file:///home/admin_renanvn_altostrat_com/projects/GitHub/fire-game/AGENTS.md).
- Created the core **Memory Bank** structure under `memory-bank/` ([projectbrief.md](file:///home/admin_renanvn_altostrat_com/projects/GitHub/fire-game/memory-bank/projectbrief.md), [productContext.md](file:///home/admin_renanvn_altostrat_com/projects/GitHub/fire-game/memory-bank/productContext.md), [systemPatterns.md](file:///home/admin_renanvn_altostrat_com/projects/GitHub/fire-game/memory-bank/systemPatterns.md), [techContext.md](file:///home/admin_renanvn_altostrat_com/projects/GitHub/fire-game/memory-bank/techContext.md)).
- Configured GitHub Actions CI/CD pipeline ([deploy.yml](file:///home/admin_renanvn_altostrat_com/projects/GitHub/fire-game/.github/workflows/deploy.yml)) to run tests and deploy to Cloud Run automatically.
- Documented deployment architecture, hosting decisions, and database strategies in [deployment_walkthrough.md](file:///home/admin_renanvn_altostrat_com/.gemini/antigravity-cli/brain/27854825-3611-4e82-b3e1-163837de7baf/deployment_walkthrough.md).
- Implemented and published official Architecture Decision Records (ADRs) under [docs/adr/README.md](file:///home/admin_renanvn_altostrat_com/projects/GitHub/fire-game/docs/adr/README.md).
- Finalized and integrated state-free microservices wrappers (Spanner, Redis, Pub/Sub, Bigtable) with fallback local modes and official integration test coverage (`test/gcp.test.js`).
- Committed and pushed all local modifications and scaffolded files directly to the `main` and `renanvn` branches on the user's remote fork (`https://github.com/nansravn/fire-game`).

---

## ⚡ Active Architectural Decisions
1. **Pub/Sub buffering**: `/tap` endpoints will write directly to Pub/Sub. This guarantees that API nodes can process inputs at high velocity without clogging database connections.
2. **Cloud MemoryStore (Redis)**: Redis will act as the single source of truth for dynamic, live leaderboards during active gameplay. Since it's in-memory, lookup query speeds are minimal.
3. **Spanner for Admin Actions**: To protect round-state transitions (e.g. going from `COUNTDOWN` to `RUNNING`), Spanner's strict serializable isolation level is selected.
4. **Vertex AI Sidecar**: The API service will perform a light gRPC call to Vertex AI to run anomaly detection models on the tap frequencies of players.
5. **Cloud Run Hosting & Split Deployments**: The application services will run on Google Cloud Run, optimizing for scalability, zero cold starts (pinned settings for hot loops), and quick deployments.
6. **Keyless Authentication**: Production deployments via GitHub Actions will leverage Workload Identity Federation (WIF) instead of static service account key files.

---

## 📋 Next Steps
1. **Looker Studio Dashboard & BigQuery Integration**: Direct logs to BigQuery for tournament analytical telemetry and aggregate visualizations.
2. **Terraform Infrastructure-as-Code Setup**: Configure resource definitions for GKE, Spanner, Redis, Pub/Sub, Cloud Run, and Cloud Armor WAF rules to standardize production environments.

