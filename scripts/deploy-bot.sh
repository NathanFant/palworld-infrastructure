#!/usr/bin/env bash
# Ships discord-bot/docker-compose.yml, the bot's forced-command-restricted SSH
# private key, and a rendered .env to /opt/palworld-bot/ on the game VM (the same
# host scripts/deploy.sh targets -- the Discord bot runs as a second container
# there, see docs/decisions/005-consolidate-bot-onto-game-vm.md), then starts (or
# restarts) it. Uses the ADMIN ssh key (a real shell), never the bot's own
# restricted key -- shipping secrets/config is a human/admin action, per CLAUDE.md.
#
# This is the one place the live Discord bot token and the game VM's SSH private key
# are handled -- deliberately a manually-run script, not something GitHub Actions
# touches (see .github/workflows/bot-cd.yml's deploy job, which only pulls/restarts
# an already-configured deployment over SSH and never sees these secrets).
#
# Unlike scripts/deploy.sh (the Palworld server, which deliberately does NOT start
# the service it deploys), this script does start the container -- the bot has no
# "server's currently off" state of its own; it's what makes /server start possible
# in the first place.
#
# Usage: scripts/deploy-bot.sh
# Reads config from .env.local at the repo root.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_LOCAL="${REPO_ROOT}/.env.local"

if [ ! -f "${ENV_LOCAL}" ]; then
  echo "Missing ${ENV_LOCAL} -- copy .env.example to .env.local and fill in real values first." >&2
  exit 1
fi

# Reads a single KEY=VALUE line rather than sourcing the whole file -- same reasoning
# as scripts/deploy.sh: .env.local is operator-edited data, not something this script
# should risk evaluating as shell.
env_get() {
  local key="$1"
  grep -E "^${key}=" "${ENV_LOCAL}" | tail -n1 | cut -d '=' -f2-
}

# Deploys to the same host scripts/deploy.sh targets -- GAME_VM_HOST here is the
# real, externally-reachable IP/hostname the admin key connects to. This is NOT the
# same value the deployed bot container's own GAME_VM_HOST ends up as (127.0.0.1,
# hardcoded below when rendering its .env) -- see that section for why.
DEPLOY_HOST="$(env_get GAME_VM_HOST)"
ADMIN_SSH_USER="$(env_get ADMIN_SSH_USER)"
ADMIN_SSH_PRIVATE_KEY_PATH="$(env_get ADMIN_SSH_PRIVATE_KEY_PATH)"
GAME_VM_SSH_PRIVATE_KEY_PATH="$(env_get GAME_VM_SSH_PRIVATE_KEY_PATH)"

if [ -z "${DEPLOY_HOST}" ] || [ -z "${ADMIN_SSH_USER}" ] || [ -z "${ADMIN_SSH_PRIVATE_KEY_PATH}" ]; then
  echo "GAME_VM_HOST, ADMIN_SSH_USER, and ADMIN_SSH_PRIVATE_KEY_PATH must all be set in .env.local." >&2
  exit 1
fi

if [ -z "${GAME_VM_SSH_PRIVATE_KEY_PATH}" ] || [ ! -f "${GAME_VM_SSH_PRIVATE_KEY_PATH}" ]; then
  echo "GAME_VM_SSH_PRIVATE_KEY_PATH must point at an existing file -- the bot needs its own private key to reach the game server over loopback." >&2
  exit 1
fi

SSH_TARGET="${ADMIN_SSH_USER}@${DEPLOY_HOST}"
SSH_OPTS=(-i "${ADMIN_SSH_PRIVATE_KEY_PATH}" -o StrictHostKeyChecking=accept-new)

# Rendered .env holds the real Discord bot token and RCON password -- a private temp
# file, never the repo, removed as soon as it's copied over.
RENDERED_ENV="$(mktemp)"
trap 'rm -f "${RENDERED_ENV}"' EXIT
chmod 600 "${RENDERED_ENV}"

