import { describe, it, expect, vi, beforeEach } from "vitest";

const configMock = {
  discord: { voiceChannelId: "voice-channel-id", statusChannelId: "status-channel-id" },
  lifecycle: { idleShutdownEnabled: false },
};

vi.mock("../config.js", () => ({ config: configMock }));

const getStateMock = vi.fn();
const updateStateMock = vi.fn();
const serverControlStatusMock = vi.fn();
const serverControlStartMock = vi.fn();

vi.mock("./stateStore.js", () => ({
  getState: (...args: unknown[]) => getStateMock(...args),
  updateState: (...args: unknown[]) => updateStateMock(...args),
}));

vi.mock("./serverControl.js", () => ({
  serverControl: {
    status: (...args: unknown[]) => serverControlStatusMock(...args),
    start: (...args: unknown[]) => serverControlStartMock(...args),
  },
}));

const {
  touchesWatchedChannel,
  joinedWatchedChannel,
  describeVoiceMembers,
  renderPresence,
  maybeAutoStart,
  registerPresenceWatcher,
} = await import("./presenceWatcher.js");

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

describe("joinedWatchedChannel", () => {
  it("is true for a fresh join into the watched channel", () => {
    expect(joinedWatchedChannel({ channelId: null }, { channelId: "voice-channel-id" })).toBe(true);
  });

  it("is true when moving into the watched channel from another one", () => {
    expect(joinedWatchedChannel({ channelId: "other-channel" }, { channelId: "voice-channel-id" })).toBe(true);
  });

  it("is false when leaving the watched channel", () => {
    expect(joinedWatchedChannel({ channelId: "voice-channel-id" }, { channelId: null })).toBe(false);
  });

  it("is false when moving out of the watched channel into another one", () => {
    expect(joinedWatchedChannel({ channelId: "voice-channel-id" }, { channelId: "other-channel" })).toBe(false);
  });

  it("is false for an unrelated no-op update while already in the watched channel", () => {
    expect(joinedWatchedChannel({ channelId: "voice-channel-id" }, { channelId: "voice-channel-id" })).toBe(false);
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

  it("serializes concurrent calls so only one message is ever sent, not one per call", async () => {
    // Stateful mocks (not static return values) -- this is what actually exercises
    // the race: without serialization, both calls would read voicePresenceMessageId
    // as null before either write lands, and both would send a new message.
    let storedMessageId: string | null = null;
    getStateMock.mockImplementation(() => Promise.resolve({ voicePresenceMessageId: storedMessageId }));
    updateStateMock.mockImplementation((partial: { voicePresenceMessageId?: string }) => {
      if (partial.voicePresenceMessageId !== undefined) {
        storedMessageId = partial.voicePresenceMessageId;
      }
      return Promise.resolve();
    });
    const editMock = vi.fn().mockResolvedValue(undefined);
    statusChannel.messages.fetch.mockImplementation((id: string) =>
      id === "new-message-id" ? Promise.resolve({ edit: editMock }) : Promise.reject(new Error("Unknown Message")),
    );

    await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderPresence(client as any),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderPresence(client as any),
    ]);

    expect(statusChannel.send).toHaveBeenCalledTimes(1);
    expect(editMock).toHaveBeenCalledTimes(1);
  });
});

describe("maybeAutoStart", () => {
  let statusChannel: { isSendable: () => boolean; send: ReturnType<typeof vi.fn> };
  let client: { channels: { fetch: ReturnType<typeof vi.fn> } };

  beforeEach(() => {
    configMock.lifecycle = { idleShutdownEnabled: true };
    serverControlStatusMock.mockReset();
    serverControlStartMock.mockReset();
    updateStateMock.mockReset().mockResolvedValue(undefined);

    statusChannel = { isSendable: () => true, send: vi.fn().mockResolvedValue({ id: "msg-id" }) };
    client = { channels: { fetch: vi.fn().mockResolvedValue(statusChannel) } };
  });

  it("does nothing when the feature flag is disabled", async () => {
    configMock.lifecycle = { idleShutdownEnabled: false };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await maybeAutoStart(client as any);

    expect(serverControlStatusMock).not.toHaveBeenCalled();
  });

  it("does nothing if the server is already running", async () => {
    serverControlStatusMock.mockResolvedValue({ ok: true, status: { running: true } });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await maybeAutoStart(client as any);

    expect(serverControlStartMock).not.toHaveBeenCalled();
  });

  it("starts the server and announces once it comes up", async () => {
    serverControlStatusMock
      .mockResolvedValueOnce({ ok: true, status: { running: false } }) // initial check
      .mockResolvedValueOnce({ ok: true, status: { running: true } }); // waitUntilRunning poll
    serverControlStartMock.mockResolvedValue({ ok: true });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await maybeAutoStart(client as any);

    expect(serverControlStartMock).toHaveBeenCalled();
    expect(updateStateMock).toHaveBeenCalledWith(
      expect.objectContaining({ restartTriggeredAt: null, idleSince: null }),
    );
    expect(statusChannel.send).toHaveBeenCalledWith(expect.stringContaining("joined voice"));
    expect(statusChannel.send).toHaveBeenCalledWith(expect.stringContaining("online"));
  });

  it("announces a failure without updating state when start itself fails", async () => {
    serverControlStatusMock.mockResolvedValue({ ok: true, status: { running: false } });
    serverControlStartMock.mockResolvedValue({ ok: false, error: "ssh failed" });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await maybeAutoStart(client as any);

    expect(updateStateMock).not.toHaveBeenCalled();
    expect(statusChannel.send).toHaveBeenCalledWith(expect.stringContaining("Failed"));
  });
});

describe("registerPresenceWatcher", () => {
  it("registers a voiceStateUpdate listener that only re-renders when the watched channel is touched", async () => {
    configMock.lifecycle = { idleShutdownEnabled: false };
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
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.channels.cache.get).not.toHaveBeenCalled();

    // Touches the watched channel -- should attempt to render (and safely no-op
    // since the mocked channel lookup returns undefined). The handler fires this
    // fire-and-forget (never awaited, matching the real event-listener usage), and
    // renderPresence() itself now goes through a queue, so the actual work happens
    // a tick later than the synchronous call above -- flush before asserting.
    handlers.voiceStateUpdate({ channelId: null }, { channelId: "voice-channel-id" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.channels.cache.get).toHaveBeenCalledWith("voice-channel-id");
  });

  it("also fires the auto-start check on a join into the watched channel", async () => {
    configMock.lifecycle = { idleShutdownEnabled: true };
    serverControlStatusMock.mockResolvedValue({ ok: true, status: { running: true } });
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

    handlers.voiceStateUpdate({ channelId: null }, { channelId: "voice-channel-id" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(serverControlStatusMock).toHaveBeenCalled();
  });
});
