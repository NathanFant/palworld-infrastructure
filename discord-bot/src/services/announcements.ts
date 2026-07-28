import { Client } from "discord.js";
import { config } from "../config.js";
import { getState, updateState } from "./stateStore.js";

// Shared by idleShutdownManager.ts, presenceWatcher.ts (auto-start), and
// lifecycleManager.ts for one-off lifecycle event announcements (auto-stop,
// auto-start progress/result, scheduled-restart warning/completion). Each of these
// used to post a brand-new message every time, which spammed the channel with a
// permanent new line per event -- this edits a single message in place instead,
// the same way statusHeartbeat.ts and presenceWatcher.ts's own renderPresence()
// already do for their respective messages. Deliberately a separate message from
// both of those (its own lifecycleEventMessageId), since it's conceptually a
// different thing (a one-off event notice, not a continuously-current status).
export async function announceLifecycleEvent(client: Client<true>, content: string): Promise<void> {
  const statusChannel = await client.channels.fetch(config.discord.statusChannelId);
  if (!statusChannel?.isSendable()) {
    console.error(`Status channel ${config.discord.statusChannelId} not found or can't receive messages.`);
    return;
  }

  const state = await getState();
  if (state.lifecycleEventMessageId) {
    try {
      const message = await statusChannel.messages.fetch(state.lifecycleEventMessageId);
      await message.edit(content);
      return;
    } catch {
      // Message deleted or otherwise unreachable -- fall through and send a new one.
    }
  }

  const message = await statusChannel.send(content);
  await updateState({ lifecycleEventMessageId: message.id });
}
