import { Client } from "discord.js";
import { config } from "../config.js";
import { sendRconCommand } from "./rcon.js";
import { serverControl } from "./serverControl.js";
import { getState, updateState } from "./stateStore.js";

// How long before the scheduled restart the in-game/Discord countdown warning goes
// out. Passed straight through to RCON's own `Shutdown <seconds> <message>` command,
// which natively broadcasts countdown warnings to in-game chat -- the bot mirrors the
// same message to Discord rather than re-implementing countdown timing itself.
export const RESTART_WARNING_SECONDS = 5 * 60;

// Grace period, on top of the warning delay, before "server isn't back up yet" is
// treated as still-restarting rather than stuck. Covers Docker's `restart:
// unless-stopped` bringing the container back plus the game process's own boot time,
// not just the RCON shutdown delay itself.
const RESTART_COMPLETION_GRACE_MS = 5 * 60 * 1000;

async function announce(client: Client<true>, content: string): Promise<void> {
  const statusChannel = await client.channels.fetch(config.discord.statusChannelId);
  if (statusChannel?.isSendable()) {
    await statusChannel.send(content);
  }
}

// Phase 1: if a restart is already in flight, check whether the cycle has completed
// rather than considering a new restart. Checked first (and exclusively) so a pending
// restart is never re-triggered while its own countdown/reboot is still playing out.
async function checkRestartCompletion(client: Client<true>, restartTriggeredAt: string): Promise<void> {
  const expectedCompleteMs =
    new Date(restartTriggeredAt).getTime() + RESTART_WARNING_SECONDS * 1000 + RESTART_COMPLETION_GRACE_MS;
  if (Date.now() < expectedCompleteMs) {
    return; // still within the expected shutdown/reboot window -- check again next tick
  }

  const statusResult = await serverControl.status();
  if (!statusResult.ok || !statusResult.status?.running) {
    return; // past the expected window but not back up yet -- keep waiting
  }

  // idleSince cleared too, for the same reason commands/server.ts's manual
  // start/stop/restart handlers clear it: a scheduled restart is just as much a
  // fresh session as a manual one, and a stale idle timer surviving it could
  // otherwise trigger an unwanted immediate auto-stop on the very next idle-check
  // tick, before anyone's had a chance to reconnect.
  await updateState({
    serverStartedAt: new Date().toISOString(),
    restartTriggeredAt: null,
    idleSince: null,
  });
  await announce(client, "🟢 Scheduled restart complete -- the Palworld server is back online.");
}

// Phase 2: no restart currently pending -- check whether this server's uptime has
// reached the point where a new one should be triggered.
async function maybeTriggerRestart(client: Client<true>, serverStartedAt: string | null): Promise<void> {
  if (!serverStartedAt) {
    return; // no recorded start time to measure uptime against yet
  }

  const deadlineMs =
    new Date(serverStartedAt).getTime() + config.lifecycle.restartIntervalHours * 60 * 60 * 1000;
  const warningStartMs = deadlineMs - RESTART_WARNING_SECONDS * 1000;
  if (Date.now() < warningStartMs) {
    return; // not yet within the warning window before the scheduled restart
  }

  const statusResult = await serverControl.status();
  if (!statusResult.ok || !statusResult.status?.running) {
    return; // nothing currently running to restart
  }

  const message = `⚠️ The Palworld server will restart for scheduled maintenance in ${
    RESTART_WARNING_SECONDS / 60
  } minutes.`;
  const rconResult = await sendRconCommand(`Shutdown ${RESTART_WARNING_SECONDS} ${message}`);
  if (!rconResult.ok) {
    console.error("Failed to send scheduled-restart RCON Shutdown command:", rconResult.error);
    return;
  }

  await updateState({ restartTriggeredAt: new Date().toISOString() });
  await announce(client, message);
}

async function runLifecycleCheckOnce(client: Client<true>): Promise<void> {
  const state = await getState();

  if (state.restartTriggeredAt) {
    await checkRestartCompletion(client, state.restartTriggeredAt);
    return;
  }

  await maybeTriggerRestart(client, state.serverStartedAt);
}

// Same write-queue-style serialization as presenceWatcher.ts's renderQueue and
// statusHeartbeat.ts's heartbeatQueue, applied here from the start rather than added
// after review catches it a third time: without it, an overlapping tick (e.g. a slow
// RCON/SSH connect attempt outliving the check interval) could read the same stale
// state twice and either double-send the RCON Shutdown command or double-complete the
// restart-detection logic.
let lifecycleQueue: Promise<unknown> = Promise.resolve();

export function runLifecycleCheck(client: Client<true>): Promise<void> {
  const task = lifecycleQueue.then(() => runLifecycleCheckOnce(client));
  lifecycleQueue = task.catch(() => undefined);
  return task;
}

export function startLifecycleManager(client: Client<true>, intervalMs: number): NodeJS.Timeout {
  return setInterval(() => {
    runLifecycleCheck(client).catch((error: unknown) => {
      console.error("Lifecycle manager check failed:", error);
    });
  }, intervalMs);
}
