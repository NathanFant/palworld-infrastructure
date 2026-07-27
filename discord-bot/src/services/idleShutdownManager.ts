import { Client } from "discord.js";
import { config } from "../config.js";
import { parsePlayerCount, sendRconCommand } from "./rcon.js";
import { serverControl } from "./serverControl.js";
import { getState, updateState } from "./stateStore.js";

async function announce(client: Client<true>, content: string): Promise<void> {
  const statusChannel = await client.channels.fetch(config.discord.statusChannelId);
  if (statusChannel?.isSendable()) {
    await statusChannel.send(content);
  }
}

async function runIdleCheckOnce(client: Client<true>): Promise<void> {
  if (!config.lifecycle.idleShutdownEnabled) {
    return;
  }

  const statusResult = await serverControl.status();
  if (!statusResult.ok || !statusResult.status?.running) {
    // Nothing running -- clear any stale idle timer so a later start gets a fresh
    // window rather than immediately appearing to have been idle since a previous
    // (now-irrelevant) session.
    const state = await getState();
    if (state.idleSince) {
      await updateState({ idleSince: null });
    }
    return;
  }

  const playersResult = await sendRconCommand("ShowPlayers");
  if (!playersResult.ok || playersResult.response === undefined) {
    return; // couldn't determine player count this tick -- don't guess, try again next tick
  }
  const playerCount = parsePlayerCount(playersResult.response);

  const state = await getState();

  if (playerCount > 0) {
    if (state.idleSince) {
      await updateState({ idleSince: null });
    }
    return;
  }

  if (!state.idleSince) {
    await updateState({ idleSince: new Date().toISOString() });
    return;
  }

  const idleMinutes = config.lifecycle.idleShutdownMinutes;
  const idleForMs = Date.now() - new Date(state.idleSince).getTime();
  if (idleForMs < idleMinutes * 60 * 1000) {
    return;
  }

  await sendRconCommand("Save");
  const stopResult = await serverControl.stop();
  if (!stopResult.ok) {
    console.error("Auto idle-shutdown failed to stop the server:", stopResult.error ?? stopResult.stderr);
    return;
  }

  // Same fields handleStop() sets for a manual /server stop, plus clearing the
  // idle timer -- there's nothing left to be idle about once it's actually stopped.
  await updateState({ restartTriggeredAt: null, idleSince: null });
  await announce(client, `🔴 Stopped the Palworld server automatically after ${idleMinutes} minutes with no players.`);
}

// Same write-queue-style serialization as lifecycleManager.ts/statusHeartbeat.ts's
// own queues -- an overlapping tick (e.g. a slow RCON/SSH call outliving the check
// interval) could otherwise read the same stale idleSince twice and either
// double-trigger the stop or race on clearing/setting the idle timer.
//
// This queue is deliberately separate from presenceWatcher.ts's own autoStartQueue
// (no shared lock between the two): a voice join landing at nearly the same moment
// the idle threshold is crossed could in theory have maybeAutoStart see "already
// running" while this check proceeds to stop it moments later. Narrow window,
// self-resolving on the next qualifying voice-channel transition -- not worth a
// cross-module lock for a 3-person server.
let idleQueue: Promise<unknown> = Promise.resolve();

export function runIdleCheck(client: Client<true>): Promise<void> {
  const task = idleQueue.then(() => runIdleCheckOnce(client));
  idleQueue = task.catch(() => undefined);
  return task;
}

export function startIdleShutdownManager(client: Client<true>, intervalMs: number): NodeJS.Timeout {
  return setInterval(() => {
    runIdleCheck(client).catch((error: unknown) => {
      console.error("Idle shutdown check failed:", error);
    });
  }, intervalMs);
}
