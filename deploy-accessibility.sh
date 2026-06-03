#!/usr/bin/env bash
# Deploy Tap Race Accessibility Microservice to Cloud Run.
#
# Usage:
#   PROJECT=project-pt-internal REGION=us-central1 ./deploy-accessibility.sh
set -euo pipefail

PROJECT="${PROJECT:-project-pt-internal}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-tap-race-accessibility}"

echo "Deploying ${SERVICE} to ${PROJECT}/${REGION}..."

# We deploy using the root source, overriding the container command to run the accessibility server.
gcloud run deploy "${SERVICE}" \
  --project "${PROJECT}" \
  --region "${REGION}" \
  --source . \
  --command "node" \
  --args "src/accessibility/server.js" \
  --allow-unauthenticated \
  --min-instances 1 \
  --max-instances 10 \
  --concurrency 500 \
  --cpu 1 \
  --memory 512Mi \
  --timeout 600 \
  --port 8081 \
  --set-env-vars "NODE_ENV=production,USE_MOCKS=true" \
  --quiet

echo
echo "Done. Service successfully deployed!"
URL="$(gcloud run services describe "${SERVICE}" --project "${PROJECT}" --region "${REGION}" --format='value(status.url)')"
echo "  Service URL      : ${URL}"
echo "  Token Endpoint   : ${URL}/auth/gemini-live"
echo "  Vocal Tap Ingest : ${URL}/vocal-tap"
echo "  Mock WS Stream   : ${URL}/voice-stream/mock"
