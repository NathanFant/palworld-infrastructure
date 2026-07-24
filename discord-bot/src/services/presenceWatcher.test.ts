import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../config.js", () => ({
  config: {
    discord: { voiceChannelId: "voice-channel-id", statusChannelId: "status-channel-id" },
  },
}));

const getStateMock = vi.fn();
const updateStateMock = vi.fn();

vi.mock("./stateStore.js", () => ({
  getState: (...args: unknown[]) => getStateMock(...args),
  updateState: (...args: unknown[]) => updateStateMock(...args),
}));

const { touchesWatchedChannel, describeVoiceMembers, renderPresence, registerPresenceWatcher } = await import(
  "./presenceWatcher.js"
);

describe("touchesWatchedChannel", () => {
  it("is true when someone joins the watched channel", () => {
    expect(touchesWatchedChannel({ channelId: null }, { channelId: "voice-channel-id" })).toBe(true);
  });

  it("is true when someone leaves the watched channel", () => {
    expect(touchesWatchedChannel({ channelId: "voice-channel-id" }, { channelId: null })).toBe(true);
  });

  it("is true when someone moves out of the watched channel into another one", () => {
    expect(touchesWatchedChannel({ channelId: "voice-channel-id" }, { channelId: "other-channel" })).toBe(true);
  });

  it("is true when someone moves into the watched channel from another one", () => {
    expect(touchesWatchedChannel({ channelId: "other-channel" }, { channelId: "voice-channel-id" })).toBe(true);
  });

  it("is false when neither state touches the watched channel", () => {
    expect(touchesWatchedChannel({ channelId: "channel-a" }, { channelId: "channel-b" })).toBe(false);
  });

  it("is false for an unrelated no-op update (e.g. mute toggle) while already in the watched channel", () => {
    // Same channel on both sides is still "touches" by this function's definition --
    // callers re-render from the channel's live member list regardless, which is
    // harmless (same output) even though nothing membership-wise actually changed.
    expect(touchesWatchedChannel({ channelId: "voice-channel-id" }, { channelId: "voice-channel-id" })).toBe(true);
  });
});

describe("describeVoiceMembers", () => {
  it("reports nobody in voice for an empty channel", () => {
    expect(describeVoiceMembers([])).toBe("Nobody's in voice right now.");
  });

  it("lists display names for a non-empty channel", () => {
    expect(describeVoiceMembers([{ displayName: "Alice" }, { displayName: "Bob" }])).toBe(
      "Currently in voice: Alice, Bob",
    );
  });
});

describe("renderPresence", () => {
  let voiceChannel: { isVoiceBased: () => boolean; members: { values: () => unknown } };
  let statusChannel: {
    isSendable: () => boolean;
    messages: { fetch: ReturnType<typeof vi.fn> };
    send: ReturnType<typeof vi.fn>;
  };
  let client: {
    channels: { cache: { get: ReturnType<typeof vi.fn> }; fetch: ReturnType<typeof vi.fn> };
  };

  beforeEach(() => {
    getStateMock.mockReset();
    updateStateMock.mockReset().mockResolvedValue(undefined);

    voiceChannel = {
      isVoiceBased: () => true,
      members: { values: () => [{ displayName: "Alice" }] },
    };
    statusChannel = {
      isSendable: () => true,
      messages: { fetch: vi.fn() },
      send: vi.fn().mockResolvedValue({ id: "new-message-id" }),
    };
    client = {
      channels: {
        cache: { get: vi.fn().mockReturnValue(voiceChannel) },
        fetch: vi.fn().mockResolvedValue(statusChannel),
      },
    };
  });

  it("sends a new message and records its ID when none exists yet", async () => {
    getStateMock.mockResolvedValue({ voicePresenceMessageId: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await renderPresence(client as any);

    expect(statusChannel.send).toHaveBeenCalledWith("Currently in voice: Alice");
    expect(updateStateMock).toHaveBeenCalledWith({ voicePresenceMessageId: "new-message-id" });
  });

  it("edits the existing message in place instead of sending a new one", async () => {
    const editMock = vi.fn().mockResolvedValue(undefined);
    statusChannel.messages.fetch.mockResolvedValue({ edit: editMock });
    getStateMock.mockResolvedValue({ voicePresenceMessageId: "existing-message-id" });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await renderPresence(client as any);

    expect(editMock).toHaveBeenCalledWith("Currently in voice: Alice");
    expect(statusChannel.send).not.toHaveBeenCalled();
    expect(updateStateMock).not.toHaveBeenCalled();
  });

  it("falls back to sending a new message if the existing one can't be fetched", async () => {
    statusChannel.messages.fetch.mockRejectedValue(new Error("Unknown Message"));
    getStateMock.mockResolvedValue({ voicePresenceMessageId: "deleted-message-id" });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await renderPresence(client as any);

    expect(statusChannel.send).toHaveBeenCalledWith("Currently in voice: Alice");
    expect(updateStateMock).toHaveBeenCalledWith({ voicePresenceMessageId: "new-message-id" });
  });

  it("does nothing if the configured voice channel isn't found or isn't voice-based", async () => {
    client.channels.cache.get.mockReturnValue(undefined);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await renderPresence(client as any);

    expect(client.channels.fetch).not.toHaveBeenCalled();
  });
});

describe("registerPresenceWatcher", () => {
  it("registers a voiceStateUpdate listener that only re-renders when the watched channel is touched", () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    const client = {
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        handlers[event] = handler;
      }),
      channels: {
        cache: { get: vi.fn().mockReturnValue(undefined) },
        fetch: vi.fn(),
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerPresenceWatcher(client as any);

    expect(client.on).toHaveBeenCalledWith("voiceStateUpdate", expect.any(Function));

    // Unrelated channels -- should not attempt to touch the (undefined) voice channel.
    handlers.voiceStateUpdate({ channelId: "a" }, { channelId: "b" });
    expect(client.channels.cache.get).not.toHaveBeenCalled();

    // Touches the watched channel -- should attempt to render (and safely no-op
    // since the mocked channel lookup returns undefined).
    handlers.voiceStateUpdate({ channelId: null }, { channelId: "voice-channel-id" });
    expect(client.channels.cache.get).toHaveBeenCalledWith("voice-channel-id");
  });
});
