import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../config.js", () => ({
  config: {
    discord: { statusChannelId: "status-channel-id" },
    lifecycle: { restartIntervalHours: 48 },
  },
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
  send: ReturnType<typeof vi.fn>;
}

const HOUR_MS = 60 * 60 * 1000;
const RESTART_WARNING_MS = 5 * 60 * 1000;

let statusChannel: FakeStatusChannel;
let client: { channels: { fetch: ReturnType<typeof vi.fn> } };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let runLifecycleCheck: (client: any) => Promise<void>;

beforeEach(async () => {
  vi.resetModules();
  sendRconCommandMock.mockReset().mockResolvedValue({ ok: true, response: "" });
  serverControlStatusMock.mockReset();
  getStateMock.mockReset();
  updateStateMock.mockReset().mockResolvedValue(undefined);

  statusChannel = { isSendable: () => true, send: vi.fn().mockResolvedValue({ id: "msg-id" }) };
  client = { channels: { fetch: vi.fn().mockResolvedValue(statusChannel) } };

  ({ runLifecycleCheck } = await import("./lifecycleManager.js"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("runLifecycleCheck: triggering a restart", () => {
  it("does nothing when well within the 48h window", async () => {
    getStateMock.mockResolvedValue({
      serverStartedAt: new Date(Date.now() - 1 * HOUR_MS).toISOString(),
      restartTriggeredAt: null,
    });

    await runLifecycleCheck(client);

    expect(sendRconCommandMock).not.toHaveBeenCalled();
    expect(updateStateMock).not.toHaveBeenCalled();
  });

  it("does nothing when serverStartedAt has never been recorded", async () => {
    getStateMock.mockResolvedValue({ serverStartedAt: null, restartTriggeredAt: null });

    await runLifecycleCheck(client);

    expect(serverControlStatusMock).not.toHaveBeenCalled();
    expect(sendRconCommandMock).not.toHaveBeenCalled();
  });

  it("sends the RCON Shutdown countdown and mirrors it to Discord once inside the warning window", async () => {
    getStateMock.mockResolvedValue({
      serverStartedAt: new Date(Date.now() - (48 * HOUR_MS - RESTART_WARNING_MS + 1000)).toISOString(),
      restartTriggeredAt: null,
    });
    serverControlStatusMock.mockResolvedValue({ ok: true, status: { running: true, state: "running" } });

    await runLifecycleCheck(client);

    expect(sendRconCommandMock).toHaveBeenCalledWith(expect.stringMatching(/^Shutdown 300 /));
    expect(statusChannel.send).toHaveBeenCalledWith(expect.stringContaining("restart"));
    expect(updateStateMock).toHaveBeenCalledWith({ restartTriggeredAt: expect.any(String) });
  });

  it("does not trigger a restart if the server isn't currently running", async () => {
    getStateMock.mockResolvedValue({
      serverStartedAt: new Date(Date.now() - 48 * HOUR_MS).toISOString(),
      restartTriggeredAt: null,
    });
    serverControlStatusMock.mockResolvedValue({ ok: true, status: { running: false } });

    await runLifecycleCheck(client);

    expect(sendRconCommandMock).not.toHaveBeenCalled();
    expect(updateStateMock).not.toHaveBeenCalled();
  });

  it("does not record a trigger if the RCON Shutdown command fails", async () => {
    getStateMock.mockResolvedValue({
      serverStartedAt: new Date(Date.now() - 48 * HOUR_MS).toISOString(),
      restartTriggeredAt: null,
    });
    serverControlStatusMock.mockResolvedValue({ ok: true, status: { running: true, state: "running" } });
    sendRconCommandMock.mockResolvedValue({ ok: false, error: "connect ETIMEDOUT" });

    await runLifecycleCheck(client);

    expect(updateStateMock).not.toHaveBeenCalled();
    expect(statusChannel.send).not.toHaveBeenCalled();
  });
});

describe("runLifecycleCheck: detecting restart completion", () => {
  it("keeps waiting while still inside the expected shutdown/reboot window", async () => {
    getStateMock.mockResolvedValue({
      serverStartedAt: new Date(Date.now() - 48 * HOUR_MS).toISOString(),
      restartTriggeredAt: new Date(Date.now() - 1000).toISOString(),
    });

    await runLifecycleCheck(client);

    expect(serverControlStatusMock).not.toHaveBeenCalled();
    expect(updateStateMock).not.toHaveBeenCalled();
  });

  it("keeps waiting past the expected window if the server isn't back up yet", async () => {
    getStateMock.mockResolvedValue({
      serverStartedAt: new Date(Date.now() - 48 * HOUR_MS).toISOString(),
      restartTriggeredAt: new Date(Date.now() - (RESTART_WARNING_MS + 6 * 60 * 1000)).toISOString(),
    });
    serverControlStatusMock.mockResolvedValue({ ok: true, status: { running: false } });

    await runLifecycleCheck(client);

    expect(updateStateMock).not.toHaveBeenCalled();
    expect(statusChannel.send).not.toHaveBeenCalled();
  });

  it("clears restartTriggeredAt, resets serverStartedAt, and announces completion once back online", async () => {
    getStateMock.mockResolvedValue({
      serverStartedAt: new Date(Date.now() - 48 * HOUR_MS).toISOString(),
      restartTriggeredAt: new Date(Date.now() - (RESTART_WARNING_MS + 6 * 60 * 1000)).toISOString(),
    });
    serverControlStatusMock.mockResolvedValue({ ok: true, status: { running: true, state: "running" } });

    await runLifecycleCheck(client);

    expect(updateStateMock).toHaveBeenCalledWith({
      serverStartedAt: expect.any(String),
      restartTriggeredAt: null,
      lastKnownUp: true,
    });
    expect(statusChannel.send).toHaveBeenCalledWith(expect.stringContaining("restart complete"));
  });

  it("never sends another RCON Shutdown command while a restart is already pending", async () => {
    getStateMock.mockResolvedValue({
      serverStartedAt: new Date(Date.now() - 48 * HOUR_MS).toISOString(),
      restartTriggeredAt: new Date(Date.now() - 1000).toISOString(),
    });

    await runLifecycleCheck(client);

    expect(sendRconCommandMock).not.toHaveBeenCalled();
  });
});

describe("runLifecycleCheck: concurrency", () => {
  it("serializes overlapping checks against the same evolving state", async () => {
    // Stateful mocks, not static return values -- exercises the actual race: without
    // serialization, two overlapping calls could both read serverStartedAt from
    // before the first call's trigger and send the RCON Shutdown command twice.
    let persisted = {
      serverStartedAt: new Date(Date.now() - 48 * HOUR_MS).toISOString(),
      restartTriggeredAt: null as string | null,
    };
    getStateMock.mockImplementation(() => Promise.resolve({ ...persisted }));
    updateStateMock.mockImplementation((partial: Partial<typeof persisted>) => {
      persisted = { ...persisted, ...partial };
      return Promise.resolve(persisted);
    });
    serverControlStatusMock.mockResolvedValue({ ok: true, status: { running: true, state: "running" } });

    await Promise.all([runLifecycleCheck(client), runLifecycleCheck(client)]);

    expect(sendRconCommandMock).toHaveBeenCalledTimes(1);
  });
});
