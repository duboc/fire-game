# ADR 0004: Decoupled Tap Ingestion Hot-Path via Pub/Sub & Dataflow

## Status

Accepted

## Context

During a live tournament round, hundreds or thousands of players tap their phone screens multiple times per second. Delivering these taps directly to relational or in-memory databases would overwhelm database connection limits and cause request queuing, latency spikes, and eventual dropped taps. We need an asynchronous ingestion mechanism that decouples API request handling from database processing.

## Decision

We will decouple the tap ingestion hot path using **Google Cloud Pub/Sub** and **Google Cloud Dataflow (Apache Beam)**.

### Hot Path Flow:
1.  **Ingestion Service**: The Cloud Run API receives a `/tap` batch, validates the request, and immediately publishes a JSON event payload to the `tap-events-topic` Cloud Pub/Sub topic, responding with HTTP `202 Accepted` or `200 OK` to the player.
2.  **Stream Aggregations (Dataflow)**: A Cloud Dataflow streaming job subscribes to the Pub/Sub topic, processes the stream in real-time using small sliding sliding windows (e.g., 100ms), and applies aggregated scores directly into **MemoryStore Redis** (via `ZINCRBY`).
3.  **Auditing (Cloud Bigtable)**: The same Dataflow job simultaneously pipes the raw, granular tap events to **Cloud Bigtable** for persistent, high-throughput audit logging.

## Consequences

*   **Pros**: Complete isolation of the API ingestion tier. Latency is minimized and remains predictable. Spikes are absorbed by Pub/Sub buffers, preventing database bottlenecks.
*   **Cons**: Increases the number of active GCP resources, leading to higher baseline resource costs and operational footprint.
