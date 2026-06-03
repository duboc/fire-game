#!/usr/bin/env bash
# Deploy Tap Race to Cloud Run as a SINGLE pinned instance.
#
# Why these flags matter (this is the whole game's correctness, not tuning):
#   --min-instances 1 --max-instances 1  -> exactly ONE in-memory counter.
#        If Cloud Run ever opened a 2nd instance, you'd get two disconnected
#        Map<player,count> and the leaderboard would jump/regress on screen.
#   --concurrency 1000                   -> one instance comfortably absorbs
#        300 players * ~5 taps/s; high concurrency keeps it to a single box.
#   --no-cpu-throttling                  -> CPU stays allocated between requests
#        so the 100ms tick/broadcast loop never stalls during idle moments.
#   --timeout 3600                       -> the big screen's SSE stream is a long
#        lived response; don't let the default 300s cut it mid-session.
#
# Usage:
#   PROJECT=my-gcp-project REGION=us-central1 ADMIN_TOKEN=supersecret ./deploy.sh
set -euo pipefail

PROJECT="${PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-tap-race}"
ADMIN_TOKEN="${ADMIN_TOKEN:-$(openssl rand -hex 8 2>/dev/null || echo changeme)}"

if [[ -z "${PROJECT}" || "${PROJECT}" == "(unset)" ]]; then
  echo "Set PROJECT=your-gcp-project (or run: gcloud config set project ...)" >&2
  exit 1
fi

echo "Deploying ${SERVICE} to ${PROJECT}/${REGION}"
echo "Admin token: ${ADMIN_TOKEN}   (host panel: <url>/host)"

gcloud run deploy "${SERVICE}" \
  --project "${PROJECT}" \
  --region "${REGION}" \
  --source . \
  --allow-unauthenticated \
  --min-instances 1 \
  --max-instances 1 \
  --concurrency 1000 \
  --cpu 1 \
  --memory 512Mi \
  --no-cpu-throttling \
  --timeout 3600 \
  --port 8080 \
  --set-env-vars "ADMIN_TOKEN=${ADMIN_TOKEN},PERSIST=${PERSIST:-off}"

echo
echo "Done. URLs:"
URL="$(gcloud run services describe "${SERVICE}" --project "${PROJECT}" --region "${REGION}" --format='value(status.url)')"
echo "  Players : ${URL}/"
echo "  Screen  : ${URL}/screen"
echo "  Host    : ${URL}/host   (token: ${ADMIN_TOKEN})"
