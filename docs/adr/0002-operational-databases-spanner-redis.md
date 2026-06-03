# ADR 0002: Operational Databases - Cloud Spanner & MemoryStore for Redis

## Status

Accepted

## Context

The system must handle a high-volume hot path (mass-tapping during active rounds) and a strictly transactional cold path (round metadata, state transitions, winner commitments, and user identities). Relational and document databases cannot absorb tens of thousands of write/update requests per second without locking tables or hitting request limit bottlenecks.

## Decision

We will decouple state storage into two highly specialized tiers:

1.  **Transient Hot-Path State: Cloud MemoryStore for Redis (Cluster Mode)**
    *   **Purpose**: Real-time score accumulation and ranking.
    *   **Data Structure**: Redis Sorted Sets (`ZSET`).
    *   **Rationale**: Redis operates in-memory and supports `O(1)` score increments (`ZINCRBY`) and `O(log N)` range-based ranking query retrieval, which easily absorbs millions of taps and updates SSE subscribers in microsecond range.

2.  **Relational System of Record: Cloud Spanner**
    *   **Purpose**: Relational entities (`Rounds`, `OfficialWinners`, and player metadata from `/join`).
    *   **Rationale**: Cloud Spanner is a highly scalable, multi-region database that provides strict serializable consistency. This guarantees that critical state transitions (such as starting or ending a round) and winner declarations are protected from split-brain scenarios and write conflicts.

## Consequences

*   **Pros**: Complete separation of concerns. Ingestion never blocks on relational transactions, and live standings remain resilient to server restarts.
*   **Cons**: Introduces eventual consistency between the live ranking in Redis and the finalized winner commitment in Cloud Spanner. The post-round pipeline must reconcile these states carefully.
