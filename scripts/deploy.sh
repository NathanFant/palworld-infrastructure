#!/usr/bin/env bash
# Ships docker/compose.yml and a rendered .env to /opt/palworld/ on the game VM,
# then pulls the latest pinned image there. Uses the ADMIN ssh key (a real shell),
# never the bot's forced-command-restricted key -- shipping a new
# config/version is a human/admin action, per CLAUDE.md. Deliberately does NOT
# start/stop the service; that stays palworld-ctl's (and the bot's) job.
#
# Usage: scripts/deploy.sh [env-file]
# Reads config from .env.local at the repo root by default. Pass an alternate
# path (e.g. .env.contabo.local) to target a different host without touching
# .env.local -- useful for validating a new deployment (see
# docs/runbooks/contabo-cutover.md) while .env.local still points at the live
# production host.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_LOCAL="${1:-${REPO_ROOT}/.env.local}"

if [ ! -f "${ENV_LOCAL}" ]; then
  echo "Missing ${ENV_LOCAL} -- copy .env.example to .env.local (or the path you passed) and fill in real values first." >&2
  exit 1
fi

# Reads a single KEY=VALUE line rather than sourcing the whole file -- .env.local is
# operator-edited data, not something this script should risk evaluating as shell
# (e.g. an unescaped $(...) or backtick in a value shouldn't ever get executed).
env_get() {
  local key="$1"
  grep -E "^${key}=" "${ENV_LOCAL}" | tail -n1 | cut -d '=' -f2-
}

GAME_VM_HOST="$(env_get GAME_VM_HOST)"
ADMIN_SSH_USER="$(env_get ADMIN_SSH_USER)"
ADMIN_SSH_PRIVATE_KEY_PATH="$(env_get ADMIN_SSH_PRIVATE_KEY_PATH)"

if [ -z "${GAME_VM_HOST}" ] || [ -z "${ADMIN_SSH_USER}" ] || [ -z "${ADMIN_SSH_PRIVATE_KEY_PATH}" ]; then
  echo "GAME_VM_HOST, ADMIN_SSH_USER, and ADMIN_SSH_PRIVATE_KEY_PATH must all be set in .env.local." >&2
  exit 1
fi

SSH_TARGET="${ADMIN_SSH_USER}@${GAME_VM_HOST}"
SSH_OPTS=(-i "${ADMIN_SSH_PRIVATE_KEY_PATH}" -o StrictHostKeyChecking=accept-new)

# Rendered .env holds real secrets (ADMIN_PASSWORD, SERVER_PASSWORD) -- goes to a
# private temp file, never the repo, and is removed as soon as it's copied over.
RENDERED_ENV="$(mktemp)"
trap 'rm -f "${RENDERED_ENV}"' EXIT
chmod 600 "${RENDERED_ENV}"

{
  echo "PALWORLD_SERVER_NAME=$(env_get PALWORLD_SERVER_NAME)"
  echo "PALWORLD_SERVER_DESCRIPTION=$(env_get PALWORLD_SERVER_DESCRIPTION)"
  echo "PALWORLD_ADMIN_PASSWORD=$(env_get PALWORLD_ADMIN_PASSWORD)"
  echo "PALWORLD_SERVER_PASSWORD=$(env_get PALWORLD_SERVER_PASSWORD)"
  echo "PALWORLD_PUBLIC_PORT=$(env_get PALWORLD_PUBLIC_PORT)"
  echo "PALWORLD_QUERY_PORT=$(env_get PALWORLD_QUERY_PORT)"
  echo "PALWORLD_MAX_PLAYERS=$(env_get PALWORLD_MAX_PLAYERS)"
  echo "RCON_PORT=$(env_get RCON_PORT)"
  echo "OCI_BACKUP_BUCKET_NAME=$(env_get OCI_BACKUP_BUCKET_NAME)"
  echo "OCI_BACKUP_NAMESPACE=$(env_get OCI_BACKUP_NAMESPACE)"
  echo "OCI_BACKUP_REGION=$(env_get OCI_BACKUP_REGION)"
} > "${RENDERED_ENV}"

echo "Ensuring /opt/palworld exists on ${GAME_VM_HOST}..."
# Owned by palworld-bot (not the admin user running this script) -- palworld-ctl and
# the backup.sh systemd service both run as palworld-bot and need to read these files.
ssh "${SSH_OPTS[@]}" "${SSH_TARGET}" "sudo mkdir -p /opt/palworld && sudo chown palworld-bot:docker /opt/palworld"

echo "Copying docker-compose.yml, backup/restore scripts, and .env..."
scp "${SSH_OPTS[@]}" "${REPO_ROOT}/docker/compose.yml" "${SSH_TARGET}:/tmp/docker-compose.yml"
scp "${SSH_OPTS[@]}" "${REPO_ROOT}/backups/backup.sh" "${SSH_TARGET}:/tmp/backup.sh"
scp "${SSH_OPTS[@]}" "${REPO_ROOT}/backups/restore.sh" "${SSH_TARGET}:/tmp/restore.sh"
scp "${SSH_OPTS[@]}" "${RENDERED_ENV}" "${SSH_TARGET}:/tmp/.env"
# scp'd to /tmp first, then moved into place with the right owner/mode -- scp itself
# has no way to set the destination owner, and leaving these admin-owned (or at
# scp's default umask) would block palworld-bot (backup.sh's systemd service, and
# palworld-ctl) from reading them, especially .env's real PALWORLD_ADMIN_PASSWORD/
# PALWORLD_SERVER_PASSWORD.
ssh "${SSH_OPTS[@]}" "${SSH_TARGET}" '
  set -euo pipefail
  sudo install -o palworld-bot -g docker -m 0644 /tmp/docker-compose.yml /opt/palworld/docker-compose.yml
  sudo install -o palworld-bot -g docker -m 0755 /tmp/backup.sh /opt/palworld/backup.sh
  sudo install -o palworld-bot -g docker -m 0755 /tmp/restore.sh /opt/palworld/restore.sh
  sudo install -o palworld-bot -g docker -m 0600 /tmp/.env /opt/palworld/.env
  rm -f /tmp/docker-compose.yml /tmp/backup.sh /tmp/restore.sh /tmp/.env
'

echo "Pulling latest image..."
# As palworld-bot, not the admin user running this script -- .env is 0600 owned by
# palworld-bot, and `docker compose` always tries to load it from the working
# directory even for `pull`, so running this as the admin user fails with a
# permission error on that file.
ssh "${SSH_OPTS[@]}" "${SSH_TARGET}" "cd /opt/palworld && sudo -u palworld-bot docker compose pull"

echo "Deployed. Use the Discord bot's /server start (or palworld-ctl start over SSH as the bot user) to run it."
