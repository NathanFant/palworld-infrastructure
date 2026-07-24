import { Client, Events } from "discord.js";
import { config } from "../config.js";
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

export async function renderPresence(client: Client<true>): Promise<void> {
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

export function registerPresenceWatcher(client: Client<true>): void {
  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    if (!touchesWatchedChannel(oldState, newState)) {
      return;
    }
    renderPresence(client).catch((error: unknown) => {
      console.error("Failed to update voice presence message:", error);
    });
  });
}
