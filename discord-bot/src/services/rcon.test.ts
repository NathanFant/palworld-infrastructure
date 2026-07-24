import { describe, it, expect, vi, beforeEach } from "vitest";

const connectMock = vi.fn();

vi.mock("rcon-client", () => ({
  Rcon: { connect: (...args: unknown[]) => connectMock(...args) },
}));

vi.mock("../config.js", () => ({
  config: {
    rcon: { host: "127.0.0.1", port: 25575, password: "test-password" },
  },
}));

const { sendRconCommand } = await import("./rcon.js");

describe("sendRconCommand", () => {
  beforeEach(() => {
    connectMock.mockReset();
  });

  it("returns ok:true with the response on success", async () => {
    const send = vi.fn().mockResolvedValue("Players: 2");
    const end = vi.fn().mockResolvedValue(undefined);
    connectMock.mockResolvedValue({ send, end });

    const result = await sendRconCommand("ShowPlayers");

    expect(result).toEqual({ ok: true, response: "Players: 2" });
    expect(send).toHaveBeenCalledWith("ShowPlayers");
    expect(end).toHaveBeenCalled();
  });

  it("returns ok:false without throwing when the connection fails", async () => {
    connectMock.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await sendRconCommand("ShowPlayers");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
  });

  it("does not throw even if end() also fails after a successful send", async () => {
    const send = vi.fn().mockResolvedValue("OK");
    const end = vi.fn().mockRejectedValue(new Error("socket already closed"));
    connectMock.mockResolvedValue({ send, end });

    await expect(sendRconCommand("Save")).resolves.toEqual({ ok: true, response: "OK" });
  });
});
