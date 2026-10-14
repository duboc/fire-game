#!/usr/bin/env bash
# Deploy to Cloud Run as a SINGLE pinned instance (default: the vote-only `live-vote` service).
#
# Why these flags matter (this is the whole game's correctness, not tuning):
#   --min-instances 1 --max-instances 1  -> exactly ONE in-memory counter.
#        If Cloud Run ever opened a 2nd instance, you'd get two disconnected
#        Map<player,count> and the leaderboard would jump/regress on screen.
#   --concurrency 1000                   -> the platform maximum, and a hard
#        ceiling we design against: phones must never hold a socket. See
#        docs/SCALE.md finding 4 before "upgrading" anything to WebSockets.
#   --no-cpu-throttling                  -> CPU stays allocated between requests
#        so the 100ms tick/broadcast loop never stalls during idle moments.
#   --cpu 2                              -> Node is single-threaded and cannot
#        turn the 2nd core into throughput (measured +13% at best), but it takes
#        GC and TLS off the critical path: p99 90ms -> 70ms at 5.000 players.
#   --timeout 3600                       -> the big screen's SSE stream is a long
#        lived response; don't let the default 300s cut it mid-session.
#
# Usage:
#   ./deploy.sh                                   # live-vote (vote app only), riojucu / us-central1
#   SERVICE=tap-race APPS=all ./deploy.sh         # the original all-games service
#   PROJECT=other-project REGION=europe-west1 ./deploy.sh
#
# The host password is NOT deployed. Only a scrypt hash of it is compiled into
# src/server.js, so there is no secret to plumb through here. Note that
# --env-vars-file replaces the whole env: deploying with this script therefore
# also *removes* any ADMIN_TOKEN a previous deploy left behind, which is what
# we want — an ADMIN_TOKEN on the service silently disables the password.
set -euo pipefail

# The live service lives in `riojucu`. Defaulting to `gcloud config get-value
# project` instead was a foot-gun: whatever project the laptop happens to be
# pointed at is almost never this one, and a wrong default deploys a second
# copy of the game somewhere nobody is looking. An explicit PROJECT= still wins.
PROJECT="${PROJECT:-riojucu}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-live-vote}"
# APPS=vote serves Live Vote alone (/ redirects to /vote; every Tap Race and
# Sequência route is a 404). APPS=all serves every app, as tap-race does.
APPS="${APPS:-vote}"

if [[ -z "${PROJECT}" || "${PROJECT}" == "(unset)" ]]; then
  echo "Set PROJECT=your-gcp-project (or run: gcloud config set project ...)" >&2
  exit 1
fi

# Don't let an exported dev/test token look like it is being shipped.
if [[ -n "${ADMIN_TOKEN:-}" ]]; then
  echo "WARNING: ADMIN_TOKEN is set in your shell but will NOT be deployed." >&2
  echo "         The service uses the built-in password (see README, Admin access)." >&2
fi

echo "Deploying ${SERVICE} (APPS=${APPS}) to ${PROJECT}/${REGION}"
echo "Admin auth: built-in password"

# The service env, as a file: it carries the private name list (vote-names.txt,
# git-ignored) as VOTE_NAMES, validated before anything is built.
ENV_FILE="$(mktemp)"
trap 'rm -f "${ENV_FILE}"' EXIT
PERSIST="${PERSIST:-off}" APPS="${APPS}" node scripts/deploy-env.mjs "${ENV_FILE}"

gcloud run deploy "${SERVICE}" \
  --project "${PROJECT}" \
  --region "${REGION}" \
  --source . \
  --allow-unauthenticated \
  --min-instances 1 \
  --max-instances 1 \
  --concurrency 1000 \
  --cpu 2 \
  --memory 512Mi \
  --no-cpu-throttling \
  --timeout 3600 \
  --port 8080 \
  --env-vars-file "${ENV_FILE}"

echo
echo "Done. URLs:"
URL="$(gcloud run services describe "${SERVICE}" --project "${PROJECT}" --region "${REGION}" --format='value(status.url)')"
if [[ "${APPS}" != "vote" ]]; then
  echo "  Players : ${URL}/"
  echo "  Screen  : ${URL}/screen"
  echo "  Host    : ${URL}/host   (asks for the password once)"
  echo "  Dash    : ${URL}/dashboard   (public, read-only)"
fi
echo "  Vote    : ${URL}/vote   (phones — scan the QR on the vote screen)"
echo "  Vote screen : ${URL}/vote/screen   (projector, asks for the password once)"
echo "  Vote admin  : ${URL}/vote/admin"
