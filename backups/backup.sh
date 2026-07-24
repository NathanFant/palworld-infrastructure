#!/usr/bin/env bash
# Takes a Palworld world-save backup and uploads it to Object Storage under the
# matching retention tier prefix (infrastructure/terraform/storage.tf's lifecycle
# policy already expects <tier>/palworld-<timestamp>.tar.gz). Deployed to
# /opt/palworld/backup.sh by scripts/deploy.sh; invoked by
# palworld-backup@<tier>.service (infrastructure/cloud-init/game-vm.yaml).
#
# Usage: backup.sh {hourly|daily|weekly|monthly}
# Reads config from /opt/palworld/.env (rendered by scripts/deploy.sh).
set -euo pipefail

TIER="${1:?Usage: backup.sh {hourly|daily|weekly|monthly}}"
case "${TIER}" in
  hourly | daily | weekly | monthly) ;;
  *)
    echo "invalid tier: ${TIER} (expected hourly|daily|weekly|monthly)" >&2
    exit 64
    ;;
esac

ENV_FILE=/opt/palworld/.env
if [ ! -f "${ENV_FILE}" ]; then
  echo "Missing ${ENV_FILE} -- run scripts/deploy.sh at least once first." >&2
  exit 1
fi

# Reads a single KEY=VALUE line rather than sourcing the file, same pattern as
# scripts/deploy.sh -- config files are data, not something to evaluate as shell.
env_get() {
  grep -E "^${1}=" "${ENV_FILE}" | tail -n1 | cut -d '=' -f2-
}

RCON_PORT="$(env_get RCON_PORT)"
RCON_PASSWORD="$(env_get PALWORLD_ADMIN_PASSWORD)"
BUCKET="$(env_get OCI_BACKUP_BUCKET_NAME)"
NAMESPACE="$(env_get OCI_BACKUP_NAMESPACE)"

WORLD_DATA_DIR=/mnt/palworld-data
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE="/tmp/palworld-${TIER}-${TIMESTAMP}.tar.gz"

cleanup() {
  rm -f "${ARCHIVE}"
}
trap cleanup EXIT

# Flush recent progress before snapshotting. Best-effort: a failed Save (e.g. the
# server isn't running right now) shouldn't block backing up whatever was already
# on disk from the last save -- an older backup beats no backup.
if ! mcrcon -H 127.0.0.1 -P "${RCON_PORT}" -p "${RCON_PASSWORD}" Save; then
  echo "RCON Save failed (server may not be running) -- backing up last on-disk save." >&2
fi

tar -czf "${ARCHIVE}" -C "${WORLD_DATA_DIR}" Pal/Saved/SaveGames

oci --auth instance_principal os object put \
  --bucket-name "${BUCKET}" \
  --namespace "${NAMESPACE}" \
  --file "${ARCHIVE}" \
  --name "${TIER}/palworld-${TIMESTAMP}.tar.gz" \
  --no-multipart

echo "Uploaded ${TIER}/palworld-${TIMESTAMP}.tar.gz"
