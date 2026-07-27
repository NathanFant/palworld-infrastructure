import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Single source of truth for env vars is the repo root's .env.local (also read by
// scripts/deploy.sh and Terraform's tfvars) -- not a separate discord-bot/.env, to
// avoid two files drifting out of sync. In production (the bot's own docker-compose
// project on the game VM), real environment variables are already set and this load
// is a no-op if the file doesn't exist there.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(__dirname, "../../.env.local") });

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  // An empty string (e.g. `RCON_PORT=` with nothing after the `=` in a .env file)
  // counts as "not set" here, same as undefined -- `??` alone wouldn't catch this,
  // since "" is neither null nor undefined, and Number("") is 0, not NaN.
  const value = process.env[name];
  return value ? value : fallback;
}

export const config = {
  // Getters, not plain properties: validation happens when a field is actually
  // *read*, not merely when this module is imported. Without this, any unrelated
  // module importing config.js for e.g. config.lifecycle.stateFilePath would throw
  // on missing Discord vars it never even touches -- exactly what broke stateStore's
  // tests in CI (no .env.local there), while passing locally only because a real
  // .env.local happened to be present.
  discord: {
    get token() {
      return required("DISCORD_BOT_TOKEN");
    },
    get clientId() {
      return required("DISCORD_CLIENT_ID");
    },
    get guildId() {
      return required("DISCORD_GUILD_ID");
    },
    get voiceChannelId() {
      return required("DISCORD_VOICE_CHANNEL_ID");
    },
    get statusChannelId() {
      return required("DISCORD_STATUS_CHANNEL_ID");
    },
    get adminRoleId() {
      return required("DISCORD_ADMIN_ROLE_ID");
    },
  },
  // Not required at boot: the bot can start and log into Discord before the game VM
  // exists or before .env.local's GAME_VM_HOST/RCON_HOST are filled in. Services that
  // actually need these (serverControl.ts, rcon.ts) validate at the point of use.
  gameVm: {
    host: optional("GAME_VM_HOST", ""),
    sshPort: Number(optional("GAME_VM_SSH_PORT", "22")),
    sshUser: optional("GAME_VM_SSH_USER", "palworld-bot"),
    sshPrivateKeyPath: optional("GAME_VM_SSH_PRIVATE_KEY_PATH", ""),
  },
  rcon: {
    host: optional("RCON_HOST", ""),
    port: Number(optional("RCON_PORT", "25575")),
    password: optional("RCON_PASSWORD", ""),
  },
  // The address/credentials *players* connect with -- distinct from gameVm.host
  // above, which is 127.0.0.1 in production (the bot's own loopback SSH target on
  // the same VM). Rendered into the deployed bot's .env by scripts/deploy-bot.sh
  // from the same real public IP scripts/deploy.sh and Terraform already use.
  palworld: {
    publicHost: optional("PALWORLD_PUBLIC_HOST", ""),
    publicPort: Number(optional("PALWORLD_PUBLIC_PORT", "8211")),
    serverPassword: optional("PALWORLD_SERVER_PASSWORD", ""),
  },
  lifecycle: {
    restartIntervalHours: Number(optional("SERVER_RESTART_INTERVAL_HOURS", "48")),
    // Resolved against the process's working directory (not this source file's
    // location) -- in production that's the container's WORKDIR with a mounted
    // volume; in local dev, wherever `npm run dev` was invoked from.
    stateFilePath: path.resolve(optional("BOT_STATE_FILE_PATH", "./data/state.json")),
  },
} as const;
