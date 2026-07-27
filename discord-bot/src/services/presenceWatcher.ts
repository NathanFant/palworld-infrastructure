import { Client, Events } from "discord.js";
import { config } from "../config.js";
import { serverControl } from "./serverControl.js";
import { getState, updateState } from "./stateStore.js";

// Loosely typed on purpose (not discord.js's full VoiceState) so this can be unit
// tested with plain objects instead of constructing real gateway payloads.
export interface VoiceStateLike {
  channelId: string | null;
}

// A join, a leave, or moving into/out of the watched channel all touch it on at
// least one side; moving between two other, unrelated channels touches neither.
export function touchesWatchedChannel(oldState: VoiceStateLike, newState: VoiceStateLike): boolean {
  return oldState.channelId === config.discord.voiceChannelId || newState.channelId === config.discord.voiceChannelId;
}

// Narrower than touchesWatchedChannel: true only for an actual join into the
// watched channel (from nothing, or moved in from elsewhere) -- a leave or an
// unrelated move-out shouldn't ever auto-start the server.
export function joinedWatchedChannel(oldState: VoiceStateLike, newState: VoiceStateLike): boolean {
  return newState.channelId === config.discord.voiceChannelId && oldState.channelId !== config.discord.voiceChannelId;
}

export interface MemberLike {
  displayName: string;
}

// Always re-derives the full current membership from the channel's own live cache,
// rather than manually tracking join/leave deltas -- this handles joins, leaves, and
// moves-in/moves-out uniformly and correctly by construction, with no separate
// per-case logic to get wrong.
export function describeVoiceMembers(members: Iterable<MemberLike>): string {
  const names = [...members].map((member) => member.displayName);
  if (names.length === 0) {
    return "Nobody's in voice right now.";
  }
  return `Currently in voice: ${names.join(", ")}`;
}

async function renderPresenceOnce(client: Client<true>): Promise<void> {
  const voiceChannel = client.channels.cache.get(config.discord.voiceChannelId);
  if (!voiceChannel?.isVoiceBased()) {
    console.error(`Voice channel ${config.discord.voiceChannelId} not found or not a voice channel.`);
    return;
  }

  const statusChannel = await client.channels.fetch(config.discord.statusChannelId);
  if (!statusChannel?.isSendable()) {
    console.error(`Status channel ${config.discord.statusChannelId} not found or can't receive messages.`);
    return;
  }

  const content = describeVoiceMembers(voiceChannel.members.values());

  const state = await getState();
  if (state.voicePresenceMessageId) {
    try {
      const message = await statusChannel.messages.fetch(state.voicePresenceMessageId);
      await message.edit(content);
      return;
    } catch {
      // Message was deleted or otherwise unreachable -- fall through and send a new one.
    }
  }

  const message = await statusChannel.send(content);
  await updateState({ voicePresenceMessageId: message.id });
}

// Serializes renderPresence() calls -- without this, two voice events fired in quick
// succession (e.g. two people joining nearly simultaneously) could both read
// voicePresenceMessageId as null before either write lands, and both send a new
// message instead of one editing the other's. Same write-queue pattern as
// stateStore.ts's updateState(), applied here to the whole read-then-act sequence,
// not just the final state write.
let renderQueue: Promise<unknown> = Promise.resolve();

export function renderPresence(client: Client<true>): Promise<void> {
  const task = renderQueue.then(() => renderPresenceOnce(client));
  // Keep the queue moving even if this render fails, so one failure doesn't
  // permanently wedge every future render.
  renderQueue = task.catch(() => undefined);
  return task;
}

const AUTO_START_POLL_INTERVAL_MS = 5_000;
const AUTO_START_POLL_TIMEOUT_MS = 3 * 60 * 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntilRunning(): Promise<boolean> {
  const deadline = Date.now() + AUTO_START_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await serverControl.status();
    if (result.ok && result.status?.running) {
      return true;
    }
    await sleep(AUTO_START_POLL_INTERVAL_MS);
  }
  return false;
}

async function announce(client: Client<true>, content: string): Promise<void> {
  const statusChannel = await client.channels.fetch(config.discord.statusChannelId);
  if (statusChannel?.isSendable()) {
    await statusChannel.send(content);
  }
}

async function maybeAutoStartOnce(client: Client<true>): Promise<void> {
  if (!config.lifecycle.idleShutdownEnabled) {
    return;
  }

  const statusResult = await serverControl.status();
  if (statusResult.ok && statusResult.status?.running) {
    return; // already running (or already starting) -- nothing to do
  }

  await announce(client, "🟡 Someone joined voice -- starting the Palworld server...");

  const startResult = await serverControl.start();
  if (!startResult.ok) {
    await announce(
      client,
      `Failed to auto-start the Palworld server: ${startResult.error ?? startResult.stderr ?? "unknown error"}`,
    );
    return;
  }

  const healthy = await waitUntilRunning();
  if (!healthy) {
    await announce(
      client,
      "Auto-start triggered, but the server didn't come up within the expected time. Check `/server status`.",
    );
    return;
  }

  await updateState({
    serverStartedAt: new Date().toISOString(),
    restartTriggeredAt: null,
    idleSince: null,
  });
  await announce(client, "🟢 The Palworld server is online.");
}

// Same write-queue pattern as renderQueue above -- two people joining voice within
// the same tick shouldn't both fire serverControl.start().
let autoStartQueue: Promise<unknown> = Promise.resolve();

export function maybeAutoStart(client: Client<true>): Promise<void> {
  const task = autoStartQueue.then(() => maybeAutoStartOnce(client));
  autoStartQueue = task.catch(() => undefined);
  return task;
}

export function registerPresenceWatcher(client: Client<true>): void {
  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    if (touchesWatchedChannel(oldState, newState)) {
      renderPresence(client).catch((error: unknown) => {
        console.error("Failed to update voice presence message:", error);
      });
    }
    if (joinedWatchedChannel(oldState, newState)) {
      maybeAutoStart(client).catch((error: unknown) => {
        console.error("Failed to auto-start the server on voice join:", error);
      });
    }
  });
}
