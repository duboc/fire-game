# ADR 0003: Automated CI/CD Pipeline via GitHub Actions

## Status

Accepted

## Context

Deployment of microservices must be automated, repeatable, and secure. We need to prevent regressions in production by validating the codebase using unit tests before deploying. Furthermore, production deployments should avoid relying on long-lived, static credentials (such as service account JSON keys) which pose security risks if compromised.

## Decision

We will implement an automated CI/CD pipeline using **GitHub Actions** [.github/workflows/deploy.yml](../../.github/workflows/deploy.yml).

### Flow Architecture:
1.  **Run Tests (On push / Pull Requests)**:
    *   Triggers on branches `main` and `renanvn`.
    *   Fires up a Node.js 20 runner, executes a clean install (`npm ci`), and runs `npm test`.
2.  **Deploy (On push to `main` only)**:
    *   Retrieves dynamic access tokens using **Workload Identity Federation (WIF)**.
    *   Sets up the `gcloud` SDK CLI environment.
    *   Executes `gcloud run deploy` to build and roll out the container to Cloud Run.

## Consequences

*   **Pros**: Guaranteeing that broken code never reaches production. Leverages keyless OIDC authentication via Workload Identity Federation (no static secrets to manage or leak).
*   **Cons**: Requires repository administrators to perform one-time WIF provider provisioning in Google Cloud.
