import { Client, Events, GatewayIntentBits } from "discord.js";
import { config } from "./config.js";

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
});

client.login(config.discord.token);
