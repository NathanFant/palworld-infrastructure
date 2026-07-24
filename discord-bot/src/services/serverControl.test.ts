import { describe, it, expect, vi, beforeEach } from "vitest";

const connectMock = vi.fn();
const execCommandMock = vi.fn();
const disposeMock = vi.fn();

vi.mock("node-ssh", () => ({
  // A `function` expression, not an arrow function -- vi.fn()'s mock is only
  // constructible via `new` (as production code does: `new NodeSSH()`) when its
  // implementation is a real function/class, not an arrow function.
  NodeSSH: vi.fn(function NodeSSHMock() {
    return {
      connect: connectMock,
      execCommand: execCommandMock,
      dispose: disposeMock,
    };
  }),
}));

vi.mock("../config.js", () => ({
  config: {
    gameVm: {
      host: "10.0.1.5",
      sshPort: 22,
      sshUser: "palworld-bot",
      sshPrivateKeyPath: "/fake/key",
    },
  },
}));

const { serverControl } = await import("./serverControl.js");

describe("serverControl", () => {
  beforeEach(() => {
    connectMock.mockReset();
    execCommandMock.mockReset();
    disposeMock.mockReset();
  });

  it("start() runs the 'start' exec command and reports success", async () => {
    connectMock.mockResolvedValue(undefined);
    execCommandMock.mockResolvedValue({ code: 0, stdout: "started", stderr: "" });

    const result = await serverControl.start();

    expect(execCommandMock).toHaveBeenCalledWith("start");
    expect(result).toEqual({ ok: true, stdout: "started", stderr: "" });
    expect(disposeMock).toHaveBeenCalled();
  });

  it("stop() runs the 'stop' exec command", async () => {
    connectMock.mockResolvedValue(undefined);
    execCommandMock.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

    await serverControl.stop();

    expect(execCommandMock).toHaveBeenCalledWith("stop");
  });

  it("reports ok:false when the remote command exits non-zero", async () => {
    connectMock.mockResolvedValue(undefined);
    execCommandMock.mockResolvedValue({ code: 1, stdout: "", stderr: "compose error" });

    const result = await serverControl.status();

    expect(result.ok).toBe(false);
    expect(result.error).toBe("compose error");
  });

  it("returns ok:false without throwing when the SSH connection fails", async () => {
    connectMock.mockRejectedValue(new Error("connect ETIMEDOUT"));

    const result = await serverControl.status();

    expect(result.ok).toBe(false);
    expect(result.error).toContain("ETIMEDOUT");
    expect(disposeMock).toHaveBeenCalled();
  });

  it("status() parses a single running-container JSON line from docker compose ps", async () => {
    connectMock.mockResolvedValue(undefined);
    execCommandMock.mockResolvedValue({
      code: 0,
      stdout: JSON.stringify({ Name: "palworld", State: "running" }),
      stderr: "",
    });

    const result = await serverControl.status();

    expect(execCommandMock).toHaveBeenCalledWith("status");
    expect(result).toEqual({ ok: true, status: { running: true, state: "running" } });
  });

  it("status() reports not running when docker compose ps returns nothing (container absent)", async () => {
    connectMock.mockResolvedValue(undefined);
    execCommandMock.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

    const result = await serverControl.status();

    expect(result).toEqual({ ok: true, status: { running: false } });
  });

  it("status() reports not running (without throwing) if the output isn't valid JSON", async () => {
    connectMock.mockResolvedValue(undefined);
    execCommandMock.mockResolvedValue({ code: 0, stdout: "not json", stderr: "" });

    const result = await serverControl.status();

    expect(result).toEqual({ ok: true, status: { running: false } });
  });
});
