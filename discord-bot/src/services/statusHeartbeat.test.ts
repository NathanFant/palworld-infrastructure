import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../config.js", () => ({
  config: { discord: { statusChannelId: "status-channel-id" } },
}));

const sendRconCommandMock = vi.fn();
const serverControlStatusMock = vi.fn();
const getStateMock = vi.fn();
const updateStateMock = vi.fn();

vi.mock("./rcon.js", () => ({
  sendRconCommand: (...args: unknown[]) => sendRconCommandMock(...args),
}));

vi.mock("./serverControl.js", () => ({
  serverControl: { status: (...args: unknown[]) => serverControlStatusMock(...args) },
}));

vi.mock("./stateStore.js", () => ({
  getState: (...args: unknown[]) => getStateMock(...args),
  updateState: (...args: unknown[]) => updateStateMock(...args),
}));

interface FakeStatusChannel {
  isSendable: () => boolean;
  messages: { fetch: ReturnType<typeof vi.fn> };
  send: ReturnType<typeof vi.fn>;
}

let statusChannel: FakeStatusChannel;
let client: { channels: { fetch: ReturnType<typeof vi.fn> } };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let runHeartbeatCheck: (client: any) => Promise<void>;

beforeEach(async () => {
  vi.resetModules();
  sendRconCommandMock.mockReset().mockResolvedValue({ ok: true, response: "Players: 0" });
  serverControlStatusMock.mockReset();
  getStateMock.mockReset();
  updateStateMock.mockReset().mockResolvedValue(undefined);

  statusChannel = {
    isSendable: () => true,
    messages: { fetch: vi.fn() },
    send: vi.fn().mockResolvedValue({ id: "new-message-id" }),
  };
  client = { channels: { fetch: vi.fn().mockResolvedValue(statusChannel) } };

  ({ runHeartbeatCheck } = await import("./statusHeartbeat.js"));
});

describe("runHeartbeatCheck", () => {
  it("sends a fresh status message on the very first check", async () => {
    serverControlStatusMock.mockResolvedValue({ ok: true, status: { running: false } });
    getStateMock.mockResolvedValue({ lastKnownUp: false, statusMessageId: null, serverStartedAt: null });

    await runHeartbeatCheck(client);

    expect(statusChannel.send).toHaveBeenCalledWith(expect.stringContaining("offline"));
    expect(updateStateMock).toHaveBeenCalledWith({ lastKnownUp: false, statusMessageId: "new-message-id" });
  });

  it("posts a transition message when the server just came online", async () => {
    serverControlStatusMock.mockResolvedValue({ ok: true, status: { running: true, state: "running" } });
    getStateMock.mockResolvedValue({
      lastKnownUp: false,
      statusMessageId: "existing-id",
      serverStartedAt: new Date().toISOString(),
    });
    statusChannel.messages.fetch.mockResolvedValue({ edit: vi.fn().mockResolvedValue(undefined) });

    await runHeartbeatCheck(client);

    expect(statusChannel.send).toHaveBeenCalledWith(expect.stringContaining("just came online"));
    expect(updateStateMock).toHaveBeenCalledWith(
      expect.objectContaining({ lastKnownUp: true, statusMessageId: "existing-id" }),
    );
  });

  it("posts a transition message when the server just went offline", async () => {
    serverControlStatusMock.mockResolvedValue({ ok: true, status: { running: false } });
    getStateMock.mockResolvedValue({ lastKnownUp: true, statusMessageId: "existing-id", serverStartedAt: null });
    statusChannel.messages.fetch.mockResolvedValue({ edit: vi.fn().mockResolvedValue(undefined) });

    await runHeartbeatCheck(client);

    expect(statusChannel.send).toHaveBeenCalledWith(expect.stringContaining("just went offline"));
  });

  it("edits the existing message in place rather than sending a new one when one already exists", async () => {
    const editMock = vi.fn().mockResolvedValue(undefined);
    statusChannel.messages.fetch.mockResolvedValue({ edit: editMock });
    serverControlStatusMock.mockResolvedValue({ ok: true, status: { running: false } });
    getStateMock.mockResolvedValue({ lastKnownUp: false, statusMessageId: "existing-id", serverStartedAt: null });

    await runHeartbeatCheck(client);

    expect(editMock).toHaveBeenCalled();
    expect(statusChannel.send).not.toHaveBeenCalledWith(expect.stringContaining("offline"));
  });

  it("does not touch Discord or the state store on a second check with no transition and unchanged content", async () => {
    serverControlStatusMock.mockResolvedValue({ ok: true, status: { running: false } });
    getStateMock.mockResolvedValue({ lastKnownUp: false, statusMessageId: "existing-id", serverStartedAt: null });
    statusChannel.messages.fetch.mockResolvedValue({ edit: vi.fn().mockResolvedValue(undefined) });

    await runHeartbeatCheck(client); // first check: establishes lastRenderedContent
    statusChannel.messages.fetch.mockClear();
    statusChannel.send.mockClear();
    updateStateMock.mockClear();

    await runHeartbeatCheck(client); // second check: identical snapshot and state

    expect(statusChannel.messages.fetch).not.toHaveBeenCalled();
    expect(statusChannel.send).not.toHaveBeenCalled();
    expect(updateStateMock).not.toHaveBeenCalled();
  });

  it("still updates when content changes even without a running-state transition (e.g. player count)", async () => {
    serverControlStatusMock.mockResolvedValue({ ok: true, status: { running: true, state: "running" } });
    getStateMock.mockResolvedValue({
      lastKnownUp: true,
      statusMessageId: "existing-id",
      serverStartedAt: new Date().toISOString(),
    });
    const editMock = vi.fn().mockResolvedValue(undefined);
    statusChannel.messages.fetch.mockResolvedValue({ edit: editMock });

    sendRconCommandMock.mockResolvedValueOnce({ ok: true, response: "Players: 1" });
    await runHeartbeatCheck(client);

    sendRconCommandMock.mockResolvedValueOnce({ ok: true, response: "Players: 2" });
    await runHeartbeatCheck(client);

    expect(editMock).toHaveBeenCalledTimes(2);
  });
});
