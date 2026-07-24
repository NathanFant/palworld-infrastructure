import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sendRconCommandMock = vi.fn();
const serverControlStartMock = vi.fn();
const serverControlStopMock = vi.fn();
const serverControlStatusMock = vi.fn();
const updateStateMock = vi.fn();

vi.mock("../config.js", () => ({
  config: {
    discord: { adminRoleId: "admin-role-id" },
  },
}));

vi.mock("../services/rcon.js", () => ({
  sendRconCommand: (...args: unknown[]) => sendRconCommandMock(...args),
}));

vi.mock("../services/serverControl.js", () => ({
  serverControl: {
    start: (...args: unknown[]) => serverControlStartMock(...args),
    stop: (...args: unknown[]) => serverControlStopMock(...args),
    status: (...args: unknown[]) => serverControlStatusMock(...args),
  },
}));

vi.mock("../services/stateStore.js", () => ({
  updateState: (...args: unknown[]) => updateStateMock(...args),
}));

const { execute } = await import("./server.js");

interface FakeInteraction {
  inCachedGuild: () => boolean;
  member: { roles: { cache: { has: (id: string) => boolean } } };
  options: { getSubcommand: () => string };
  reply: ReturnType<typeof vi.fn>;
  editReply: ReturnType<typeof vi.fn>;
  followUp: ReturnType<typeof vi.fn>;
  replied: boolean;
  deferred: boolean;
}

function createInteraction(subcommand: string, isAdmin = true): FakeInteraction {
  return {
    inCachedGuild: () => true,
    member: {
      roles: {
        cache: { has: (id: string) => (isAdmin ? id === "admin-role-id" : false) },
      },
    },
    options: { getSubcommand: () => subcommand },
    reply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
    replied: false,
    deferred: false,
  };
}

beforeEach(() => {
  sendRconCommandMock.mockReset().mockResolvedValue({ ok: true, response: "" });
  serverControlStartMock.mockReset();
  serverControlStopMock.mockReset();
  serverControlStatusMock.mockReset();
  updateStateMock.mockReset().mockResolvedValue(undefined);
});

describe("server command: permission gate", () => {
  it("refuses non-admins without touching any service", async () => {
    const interaction = createInteraction("start", false);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await execute(interaction as any);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("permission") }),
    );
    expect(serverControlStartMock).not.toHaveBeenCalled();
  });
});

describe("server command: /server start", () => {
  it("does nothing but reply if the server is already running", async () => {
    serverControlStatusMock.mockResolvedValue({ ok: true, status: { running: true, state: "running" } });
    const interaction = createInteraction("start");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await execute(interaction as any);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("already running") }),
    );
    expect(serverControlStartMock).not.toHaveBeenCalled();
  });

  it("starts the server, waits for it to come up, and records state", async () => {
    serverControlStatusMock
      .mockResolvedValueOnce({ ok: true, status: { running: false } }) // pre-check
      .mockResolvedValueOnce({ ok: true, status: { running: true, state: "running" } }); // first poll succeeds immediately
    serverControlStartMock.mockResolvedValue({ ok: true, stdout: "", stderr: "" });
    const interaction = createInteraction("start");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await execute(interaction as any);

    expect(serverControlStartMock).toHaveBeenCalled();
    expect(updateStateMock).toHaveBeenCalledWith(
      expect.objectContaining({ lastKnownUp: true, serverStartedAt: expect.any(String) }),
    );
    expect(interaction.editReply).toHaveBeenLastCalledWith(expect.stringContaining("online"));
  });

  it("reports a clear failure if the SSH start command itself fails", async () => {
    serverControlStatusMock.mockResolvedValue({ ok: true, status: { running: false } });
    serverControlStartMock.mockResolvedValue({ ok: false, error: "connect ETIMEDOUT" });
    const interaction = createInteraction("start");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await execute(interaction as any);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining("ETIMEDOUT"));
    expect(updateStateMock).not.toHaveBeenCalled();
  });

  it("reports a timeout if the server never comes up", async () => {
    vi.useFakeTimers();
    try {
      serverControlStatusMock.mockResolvedValue({ ok: true, status: { running: false } });
      serverControlStartMock.mockResolvedValue({ ok: true, stdout: "", stderr: "" });
      const interaction = createInteraction("start");

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const done = execute(interaction as any);
      await vi.advanceTimersByTimeAsync(4 * 60 * 1_000); // past the 3-minute poll timeout
      await done;

      expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining("didn't come up"));
      expect(updateStateMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("server command: /server stop", () => {
  it("saves via RCON, stops the server, and records state", async () => {
    serverControlStopMock.mockResolvedValue({ ok: true, stdout: "", stderr: "" });
    const interaction = createInteraction("stop");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await execute(interaction as any);

    expect(sendRconCommandMock).toHaveBeenCalledWith("Save");
    expect(serverControlStopMock).toHaveBeenCalled();
    expect(updateStateMock).toHaveBeenCalledWith({ lastKnownUp: false });
    expect(interaction.editReply).toHaveBeenLastCalledWith(expect.stringContaining("stopped"));
  });

  it("reports a clear failure if stopping fails", async () => {
    serverControlStopMock.mockResolvedValue({ ok: false, stderr: "compose error" });
    const interaction = createInteraction("stop");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await execute(interaction as any);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining("compose error"));
    expect(updateStateMock).not.toHaveBeenCalled();
  });
});

describe("server command: /server status", () => {
  it("reports offline when the server isn't running", async () => {
    serverControlStatusMock.mockResolvedValue({ ok: true, status: { running: false } });
    const interaction = createInteraction("status");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await execute(interaction as any);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("offline") }));
    expect(sendRconCommandMock).not.toHaveBeenCalled();
  });

  it("reports online with player info when running", async () => {
    serverControlStatusMock.mockResolvedValue({ ok: true, status: { running: true, state: "running" } });
    sendRconCommandMock.mockResolvedValue({ ok: true, response: "Players: 2" });
    const interaction = createInteraction("status");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await execute(interaction as any);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("Players: 2") }),
    );
  });
});

