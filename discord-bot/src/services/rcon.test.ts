import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

// A minimal fake net.Socket: an EventEmitter with the handful of Socket methods
// rcon.ts actually calls. Tests drive it by emitting "connect"/"data"/"error"/"close"
// themselves, standing in for the real TCP server.
class FakeSocket extends EventEmitter {
  public destroyed = false;
  public writes: Buffer[] = [];
  setNoDelay = vi.fn();
  write = vi.fn((buf: Buffer) => {
    this.writes.push(buf);
    return true;
  });
  destroy = vi.fn(() => {
    this.destroyed = true;
  });
}

let fakeSocket: FakeSocket;
const connectMock = vi.fn();

vi.mock("node:net", () => ({
  connect: (...args: unknown[]) => connectMock(...args),
}));

vi.mock("../config.js", () => ({
  config: {
    rcon: { host: "127.0.0.1", port: 25575, password: "test-password" },
  },
}));

const { sendRconCommand, parsePlayerCount } = await import("./rcon.js");

// Mirrors rcon.ts's own encodePacket -- builds a raw Source RCON packet buffer
// for a test to hand back as a simulated server response.
function encodePacket(id: number, type: number, payload: string): Buffer {
  const payloadBuf = Buffer.from(payload, "utf-8");
  const size = 4 + 4 + payloadBuf.length + 2;
  const buf = Buffer.alloc(4 + size);
  buf.writeInt32LE(size, 0);
  buf.writeInt32LE(id, 4);
  buf.writeInt32LE(type, 8);
  payloadBuf.copy(buf, 12);
  buf.writeInt16LE(0, 12 + payloadBuf.length);
  return buf;
}

const SERVERDATA_AUTH_RESPONSE = 2;
const SERVERDATA_RESPONSE_VALUE = 0;

describe("sendRconCommand", () => {
  beforeEach(() => {
    connectMock.mockReset();
    fakeSocket = new FakeSocket();
    connectMock.mockReturnValue(fakeSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("authenticates, sends the command, and returns the response even though the server echoes id=0 instead of the request's id", async () => {
    const resultPromise = sendRconCommand("ShowPlayers");
    fakeSocket.emit("connect");

    // Server's real, observed behavior: auth response id happens to match (both 0),
    // but the command response below is deliberately tagged id=0 regardless of the
    // id=1 the client sent -- the exact mismatch confirmed against the live server.
    fakeSocket.emit("data", encodePacket(0, SERVERDATA_AUTH_RESPONSE, ""));
    fakeSocket.emit("data", encodePacket(0, SERVERDATA_RESPONSE_VALUE, "name,playeruid,steamid\n"));

    const result = await resultPromise;
    expect(result).toEqual({ ok: true, response: "name,playeruid,steamid\n" });
  });

  it("returns ok:false when the server signals auth failure (id=-1)", async () => {
    const resultPromise = sendRconCommand("ShowPlayers");
    fakeSocket.emit("connect");
    fakeSocket.emit("data", encodePacket(-1, SERVERDATA_AUTH_RESPONSE, ""));

    const result = await resultPromise;
    expect(result.ok).toBe(false);
    expect(result.error).toContain("authentication failed");
  });

  it("returns ok:false without throwing when the connection errors", async () => {
    const resultPromise = sendRconCommand("ShowPlayers");
    fakeSocket.emit("error", new Error("ECONNREFUSED"));

    const result = await resultPromise;
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
  });

  it("returns ok:false if the socket closes before any response arrives", async () => {
    const resultPromise = sendRconCommand("ShowPlayers");
    fakeSocket.emit("connect");
    fakeSocket.emit("close");

    const result = await resultPromise;
    expect(result.ok).toBe(false);
  });

  it("handles a response split across multiple data events", async () => {
    const resultPromise = sendRconCommand("ShowPlayers");
    fakeSocket.emit("connect");
    fakeSocket.emit("data", encodePacket(0, SERVERDATA_AUTH_RESPONSE, ""));

    const fullPacket = encodePacket(0, SERVERDATA_RESPONSE_VALUE, "name,playeruid,steamid\n");
    fakeSocket.emit("data", fullPacket.subarray(0, 5));
    fakeSocket.emit("data", fullPacket.subarray(5));

    const result = await resultPromise;
    expect(result).toEqual({ ok: true, response: "name,playeruid,steamid\n" });
  });

  it("returns ok:false when RCON_HOST is not configured", async () => {
    vi.resetModules();
    vi.doMock("../config.js", () => ({ config: { rcon: { host: "", port: 25575, password: "" } } }));
    const { sendRconCommand: sendWithoutHost } = await import("./rcon.js");

    const result = await sendWithoutHost("ShowPlayers");

    expect(result).toEqual({ ok: false, error: "RCON_HOST is not configured" });
  });
});

describe("parsePlayerCount", () => {
  it("counts zero players for a header-only response", () => {
    expect(parsePlayerCount("name,playeruid,steamid")).toBe(0);
  });

  it("counts zero players for a completely empty response", () => {
    expect(parsePlayerCount("")).toBe(0);
  });

  it("counts one player row after the header", () => {
    expect(parsePlayerCount("name,playeruid,steamid\nAlice,123,456")).toBe(1);
  });

  it("counts multiple player rows", () => {
    expect(parsePlayerCount("name,playeruid,steamid\nAlice,1,2\nBob,3,4")).toBe(2);
  });

  it("ignores blank lines and surrounding whitespace", () => {
    expect(parsePlayerCount("name,playeruid,steamid\n\nAlice,1,2\n \nBob,3,4\n")).toBe(2);
  });
});
