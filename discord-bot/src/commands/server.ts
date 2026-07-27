import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from "discord.js";
import { config } from "../config.js";
import { sendRconCommand } from "../services/rcon.js";
import { serverControl } from "../services/serverControl.js";
import { updateState } from "../services/stateStore.js";

export const data = new SlashCommandBuilder()
  .setName("server")
  .setDescription("Control the Palworld server")
  .addSubcommand((sub) => sub.setName("start").setDescription("Start the Palworld server"))
  .addSubcommand((sub) => sub.setName("stop").setDescription("Save and stop the Palworld server"))
  .addSubcommand((sub) => sub.setName("status").setDescription("Check whether the server is online"))
  .addSubcommand((sub) => sub.setName("restart").setDescription("Save, stop, and start the Palworld server"));

// Discord's own command-permission system works on permission bits (Administrator,
// ManageGuild, etc.), not "has this specific role" -- so restricting to
// DISCORD_ADMIN_ROLE_ID is enforced here in code, not declaratively on the command.
function isAdmin(interaction: ChatInputCommandInteraction): boolean {
  if (!interaction.inCachedGuild()) {
    return false;
  }
  return interaction.member.roles.cache.has(config.discord.adminRoleId);
}

const STATUS_POLL_INTERVAL_MS = 5_000;
const STATUS_POLL_TIMEOUT_MS = 3 * 60 * 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntilRunning(): Promise<boolean> {
  const deadline = Date.now() + STATUS_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await serverControl.status();
    if (result.ok && result.status?.running) {
      return true;
    }
    await sleep(STATUS_POLL_INTERVAL_MS);
  }
  return false;
}

function describeFailure(result: { error?: string; stderr?: string }): string {
  return result.error ?? result.stderr ?? "unknown error";
}

async function handleStart(interaction: ChatInputCommandInteraction): Promise<void> {
  const currentStatus = await serverControl.status();
  if (currentStatus.ok && currentStatus.status?.running) {
    await interaction.reply({ content: "The server is already running.", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply("Starting the Palworld server...");

  const startResult = await serverControl.start();
  if (!startResult.ok) {
    await interaction.editReply(`Failed to start the server: ${describeFailure(startResult)}`);
    return;
  }

  const healthy = await waitUntilRunning();
  if (!healthy) {
    await interaction.editReply(
      "The start command was sent, but the server didn't come up within the expected time -- it may still be starting. Check `/server status` shortly.",
    );
    return;
  }

  // restartTriggeredAt/idleSince cleared here too: a manual start always means a
  // fresh clock, regardless of any lifecycle-manager restart countdown or
  // idle-shutdown timer that happened to be pending from a previous session.
  await updateState({
    serverStartedAt: new Date().toISOString(),
    lastKnownUp: true,
    restartTriggeredAt: null,
    idleSince: null,
  });
  await interaction.editReply("The Palworld server is online.");
}

async function handleStop(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.reply("Saving and stopping the Palworld server...");

  await sendRconCommand("Save");

  const stopResult = await serverControl.stop();
  if (!stopResult.ok) {
    await interaction.editReply(`Failed to stop the server: ${describeFailure(stopResult)}`);
    return;
  }

  // A manual stop cancels any lifecycle-manager restart countdown, and any
  // idle-shutdown timer, that might have been pending -- there's nothing left to
  // restart or to be idle about.
  await updateState({ lastKnownUp: false, restartTriggeredAt: null, idleSince: null });
  await interaction.editReply("The Palworld server has been stopped.");
}

async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  const statusResult = await serverControl.status();
  if (!statusResult.ok || !statusResult.status?.running) {
    await interaction.reply({ content: "The Palworld server is offline.", flags: MessageFlags.Ephemeral });
    return;
  }

  const playersResult = await sendRconCommand("ShowPlayers");
  const playersInfo = playersResult.ok ? playersResult.response : "(unable to fetch player list)";

  await interaction.reply({
    content: `The Palworld server is online.\n\n${playersInfo}`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleRestart(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.reply("Restarting the Palworld server...");

  await sendRconCommand("Save");

  const stopResult = await serverControl.stop();
  if (!stopResult.ok) {
    await interaction.editReply(`Failed to stop the server for restart: ${describeFailure(stopResult)}`);
    return;
  }

  const startResult = await serverControl.start();
  if (!startResult.ok) {
    await interaction.editReply(`Failed to start the server after stopping it: ${describeFailure(startResult)}`);
    return;
  }

  const healthy = await waitUntilRunning();
  if (!healthy) {
    await interaction.editReply(
      "Restart triggered, but the server didn't come up within the expected time. Check `/server status` shortly.",
    );
    return;
  }

  await updateState({
    serverStartedAt: new Date().toISOString(),
    lastKnownUp: true,
    restartTriggeredAt: null,
    idleSince: null,
  });
  await interaction.editReply("The Palworld server has been restarted and is online.");
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isAdmin(interaction)) {
    await interaction.reply({
      content: "You don't have permission to run this command.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  switch (interaction.options.getSubcommand()) {
    case "start":
      await handleStart(interaction);
      break;
    case "stop":
      await handleStop(interaction);
      break;
    case "status":
      await handleStatus(interaction);
      break;
    case "restart":
      await handleRestart(interaction);
      break;
  }
}
