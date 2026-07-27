import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../config.js", () => ({
  config: {
    discord: { statusChannelId: "status-channel-id" },
    palworld: { publicHost: "203.0.113.10", publicPort: 8211, serverPassword: "apex" },
  },
}));

const sendRconCommandMock = vi.fn();
const serverControlStatusMock = vi.fn();
const getStateMock = vi.fn();
const updateStateMock = vi.fn();

vi.mock("./rcon.js", () => ({
  sendRconCommand: (...args: unknown[]) => sendRconCommandMock(...args),
  // Real implementation (not a mock) -- these tests exercise statusHeartbeat.ts's
  // own rendering logic against realistic ShowPlayers-shaped responses.
  // parsePlayerCount itself has its own dedicated tests in rcon.test.ts.
  parsePlayerCount: (response: string) => {
    const lines = response
      .split("\n")
      .map((line: string) => line.trim())
      .filter((line: string) => line.length > 0);
    return Math.max(0, lines.length - 1);
  },
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

// Every fetched/sent message needs `pinned`/`pin` now that upsertStatusMessage pins
// the status message on first creation (see statusHeartbeat.ts's pinIfNeeded) --
// this is what makes the message findable without needing to scroll back through
// the channel's history, since edits alone don't surface as new/unread in Discord.
function fakeMessage(overrides: { edit?: ReturnType<typeof vi.fn>; pinned?: boolean } = {}) {
  return {
    edit: overrides.edit ?? vi.fn().mockResolvedValue(undefined),
    pinned: overrides.pinned ?? false,
    pin: vi.fn().mockResolvedValue(undefined),
  };
}

let statusChannel: FakeStatusChannel;
let client: { channels: { fetch: ReturnType<typeof vi.fn> } };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let runHeartbeatCheck: (client: any) => Promise<void>;

beforeEach(async () => {
  vi.resetModules();
  sendRconCommandMock.mockReset().mockResolvedValue({ ok: true, response: "name,playeruid,steamid" });
  serverControlStatusMock.mockReset();
  getStateMock.mockReset();
  updateStateMock.mockReset().mockResolvedValue(undefined);

  statusChannel = {
    isSendable: () => true,
    messages: { fetch: vi.fn() },
    send: vi.fn().mockResolvedValue({ id: "new-message-id", pinned: false, pin: vi.fn().mockResolvedValue(undefined) }),
  };
  client = { channels: { fetch: vi.fn().mockResolvedValue(statusChannel) } };

  ({ runHeartbeatCheck } = await import("./statusHeartbeat.js"));
});

describe("runHeartbeatCheck", () => {
  it("sends a fresh status message and pins it on the very first check", async () => {
    serverControlStatusMock.mockResolvedValue({ ok: true, status: { running: false } });
    getStateMock.mockResolvedValue({ lastKnownUp: false, statusMessageId: null, serverStartedAt: null });

    await runHeartbeatCheck(client);

    expect(statusChannel.send).toHaveBeenCalledWith(expect.stringContaining("offline"));
    expect(statusChannel.send).toHaveBeenCalledTimes(1);
    const sentMessage = await statusChannel.send.mock.results[0].value;
    expect(sentMessage.pin).toHaveBeenCalled();
    expect(updateStateMock).toHaveBeenCalledWith({ lastKnownUp: false, statusMessageId: "new-message-id" });
  });

  it("edits the existing message in place when the server comes online, without sending a second message", async () => {
    serverControlStatusMock.mockResolvedValue({
      ok: true,
      status: { running: true, state: "running", health: "healthy" },
    });
    getStateMock.mockResolvedValue({
      lastKnownUp: false,
      statusMessageId: "existing-id",
      serverStartedAt: new Date().toISOString(),
    });
    const editMock = vi.fn().mockResolvedValue(undefined);
    const message = fakeMessage({ edit: editMock });
    statusChannel.messages.fetch.mockResolvedValue(message);

    await runHeartbeatCheck(client);

    expect(editMock).toHaveBeenCalledWith(expect.stringContaining("online"));
    expect(editMock).toHaveBeenCalledWith(expect.stringContaining("Connect: 203.0.113.10:8211 (password: apex)"));
    expect(message.pin).toHaveBeenCalled();
    expect(statusChannel.send).not.toHaveBeenCalled();
    expect(updateStateMock).toHaveBeenCalledWith(
      expect.objectContaining({ lastKnownUp: true, statusMessageId: "existing-id" }),
    );
  });

  it("renders yellow (starting) when the container is running but not yet healthy", async () => {
    serverControlStatusMock.mockResolvedValue({
      ok: true,
      status: { running: true, state: "running", health: "starting" },
    });
    getStateMock.mockResolvedValue({ lastKnownUp: false, statusMessageId: "existing-id", serverStartedAt: null });
    const editMock = vi.fn().mockResolvedValue(undefined);
    statusChannel.messages.fetch.mockResolvedValue(fakeMessage({ edit: editMock }));

    await runHeartbeatCheck(client);

    expect(editMock).toHaveBeenCalledWith(expect.stringContaining("starting"));
    // Not yet online, so this shouldn't hit RCON for player info.
    expect(sendRconCommandMock).not.toHaveBeenCalled();
    // Still not "up" from lastKnownUp's perspective until it's actually healthy.
    expect(updateStateMock).toHaveBeenCalledWith(
      expect.objectContaining({ lastKnownUp: true, statusMessageId: "existing-id" }),
    );
  });

  it("edits the existing message in place rather than sending a new one when one already exists", async () => {
    const editMock = vi.fn().mockResolvedValue(undefined);
    statusChannel.messages.fetch.mockResolvedValue(fakeMessage({ edit: editMock }));
    serverControlStatusMock.mockResolvedValue({ ok: true, status: { running: false } });
    getStateMock.mockResolvedValue({ lastKnownUp: false, statusMessageId: "existing-id", serverStartedAt: null });

    await runHeartbeatCheck(client);

    expect(editMock).toHaveBeenCalled();
    expect(statusChannel.send).not.toHaveBeenCalled();
  });

  it("does not re-pin a message that's already pinned", async () => {
    statusChannel.messages.fetch.mockResolvedValue(fakeMessage({ pinned: true }));
    serverControlStatusMock.mockResolvedValue({ ok: true, status: { running: false } });
    getStateMock.mockResolvedValue({ lastKnownUp: false, statusMessageId: "existing-id", serverStartedAt: null });

    await runHeartbeatCheck(client);

    const message = await statusChannel.messages.fetch.mock.results[0].value;
    expect(message.pin).not.toHaveBeenCalled();
  });

  it("does not touch Discord or the state store on a second check with no change in content", async () => {
    serverControlStatusMock.mockResolvedValue({ ok: true, status: { running: false } });
    getStateMock.mockResolvedValue({ lastKnownUp: false, statusMessageId: "existing-id", serverStartedAt: null });
    statusChannel.messages.fetch.mockResolvedValue(fakeMessage());

    await runHeartbeatCheck(client); // first check: establishes lastRenderedContent
    statusChannel.messages.fetch.mockClear();
    statusChannel.send.mockClear();
    updateStateMock.mockClear();

    await runHeartbeatCheck(client); // second check: identical snapshot and state

    expect(statusChannel.messages.fetch).not.toHaveBeenCalled();
    expect(statusChannel.send).not.toHaveBeenCalled();
    expect(updateStateMock).not.toHaveBeenCalled();
  });

  it("still updates when content changes even without an offline/online transition (e.g. player count)", async () => {
    serverControlStatusMock.mockResolvedValue({
      ok: true,
      status: { running: true, state: "running", health: "healthy" },
    });
    getStateMock.mockResolvedValue({
      lastKnownUp: true,
      statusMessageId: "existing-id",
      serverStartedAt: new Date().toISOString(),
    });
    const editMock = vi.fn().mockResolvedValue(undefined);
    statusChannel.messages.fetch.mockResolvedValue(fakeMessage({ edit: editMock }));

    sendRconCommandMock.mockResolvedValueOnce({ ok: true, response: "name,playeruid,steamid\nAlice,1,2" });
    await runHeartbeatCheck(client);

    sendRconCommandMock.mockResolvedValueOnce({ ok: true, response: "name,playeruid,steamid\nAlice,1,2\nBob,3,4" });
    await runHeartbeatCheck(client);

    expect(editMock).toHaveBeenCalledTimes(2);
    expect(editMock).toHaveBeenNthCalledWith(1, expect.stringContaining("Players online: 1"));
    expect(editMock).toHaveBeenNthCalledWith(2, expect.stringContaining("Players online: 2"));
  });

  it("shows zero players online distinctly from an unavailable player count", async () => {
    serverControlStatusMock.mockResolvedValue({
      ok: true,
      status: { running: true, state: "running", health: "healthy" },
    });
    getStateMock.mockResolvedValue({ lastKnownUp: true, statusMessageId: "existing-id", serverStartedAt: null });
    const editMock = vi.fn().mockResolvedValue(undefined);
    statusChannel.messages.fetch.mockResolvedValue(fakeMessage({ edit: editMock }));

    sendRconCommandMock.mockResolvedValueOnce({ ok: true, response: "name,playeruid,steamid" });
    await runHeartbeatCheck(client);

    expect(editMock).toHaveBeenCalledWith(expect.stringContaining("Players online: 0"));
  });

  it("shows the player count as unavailable when ShowPlayers itself fails", async () => {
    serverControlStatusMock.mockResolvedValue({
      ok: true,
      status: { running: true, state: "running", health: "healthy" },
    });
    getStateMock.mockResolvedValue({ lastKnownUp: true, statusMessageId: "existing-id", serverStartedAt: null });
    const editMock = vi.fn().mockResolvedValue(undefined);
    statusChannel.messages.fetch.mockResolvedValue(fakeMessage({ edit: editMock }));

    sendRconCommandMock.mockResolvedValueOnce({ ok: false, error: "rcon unreachable" });
    await runHeartbeatCheck(client);

    expect(editMock).toHaveBeenCalledWith(expect.stringContaining("Players online: (unavailable)"));
  });

  it("serializes concurrent checks so the message is upserted only once", async () => {
    // Stateful mocks (not static return values) -- this is what actually exercises
    // the race: without serialization, two overlapping calls would both read the
    // same starting state (statusMessageId: null) before either write lands, and
    // both would send a new message instead of one editing the other's.
    let persisted = { lastKnownUp: false, statusMessageId: null as string | null, serverStartedAt: null as string | null };
    getStateMock.mockImplementation(() => Promise.resolve({ ...persisted }));
    updateStateMock.mockImplementation((partial: Partial<typeof persisted>) => {
      persisted = { ...persisted, ...partial };
      return Promise.resolve(persisted);
    });
    serverControlStatusMock.mockResolvedValue({
      ok: true,
      status: { running: true, state: "running", health: "healthy" },
    });
    statusChannel.messages.fetch.mockImplementation((id: string) =>
      id === "new-message-id" ? Promise.resolve(fakeMessage()) : Promise.reject(new Error("Unknown Message")),
    );

    await Promise.all([runHeartbeatCheck(client), runHeartbeatCheck(client)]);

    expect(statusChannel.send).toHaveBeenCalledTimes(1);
  });
});
