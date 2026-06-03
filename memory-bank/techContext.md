# Technical Context — Tap Race: Enterprise Edition (TREE)

## Core Stack & Dependencies
- **Runtime**: Node.js (ESM, version 20+)
- **API Framework**: Express
- **Asset Storage**: Google Cloud Storage (GCS)
- **Cache / Real-time States**: Cloud MemoryStore (Redis v7+)
- **Data Ingestion**: Cloud Pub/Sub
- **Streaming Aggregation**: Cloud Dataflow (Apache Beam SDK for JavaScript / Python)
- **Databases**:
  - Relational: Cloud Spanner (using `@google-cloud/spanner`)
  - NoSQL / Auditing: Cloud Bigtable (using `@google-cloud/bigtable`)
  - Analytics: Cloud BigQuery (using `@google-cloud/bigquery`)
- **Gateway & Authentication**: Apigee API Gateway
- **Infrastructure Provisioning**: Terraform (GCP Provider v5.0+)

---

## 🛠️ Local Development & Emulators
To build and test this overengineered system locally without incurring GCP costs, developers and agents must use the local Google Cloud SDK emulators:

### 1. Spanner Emulator
```bash
gcloud beta emulators spanner start
export SPANNER_EMULATOR_HOST="localhost:9010"
```

### 2. Pub/Sub Emulator
```bash
gcloud beta emulators pubsub start --host-port="localhost:8085"
export PUBSUB_EMULATOR_HOST="localhost:8085"
```

### 3. Bigtable Emulator
```bash
gcloud beta emulators bigtable start --host-port="localhost:8086"
export BIGTABLE_EMULATOR_HOST="localhost:8086"
```

### 4. Local Redis (Docker)
```bash
docker run --name local-redis -p 6379:6379 -d redis:7-alpine
export REDIS_HOST="localhost"
export REDIS_PORT="6379"
```

---

## ⚙️ Environment Variables
Each microservice has specific configuration mappings:

| Service | Variable | Purpose |
|---|---|---|
| **All Services** | `GCP_PROJECT_ID` | Identifies the project |
| **All Services** | `NODE_ENV` | Environment context (`development` / `production`) |
| **Ingestion API** | `PUBSUB_TOPIC` | Target Pub/Sub topic name for tap ingestion |
| **Ingestion API** | `SPANNER_INSTANCE` | Cloud Spanner instance ID |
| **Ingestion API** | `SPANNER_DATABASE` | Cloud Spanner database ID |
| **SSE Streamer** | `REDIS_URL` | MemoryStore Redis Cluster endpoint |
| **SSE Streamer** | `FIREBASE_DB_URL` | Target Realtime DB (optional) |
| **Dataflow Job** | `BIGTABLE_INSTANCE` | Bigtable instance ID |
| **Dataflow Job** | `BIGTABLE_TABLE` | Target Bigtable table for clickstream logs |
| **Admin Service** | `ADMIN_TOKEN` | Required for admin execution (refuses 'dev' in prod) |

---

## ⚠️ Key Constraints
1. **No Hot-Path Locks**: Never block HTTP threads during `/tap` ingestion. Writes must remain in Pub/Sub & Redis.
2. **Cold-path Firestore/Spanner Only**: Relational commits are strictly limited to player enrollment (`/join`) and round configuration triggers.
3. **Graceful Degradation**: If Bigtable or BigQuery is offline, the game must continue executing without dropping player ranks.
4. **Cloud Run Pinned to Scale**: Unlike the monolithic setup (`max-instances 1`), the ingestion endpoints here are completely stateless and should scale freely (`max-instances 100`).
5. **Safe CLI Operations**: Consult [skills/gcloud.md](file:///home/admin_renanvn_altostrat_com/projects/GitHub/fire-game/skills/gcloud.md) before invoking `gcloud` commands to ensure non-interactive options and data projection are applied.
6. **Application Serving**: Use [skills/cloud-run-basics.md](file:///home/admin_renanvn_altostrat_com/projects/GitHub/fire-game/skills/cloud-run-basics.md) for deploying dynamic microservices and asynchronous jobs.
7. **Relational Database Management**: Consult [skills/cloud-sql-basics.md](file:///home/admin_renanvn_altostrat_com/projects/GitHub/fire-game/skills/cloud-sql-basics.md) and [skills/alloydb-basics.md](file:///home/admin_renanvn_altostrat_com/projects/GitHub/fire-game/skills/alloydb-basics.md) for transactional backend setup.
8. **Real-time Database Ingestion**: Use [skills/firebase-basics.md](file:///home/admin_renanvn_altostrat_com/projects/GitHub/fire-game/skills/firebase-basics.md) to manage real-time synchronization pipelines for screens and mobile clients.
9. **Data Warehouse Analytics**: Use [skills/bigquery-basics.md](file:///home/admin_renanvn_altostrat_com/projects/GitHub/fire-game/skills/bigquery-basics.md) for reporting tournament data.
10. **Kubernetes Cluster Deployments**: Consult [skills/gke-basics.md](file:///home/admin_renanvn_altostrat_com/projects/GitHub/fire-game/skills/gke-basics.md) for GKE container deployments.
11. **Telemetry & Observability**: Consult [skills/google-cloud-networking-observability.md](file:///home/admin_renanvn_altostrat_com/projects/GitHub/fire-game/skills/google-cloud-networking-observability.md) for monitoring and log management.
12. **GCP Resource Access & Security Policies**: Use [skills/google-cloud-recipe-auth.md](file:///home/admin_renanvn_altostrat_com/projects/GitHub/fire-game/skills/google-cloud-recipe-auth.md) and [skills/google-cloud-waf-security.md](file:///home/admin_renanvn_altostrat_com/projects/GitHub/fire-game/skills/google-cloud-waf-security.md) for authentication configurations, service accounts, and load balancer firewall constraints.


