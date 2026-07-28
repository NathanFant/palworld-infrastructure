import { describe, it, expect, vi, beforeEach } from "vitest";

const configMock = {
  discord: { statusChannelId: "status-channel-id" },
};

vi.mock("../config.js", () => ({ config: configMock }));

const getStateMock = vi.fn();
const updateStateMock = vi.fn();

vi.mock("./stateStore.js", () => ({
  getState: (...args: unknown[]) => getStateMock(...args),
  updateState: (...args: unknown[]) => updateStateMock(...args),
}));

const { announceLifecycleEvent } = await import("./announcements.js");

describe("announceLifecycleEvent", () => {
  let statusChannel: {
    isSendable: () => boolean;
    messages: { fetch: ReturnType<typeof vi.fn> };
    send: ReturnType<typeof vi.fn>;
  };
  let client: { channels: { fetch: ReturnType<typeof vi.fn> } };

  beforeEach(() => {
    getStateMock.mockReset();
    updateStateMock.mockReset().mockResolvedValue(undefined);

    statusChannel = {
      isSendable: () => true,
      messages: { fetch: vi.fn() },
      send: vi.fn().mockResolvedValue({ id: "new-message-id" }),
    };
    client = { channels: { fetch: vi.fn().mockResolvedValue(statusChannel) } };
  });

  it("sends a new message and records its ID when none exists yet", async () => {
    getStateMock.mockResolvedValue({ lifecycleEventMessageId: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await announceLifecycleEvent(client as any, "🟢 The Palworld server is online.");

    expect(statusChannel.send).toHaveBeenCalledWith("🟢 The Palworld server is online.");
    expect(updateStateMock).toHaveBeenCalledWith({ lifecycleEventMessageId: "new-message-id" });
  });

  it("edits the existing message in place instead of sending a new one", async () => {
    const editMock = vi.fn().mockResolvedValue(undefined);
    statusChannel.messages.fetch.mockResolvedValue({ edit: editMock });
    getStateMock.mockResolvedValue({ lifecycleEventMessageId: "existing-message-id" });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await announceLifecycleEvent(client as any, "🔴 Stopped the Palworld server automatically.");

    expect(editMock).toHaveBeenCalledWith("🔴 Stopped the Palworld server automatically.");
    expect(statusChannel.send).not.toHaveBeenCalled();
    expect(updateStateMock).not.toHaveBeenCalled();
  });

  it("falls back to sending a new message if the existing one can't be fetched", async () => {
    statusChannel.messages.fetch.mockRejectedValue(new Error("Unknown Message"));
    getStateMock.mockResolvedValue({ lifecycleEventMessageId: "deleted-message-id" });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await announceLifecycleEvent(client as any, "⚠️ Scheduled restart warning.");

    expect(statusChannel.send).toHaveBeenCalledWith("⚠️ Scheduled restart warning.");
    expect(updateStateMock).toHaveBeenCalledWith({ lifecycleEventMessageId: "new-message-id" });
  });

  it("does nothing if the status channel isn't found or can't receive messages", async () => {
    client.channels.fetch.mockResolvedValue(undefined);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await announceLifecycleEvent(client as any, "🟢 The Palworld server is online.");

    expect(getStateMock).not.toHaveBeenCalled();
  });
});
