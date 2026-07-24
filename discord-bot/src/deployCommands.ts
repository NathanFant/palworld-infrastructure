// Registers slash commands, guild-scoped (not global) for fast iteration during
// development -- guild commands update instantly, global commands can take up to an
// hour to propagate. Run manually: `npx tsx src/deployCommands.ts`.
import { REST, Routes } from "discord.js";
import { config } from "./config.js";
import { commands } from "./commands/index.js";

const rest = new REST().setToken(config.discord.token);

const body = [...commands.values()].map((command) => command.data.toJSON());

const result = await rest.put(Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId), {
  body,
});

const count = Array.isArray(result) ? result.length : 0;
console.log(`Registered ${count} command(s) to guild ${config.discord.guildId}.`);