describe("server command: /server restart", () => {
  it("saves, stops, starts, waits for healthy, and records state", async () => {
    serverControlStopMock.mockResolvedValue({ ok: true, stdout: "", stderr: "" });
    serverControlStartMock.mockResolvedValue({ ok: true, stdout: "", stderr: "" });
    serverControlStatusMock.mockResolvedValue({ ok: true, status: { running: true, state: "running" } });
    const interaction = createInteraction("restart");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await execute(interaction as any);

    expect(sendRconCommandMock).toHaveBeenCalledWith("Save");
    expect(serverControlStopMock).toHaveBeenCalled();
    expect(serverControlStartMock).toHaveBeenCalled();
    expect(updateStateMock).toHaveBeenCalledWith(
      expect.objectContaining({ lastKnownUp: true, serverStartedAt: expect.any(String) }),
    );
    expect(interaction.editReply).toHaveBeenLastCalledWith(expect.stringContaining("restarted"));
  });

  it("bails out with a clear message if the stop step fails, and never attempts to start", async () => {
    serverControlStopMock.mockResolvedValue({ ok: false, stderr: "compose stop error" });
    const interaction = createInteraction("restart");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await execute(interaction as any);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining("compose stop error"));
    expect(serverControlStartMock).not.toHaveBeenCalled();
    expect(updateStateMock).not.toHaveBeenCalled();
  });

  it("bails out with a clear message if the start step fails after a successful stop", async () => {
    serverControlStopMock.mockResolvedValue({ ok: true, stdout: "", stderr: "" });
    serverControlStartMock.mockResolvedValue({ ok: false, error: "connect ETIMEDOUT" });
    const interaction = createInteraction("restart");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await execute(interaction as any);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining("ETIMEDOUT"));
    expect(updateStateMock).not.toHaveBeenCalled();
  });

  it("reports a timeout if the server never comes back up after restarting", async () => {
    vi.useFakeTimers();
    try {
      serverControlStopMock.mockResolvedValue({ ok: true, stdout: "", stderr: "" });
      serverControlStartMock.mockResolvedValue({ ok: true, stdout: "", stderr: "" });
      serverControlStatusMock.mockResolvedValue({ ok: true, status: { running: false } });
      const interaction = createInteraction("restart");

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const done = execute(interaction as any);
      await vi.advanceTimersByTimeAsync(4 * 60 * 1_000);
      await done;

      expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining("didn't come up"));
      expect(updateStateMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

afterEach(() => {
  vi.useRealTimers();
});
