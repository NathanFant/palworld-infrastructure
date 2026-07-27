import { describe, it, expect, vi, beforeEach } from "vitest";

const configMock = {
  discord: { statusChannelId: "status-channel-id" },
  lifecycle: { idleShutdownEnabled: true, idleShutdownMinutes: 15 },
};

vi.mock("../config.js", () => ({ config: configMock }));

const sendRconCommandMock = vi.fn();
const serverControlStatusMock = vi.fn();
const serverControlStopMock = vi.fn();
const getStateMock = vi.fn();
const updateStateMock = vi.fn();

vi.mock("./rcon.js", () => ({
  sendRconCommand: (...args: unknown[]) => sendRconCommandMock(...args),
  // Real implementation, not a mock -- idleShutdownManager.ts's own logic
  // (idle-timer start/clear/threshold) is what these tests exercise, and that
  // logic depends on parsePlayerCount actually parsing correctly. parsePlayerCount
  // itself has its own dedicated tests in rcon.test.ts.
  parsePlayerCount: (response: string) => {
    const lines = response
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    return Math.max(0, lines.length - 1);
  },
}));

vi.mock("./serverControl.js", () => ({
  serverControl: {
    status: (...args: unknown[]) => serverControlStatusMock(...args),
    stop: (...args: unknown[]) => serverControlStopMock(...args),
  },
}));

vi.mock("./stateStore.js", () => ({
  getState: (...args: unknown[]) => getStateMock(...args),
  updateState: (...args: unknown[]) => updateStateMock(...args),
}));

let statusChannel: { isSendable: () => boolean; send: ReturnType<typeof vi.fn> };
let client: { channels: { fetch: ReturnType<typeof vi.fn> } };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let runIdleCheck: (client: any) => Promise<void>;

beforeEach(async () => {
  vi.resetModules();
  configMock.lifecycle = { idleShutdownEnabled: true, idleShutdownMinutes: 15 };
  sendRconCommandMock.mockReset().mockResolvedValue({ ok: true, response: "name,playeruid,steamid" });
  serverControlStatusMock.mockReset();
  serverControlStopMock.mockReset().mockResolvedValue({ ok: true });
  getStateMock.mockReset();
  updateStateMock.mockReset().mockResolvedValue(undefined);

  statusChannel = { isSendable: () => true, send: vi.fn().mockResolvedValue({ id: "msg-id" }) };
  client = { channels: { fetch: vi.fn().mockResolvedValue(statusChannel) } };

  ({ runIdleCheck } = await import("./idleShutdownManager.js"));
});

describe("runIdleCheck", () => {
  it("does nothing when the feature flag is disabled", async () => {
    configMock.lifecycle = { idleShutdownEnabled: false, idleShutdownMinutes: 15 };
    await runIdleCheck(client);
    expect(serverControlStatusMock).not.toHaveBeenCalled();
  });

  it("clears a stale idle timer when the server isn't running", async () => {
    serverControlStatusMock.mockResolvedValue({ ok: true, status: { running: false } });
    getStateMock.mockResolvedValue({ idleSince: new Date().toISOString() });

    await runIdleCheck(client);

    expect(updateStateMock).toHaveBeenCalledWith({ idleSince: null });
    expect(serverControlStopMock).not.toHaveBeenCalled();
  });

  it("does not touch state when the server isn't running and no idle timer is set", async () => {
    serverControlStatusMock.mockResolvedValue({ ok: true, status: { running: false } });
    getStateMock.mockResolvedValue({ idleSince: null });

    await runIdleCheck(client);

    expect(updateStateMock).not.toHaveBeenCalled();
  });

  it("clears the idle timer once a player is seen again", async () => {
    serverControlStatusMock.mockResolvedValue({ ok: true, status: { running: true } });
    sendRconCommandMock.mockResolvedValue({ ok: true, response: "name,playeruid,steamid\nAlice,1,2" });
    getStateMock.mockResolvedValue({ idleSince: new Date().toISOString() });

    await runIdleCheck(client);

    expect(updateStateMock).toHaveBeenCalledWith({ idleSince: null });
    expect(serverControlStopMock).not.toHaveBeenCalled();
  });

  it("starts the idle timer the first tick nobody is connected", async () => {
    serverControlStatusMock.mockResolvedValue({ ok: true, status: { running: true } });
    sendRconCommandMock.mockResolvedValue({ ok: true, response: "name,playeruid,steamid" });
    getStateMock.mockResolvedValue({ idleSince: null });

    await runIdleCheck(client);

    expect(updateStateMock).toHaveBeenCalledWith({ idleSince: expect.any(String) });
    expect(serverControlStopMock).not.toHaveBeenCalled();
  });

  it("does not stop the server before the idle threshold elapses", async () => {
    serverControlStatusMock.mockResolvedValue({ ok: true, status: { running: true } });
    sendRconCommandMock.mockResolvedValue({ ok: true, response: "name,playeruid,steamid" });
    const almostFifteenMinutesAgo = new Date(Date.now() - 14 * 60 * 1000).toISOString();
    getStateMock.mockResolvedValue({ idleSince: almostFifteenMinutesAgo });

    await runIdleCheck(client);

    expect(serverControlStopMock).not.toHaveBeenCalled();
    expect(updateStateMock).not.toHaveBeenCalled();
  });

  it("saves, stops, and announces once the idle threshold is exceeded", async () => {
    serverControlStatusMock.mockResolvedValue({ ok: true, status: { running: true } });
    const overFifteenMinutesAgo = new Date(Date.now() - 16 * 60 * 1000).toISOString();
    getStateMock.mockResolvedValue({ idleSince: overFifteenMinutesAgo });
    sendRconCommandMock
      .mockResolvedValueOnce({ ok: true, response: "name,playeruid,steamid" }) // ShowPlayers
      .mockResolvedValueOnce({ ok: true, response: "Saved" }); // Save

    await runIdleCheck(client);

    expect(sendRconCommandMock).toHaveBeenCalledWith("Save");
    expect(serverControlStopMock).toHaveBeenCalled();
    expect(updateStateMock).toHaveBeenCalledWith({ lastKnownUp: false, restartTriggeredAt: null, idleSince: null });
    expect(statusChannel.send).toHaveBeenCalledWith(expect.stringContaining("15 minutes"));
  });

  it("does not update state if the stop command fails", async () => {
    serverControlStatusMock.mockResolvedValue({ ok: true, status: { running: true } });
    const overFifteenMinutesAgo = new Date(Date.now() - 16 * 60 * 1000).toISOString();
    getStateMock.mockResolvedValue({ idleSince: overFifteenMinutesAgo });
    sendRconCommandMock.mockResolvedValue({ ok: true, response: "name,playeruid,steamid" });
    serverControlStopMock.mockResolvedValue({ ok: false, error: "ssh failed" });

    await runIdleCheck(client);

    expect(updateStateMock).not.toHaveBeenCalled();
    expect(statusChannel.send).not.toHaveBeenCalled();
  });

  it("does not guess when ShowPlayers itself fails -- tries again next tick instead", async () => {
    serverControlStatusMock.mockResolvedValue({ ok: true, status: { running: true } });
    sendRconCommandMock.mockResolvedValue({ ok: false, error: "rcon unreachable" });
    getStateMock.mockResolvedValue({ idleSince: null });

    await runIdleCheck(client);

    expect(updateStateMock).not.toHaveBeenCalled();
  });
});
