# ADR 0001: Application Hosting on Google Cloud Run

## Status

Accepted

## Context

The Tap Race application requires a highly responsive, scalable runtime for handling high-concurrency player taps, long-lived server-sent events (SSE) for leaderboards, and administrative round controls. The monolithic MVP runs as a single in-memory Node.js process, which limits horizontal scalability. We need to select a production hosting platform that supports containerization, rapid autoscaling, and efficient resource allocation.

## Decision

We will host the stateless microservices (Ingestion API, SSE Leaderboard Broadcast Server, and Admin controls) on **Google Cloud Run**.

### Key Configurations:
*   **No CPU Throttling (`--no-cpu-throttling`)**: CPU must remain allocated even when instances are not actively serving HTTP requests to keep background loops (like 100ms game ticks) predictable and fast.
*   **High Concurrency (`--concurrency 1000`)**: Set to accommodate high-concurrency connections on a single container instance.
*   **Long Timeouts (`--timeout 3600`)**: Cloud Run's default timeout is 300s, which is insufficient for the long-lived SSE connections on big screens. We increase this to 1 hour.
*   **Scale Limits (`--min-instances 1 --max-instances 100`)**: Keeps at least 1 instance hot to prevent cold starts during peak load times, and scales dynamically up to 100 instances.

## Consequences

*   **Pros**: Fully managed platform with automatic SSL, custom domains, and direct integration with Google Cloud IAM.
*   **Cons**: Cloud Run service endpoints are stateless, meaning in-memory state cannot be shared across multiple instances. Any state must be externalized to operational databases.
