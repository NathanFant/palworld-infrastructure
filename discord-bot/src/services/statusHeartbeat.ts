import { Client } from "discord.js";
import { config } from "../config.js";
import { sendRconCommand } from "./rcon.js";
import { serverControl } from "./serverControl.js";
import { getState, updateState } from "./stateStore.js";

interface HeartbeatSnapshot {
  running: boolean;
  playerInfo?: string;
}

async function getSnapshot(): Promise<HeartbeatSnapshot> {
  const statusResult = await serverControl.status();
  const running = statusResult.ok && statusResult.status?.running === true;

  if (!running) {
    return { running: false };
  }

  const playersResult = await sendRconCommand("ShowPlayers");
  return { running: true, playerInfo: playersResult.ok ? playersResult.response : undefined };
}

function formatUptime(serverStartedAt: string | null): string {
  if (!serverStartedAt) {
    return "unknown";
  }
  const elapsedMs = Date.now() - new Date(serverStartedAt).getTime();
  const hours = Math.floor(elapsedMs / (60 * 60 * 1000));
  const minutes = Math.floor((elapsedMs % (60 * 60 * 1000)) / (60 * 1000));
  return `${hours}h ${minutes}m`;
}

export function renderEmbedContent(snapshot: HeartbeatSnapshot, serverStartedAt: string | null): string {
  if (!snapshot.running) {
    return "🔴 **Palworld server is offline.**";
  }
  const uptime = formatUptime(serverStartedAt);
  const players = snapshot.playerInfo ?? "(player info unavailable)";
  return `🟢 **Palworld server is online.**\nUptime: ${uptime}\n${players}`;
}

async function upsertStatusMessage(
  client: Client<true>,
  content: string,
  existingMessageId: string | null,
): Promise<string> {
  const statusChannel = await client.channels.fetch(config.discord.statusChannelId);
  if (!statusChannel?.isSendable()) {
    throw new Error(`Status channel ${config.discord.statusChannelId} not found or can't receive messages.`);
  }

  if (existingMessageId) {
    try {
      const message = await statusChannel.messages.fetch(existingMessageId);
      await message.edit(content);
      return existingMessageId;
    } catch {
      // Message deleted or otherwise unreachable -- fall through and send a new one.
    }
  }

  const message = await statusChannel.send(content);
  return message.id;
}

// Avoids re-editing the Discord message every tick when nothing's actually changed --
// process-local, not persisted, so a bot restart may cause one redundant edit, which
// is harmless. Minute-granularity uptime formatting also naturally avoids most
// redundant edits on its own (uptime text is stable for a whole minute at a time).
let lastRenderedContent: string | undefined;

async function runHeartbeatCheckOnce(client: Client<true>): Promise<void> {
  const state = await getState();
  const snapshot = await getSnapshot();
  const content = renderEmbedContent(snapshot, state.serverStartedAt);
  const transitioned = snapshot.running !== state.lastKnownUp;

  if (transitioned) {
    const statusChannel = await client.channels.fetch(config.discord.statusChannelId);
    if (statusChannel?.isSendable()) {
      await statusChannel.send(
        snapshot.running ? "🟢 The Palworld server just came online." : "🔴 The Palworld server just went offline.",
      );
    }
  }

  if (!transitioned && content === lastRenderedContent) {
    return;
  }

  const messageId = await upsertStatusMessage(client, content, state.statusMessageId);
  lastRenderedContent = content;
  await updateState({ lastKnownUp: snapshot.running, statusMessageId: messageId });
}

// Serializes runHeartbeatCheck() calls -- without this, setInterval could fire an
// overlapping tick if one check runs longer than the interval (plausible here: this
// project's whole premise is the game VM/container is routinely down, which is
// exactly when a bare TCP connect to RCON/SSH hangs longest -- neither rcon-client
// nor node-ssh sets a connect timeout, so a slow/absent server can easily exceed a
// 60s interval). Two overlapping calls would both read the same stale
// lastKnownUp/statusMessageId before either writes back, producing duplicate
// transition announcements and/or duplicate status messages -- the same failure
// class presenceWatcher.ts's renderQueue already fixed for a different module; this
// carries that same pattern over here instead of re-deriving a new one.
let heartbeatQueue: Promise<unknown> = Promise.resolve();

export function runHeartbeatCheck(client: Client<true>): Promise<void> {
  const task = heartbeatQueue.then(() => runHeartbeatCheckOnce(client));
  heartbeatQueue = task.catch(() => undefined);
  return task;
}

export function startStatusHeartbeat(client: Client<true>, intervalMs: number): NodeJS.Timeout {
  return setInterval(() => {
    runHeartbeatCheck(client).catch((error: unknown) => {
      console.error("Status heartbeat check failed:", error);
    });
  }, intervalMs);
}
