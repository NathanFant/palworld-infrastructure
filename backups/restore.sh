#!/usr/bin/env bash
# Downloads and extracts a specific backup for review -- deliberately does NOT
# overwrite the live world automatically. Deployed to /opt/palworld/restore.sh by
# scripts/deploy.sh. See docs/runbooks/world-restore.md for the full procedure.
#
# Usage: restore.sh <tier> <object-name>
#   e.g. restore.sh daily palworld-20260723T140000Z.tar.gz
# Reads config from /opt/palworld/.env (rendered by scripts/deploy.sh).
set -euo pipefail

TIER="${1:?Usage: restore.sh <tier> <object-name>}"
OBJECT_NAME="${2:?Usage: restore.sh <tier> <object-name>}"

ENV_FILE=/opt/palworld/.env
if [ ! -f "${ENV_FILE}" ]; then
  echo "Missing ${ENV_FILE} -- run scripts/deploy.sh at least once first." >&2
  exit 1
fi

env_get() {
  grep -E "^${1}=" "${ENV_FILE}" | tail -n1 | cut -d '=' -f2-
}

BUCKET="$(env_get OCI_BACKUP_BUCKET_NAME)"
NAMESPACE="$(env_get OCI_BACKUP_NAMESPACE)"
WORLD_DATA_DIR=/mnt/palworld-data
STAGING_DIR="/tmp/palworld-restore-$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "${STAGING_DIR}"

oci --auth instance_principal os object get \
  --bucket-name "${BUCKET}" \
  --namespace "${NAMESPACE}" \
  --name "${TIER}/${OBJECT_NAME}" \
  --file "${STAGING_DIR}/backup.tar.gz"

tar -xzf "${STAGING_DIR}/backup.tar.gz" -C "${STAGING_DIR}"

cat <<EOF

Downloaded and extracted to: ${STAGING_DIR}
The live world at ${WORLD_DATA_DIR} has NOT been touched.

Review the extracted save (e.g. check Players/ for expected characters) before
doing anything further. To actually restore it once you're sure:

  1. sudo systemctl stop 'palworld-backup@*.timer'   # avoid a backup mid-swap
  2. palworld-ctl stop                               # as the bot user, or via Discord
  3. sudo mv ${WORLD_DATA_DIR}/Pal/Saved/SaveGames ${WORLD_DATA_DIR}/Pal/Saved/SaveGames.bak-$(date -u +%s)
  4. sudo cp -a ${STAGING_DIR}/Pal/Saved/SaveGames ${WORLD_DATA_DIR}/Pal/Saved/SaveGames
  5. sudo chown -R 1000:1000 ${WORLD_DATA_DIR}/Pal/Saved/SaveGames
  6. palworld-ctl start

This script never performs steps 1-6 itself -- confirm the extracted world is the
one you actually want before overwriting live data.
EOF
