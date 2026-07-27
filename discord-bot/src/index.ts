import { Client, Events, GatewayIntentBits, MessageFlags } from "discord.js";
import { config } from "./config.js";
import { commands } from "./commands/index.js";
import { registerPresenceWatcher, renderPresence } from "./services/presenceWatcher.js";
import { startStatusHeartbeat } from "./services/statusHeartbeat.js";
import { startLifecycleManager } from "./services/lifecycleManager.js";
import { startIdleShutdownManager } from "./services/idleShutdownManager.js";

const STATUS_HEARTBEAT_INTERVAL_MS = 60_000;
const LIFECYCLE_CHECK_INTERVAL_MS = 60_000;
const IDLE_CHECK_INTERVAL_MS = 60_000;

// Guilds: baseline, required for basic guild/channel caching to work at all.
// GuildVoiceStates: needed for the presence watcher (Phase 5) to see voice-channel
// joins/leaves.
// Deliberately no GuildMessages: this bot never reads message content or listens to
// messageCreate -- every interaction is a slash command (delivered regardless of
// intents) or a voice state update. Requesting an intent this bot doesn't use would
// be an unnecessary privilege, inconsistent with the rest of this project's
// least-privilege posture (see CLAUDE.md).
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  registerPresenceWatcher(readyClient);
  renderPresence(readyClient).catch((error: unknown) => {
    console.error("Failed to render initial voice presence:", error);
  });
  startStatusHeartbeat(readyClient, STATUS_HEARTBEAT_INTERVAL_MS);
  startLifecycleManager(readyClient, LIFECYCLE_CHECK_INTERVAL_MS);
  startIdleShutdownManager(readyClient, IDLE_CHECK_INTERVAL_MS);
});

client.on(Events.InteractionCreate, (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  const command = commands.get(interaction.commandName);
  if (!command) {
    console.error(`No handler registered for command: ${interaction.commandName}`);
    return;
  }

  command.execute(interaction).catch(async (error: unknown) => {
    console.error(`Error handling /${interaction.commandName}:`, error);
    const content = "Something went wrong running that command.";
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  });
});

client.login(config.discord.token);
