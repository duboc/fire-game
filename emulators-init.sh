#!/usr/bin/env bash
# =================================================================-------------
# Tap Race: Enterprise Edition (TREE) — Emulator Initialization Script
# =================================================================-------------
# This script initializes Spanner instances/databases/tables, Pub/Sub topics,
# and Bigtable instances/tables within local GCP SDK emulators.
# =================================================================-------------

set -eo pipefail

# Configuration and Ports (matching docker-compose.emulator.yml)
export GCP_PROJECT_ID="${GCP_PROJECT_ID:-tree-enterprise-dev}"
export SPANNER_EMULATOR_HOST="${SPANNER_EMULATOR_HOST:-localhost:9010}"
export PUBSUB_EMULATOR_HOST="${PUBSUB_EMULATOR_HOST:-localhost:8085}"
export BIGTABLE_EMULATOR_HOST="${BIGTABLE_EMULATOR_HOST:-localhost:8086}"

echo "========================================================="
echo "🌴 TREE: Initializing Local GCP Emulators"
echo "Project: $GCP_PROJECT_ID"
echo "Spanner: $SPANNER_EMULATOR_HOST"
echo "Pub/Sub: $PUBSUB_EMULATOR_HOST"
echo "Bigtable: $BIGTABLE_EMULATOR_HOST"
echo "========================================================="

# Helper function to wait for a port to be open
wait_for_port() {
  local host_port=$1
  local service_name=$2
  local host="${host_port%:*}"
  local port="${host_port#*:}"
  
  echo "⌛ Waiting for $service_name ($host:$port) to boot..."
  until nc -z "$host" "$port" 2>/dev/null; do
    sleep 1
  done
  echo "✅ $service_name is ready!"
}

# Ensure dependencies are running
wait_for_port "$PUBSUB_EMULATOR_HOST" "Pub/Sub Emulator"
wait_for_port "$SPANNER_EMULATOR_HOST" "Spanner Emulator"
wait_for_port "$BIGTABLE_EMULATOR_HOST" "Bigtable Emulator"

# -----------------------------------------------------------------------------
# 1. Initialize Pub/Sub Topic and Subscription
# -----------------------------------------------------------------------------
echo -e "\n📨 [Pub/Sub] Configuring messaging schema..."
TOPIC_NAME="tap-events-topic"
SUB_NAME="tap-events-sub"

# Create topic
if gcloud --project="$GCP_PROJECT_ID" pubsub topics describe "$TOPIC_NAME" >/dev/null 2>&1; then
  echo "   Topic '$TOPIC_NAME' already exists."
else
  gcloud --project="$GCP_PROJECT_ID" pubsub topics create "$TOPIC_NAME"
  echo "   Topic '$TOPIC_NAME' created successfully."
fi

# Create subscription
if gcloud --project="$GCP_PROJECT_ID" pubsub subscriptions describe "$SUB_NAME" >/dev/null 2>&1; then
  echo "   Subscription '$SUB_NAME' already exists."
else
  gcloud --project="$GCP_PROJECT_ID" pubsub subscriptions create "$SUB_NAME" --topic="$TOPIC_NAME"
  echo "   Subscription '$SUB_NAME' created successfully."
fi


# -----------------------------------------------------------------------------
# 2. Initialize Cloud Spanner Instance, Database, and Tables
# -----------------------------------------------------------------------------
echo -e "\n💾 [Spanner] Configuring transactional relational schema..."
SPANNER_INSTANCE="tree-instance"
SPANNER_DATABASE="tree-db"

# Create Spanner Instance (only needed on emulator to trigger API bounds)
echo "   Creating instance '$SPANNER_INSTANCE'..."
gcloud spanner instances create "$SPANNER_INSTANCE" \
  --config=emulator-config \
  --description="TREE Local Development Instance" \
  --nodes=1 || echo "   Instance '$SPANNER_INSTANCE' already exists or configured."

# Create Database and Tables
echo "   Creating database '$SPANNER_DATABASE' with tables..."
gcloud spanner databases create "$SPANNER_DATABASE" \
  --instance="$SPANNER_INSTANCE" \
  --ddl='
    CREATE TABLE Players (
      player_id STRING(64) NOT NULL,
      name STRING(128) NOT NULL,
      emoji STRING(32) NOT NULL,
      seq INT64 NOT NULL,
      created_at TIMESTAMP OPTIONS (allow_commit_timestamp=true)
    ) PRIMARY KEY (player_id);

    CREATE TABLE Rounds (
      round_id INT64 NOT NULL,
      status STRING(32) NOT NULL,
      starts_at INT64,
      ends_at INT64,
      duration_ms INT64 NOT NULL,
      total_taps INT64 NOT NULL,
      winner_id STRING(64),
      winner_name STRING(128),
      winner_count INT64
    ) PRIMARY KEY (round_id);
  ' || echo "   Database and tables already exist or schema applied."


# -----------------------------------------------------------------------------
# 3. Initialize Cloud Bigtable Instance and Column Families
# -----------------------------------------------------------------------------
echo -e "\n📊 [Bigtable] Configuring clickstream log storage..."
BT_INSTANCE="tree-instance"
BT_TABLE="clickstream-raw-logs"

# Note: The bigtable emulator does not require explicit instance creation before table creation,
# but we run cbt tool configurations if cbt is installed, or gcloud.
# We create a table with a "stats" column family.
if command -v cbt >/dev/null 2>&1; then
  echo "   Creating Bigtable table '$BT_TABLE' with column family 'taps'..."
  # Set cbt configuration in temporary file
  export CBT_PROJECT="$GCP_PROJECT_ID"
  export CBT_INSTANCE="$BT_INSTANCE"
  
  cbt createtable "$BT_TABLE" || echo "   Bigtable table already exists."
  cbt createfamily "$BT_TABLE" taps || echo "   Column family 'taps' already exists."
else
  echo "   [Warning] 'cbt' CLI tool is missing. Skipping explicit table pre-creation."
  echo "   (The TREE streaming consumer will create the Bigtable schema programmatically upon startup if missing)"
fi

echo -e "\n🎉 TREE Emulator initialization complete! System ready for development.\n"