{
  echo "DISCORD_BOT_TOKEN=$(env_get DISCORD_BOT_TOKEN)"
  echo "DISCORD_CLIENT_ID=$(env_get DISCORD_CLIENT_ID)"
  echo "DISCORD_GUILD_ID=$(env_get DISCORD_GUILD_ID)"
  echo "DISCORD_VOICE_CHANNEL_ID=$(env_get DISCORD_VOICE_CHANNEL_ID)"
  echo "DISCORD_STATUS_CHANNEL_ID=$(env_get DISCORD_STATUS_CHANNEL_ID)"
  echo "DISCORD_ADMIN_ROLE_ID=$(env_get DISCORD_ADMIN_ROLE_ID)"
  # Hardcoded, not echoed from .env.local -- GAME_VM_HOST/RCON_HOST in .env.local are
  # the real, externally-reachable IP (DEPLOY_HOST above needs that value for SSH
  # targeting; a locally-run bot, for dev, would too). The deployed bot container, by
  # contrast, always runs ON the game VM itself, so its own config must be 127.0.0.1
  # regardless of what DEPLOY_HOST happens to be -- echoing the local value here was a
  # real bug (issue #62): it would have shipped the real IP into the container's own
  # .env, breaking RCON entirely (docker/compose.yml binds it to 127.0.0.1 only) and
  # working for SSH only by accident of network routing, not by design.
  echo "GAME_VM_HOST=127.0.0.1"
  echo "GAME_VM_SSH_PORT=22"
  echo "GAME_VM_SSH_USER=palworld-bot"
  # Same reasoning -- this is always the fixed in-container path the compose file's
  # ./secrets:/app/secrets:ro mount resolves to, never whatever local filesystem path
  # (e.g. a Windows path) GAME_VM_SSH_PRIVATE_KEY_PATH happens to hold on the machine
  # running this script.
  echo "GAME_VM_SSH_PRIVATE_KEY_PATH=./secrets/palworld-bot-ssh-key"
  echo "RCON_HOST=127.0.0.1"
  echo "RCON_PORT=$(env_get RCON_PORT)"
  echo "RCON_PASSWORD=$(env_get RCON_PASSWORD)"
  echo "SERVER_RESTART_INTERVAL_HOURS=$(env_get SERVER_RESTART_INTERVAL_HOURS)"
  # Same reasoning again -- always the fixed in-container path the compose file's
  # ./data:/app/data mount resolves to.
  echo "BOT_STATE_FILE_PATH=./data/state.json"
} > "${RENDERED_ENV}"

echo "Ensuring /opt/palworld-bot exists on ${DEPLOY_HOST}..."
# Owned by "bot" (infrastructure/cloud-init/game-vm.yaml's dedicated user), not the
# admin user running this script -- the container itself runs as this user.
ssh "${SSH_OPTS[@]}" "${SSH_TARGET}" "sudo mkdir -p /opt/palworld-bot/secrets && sudo chown -R bot:docker /opt/palworld-bot"

echo "Copying docker-compose.yml, the game VM SSH key, and .env..."
scp "${SSH_OPTS[@]}" "${REPO_ROOT}/discord-bot/docker-compose.yml" "${SSH_TARGET}:/tmp/docker-compose.yml"
scp "${SSH_OPTS[@]}" "${GAME_VM_SSH_PRIVATE_KEY_PATH}" "${SSH_TARGET}:/tmp/palworld-bot-ssh-key"
scp "${SSH_OPTS[@]}" "${RENDERED_ENV}" "${SSH_TARGET}:/tmp/.env"
# scp'd to /tmp first, then moved into place with the right owner/mode -- scp itself
# can't set the destination owner, and leaving these admin-owned would block the
# "bot" user's container from reading them (especially the SSH private key, which
# most SSH clients refuse outright to use if group/world-readable).
ssh "${SSH_OPTS[@]}" "${SSH_TARGET}" '
  set -euo pipefail
  sudo install -o bot -g docker -m 0644 /tmp/docker-compose.yml /opt/palworld-bot/docker-compose.yml
  sudo install -o bot -g docker -m 0600 /tmp/palworld-bot-ssh-key /opt/palworld-bot/secrets/palworld-bot-ssh-key
  sudo install -o bot -g docker -m 0600 /tmp/.env /opt/palworld-bot/.env
  sudo mkdir -p /opt/palworld-bot/data
  sudo chown bot:docker /opt/palworld-bot/data
  rm -f /tmp/docker-compose.yml /tmp/palworld-bot-ssh-key /tmp/.env
'

echo "Pulling latest image and starting the bot..."
ssh "${SSH_OPTS[@]}" "${SSH_TARGET}" "cd /opt/palworld-bot && sudo -u bot docker compose pull && sudo -u bot docker compose up -d"

echo "Deployed and running. Subsequent image updates can go through .github/workflows/bot-cd.yml's deploy job instead of rerunning this script."
