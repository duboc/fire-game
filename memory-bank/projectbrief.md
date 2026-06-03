# Project Brief — Tap Race: Enterprise Edition (TREE)

## Core Requirements (Inherited from Tap Race)
1. **Self-Service Join**: Players scan a QR code on a big screen to join the lobby instantly. No login or name typing.
2. **Auto-Generated Identity**: System assigns unique identifiers (Adjective + Animal + Sequence ID, e.g., `🐧 Pinguim Furioso #142`) to prevent moderation issues.
3. **Mass Tapping**: 30–60 second rounds of tapping a giant button on mobile screens.
4. **Real-time Positions**: Phones show the user's current rank (e.g., `#47 of 300`) real-time.
5. **Leaderboard Climax**: The big screen displays the real-time leaderboard (top 10) updating fluidly with FLIP animations, culminating in confetti for the winner.
6. **Robustness**: Immune to network interruptions or server crashes (self-healing connections).

---

## Overengineering Goals for the 1-Hour Challenge
The objective of this challenge is to **maximize the count and integration of GCP services** to overengineer a simple local in-memory game into an enterprise-grade cloud system. We will replace the single-node architecture with a decoupled, planet-scale web system.

### Key Targets:
- **Zero In-Memory Storage on APIs**: Split the single Express monolithic API into stateless microservices.
- **Asynchronous Hot Path**: Remove real-time database locks. Tap ingestion must be fully decoupled via messaging queues.
- **Microsecond In-Memory Ranks**: Move ranking computation off the web service into a real-time stream aggregation engine updating an in-memory cluster.
- **Enterprise Storage Tiering**: Split storage into transient real-time states (MemoryStore), historical auditable log streams (Bigtable), permanent system of record (Cloud Spanner), and analytic warehouses (BigQuery).
- **ML Integration**: Real-time AI-based click fraud detection to flag botting patterns.
- **Global Ingress & Edge Caching**: Route all traffic through global load balancing, edge CDN, and API gateways.
