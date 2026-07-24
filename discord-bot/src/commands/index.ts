import type { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import * as server from "./server.js";

export interface Command {
  data: SlashCommandBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

export const commands: ReadonlyMap<string, Command> = new Map([[server.data.name, server as Command]]);
