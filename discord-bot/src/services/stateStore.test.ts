import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getState, updateState } from "./stateStore.js";

let dir: string;
let filePath: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "palworld-bot-test-"));
  filePath = path.join(dir, "state.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("stateStore", () => {
  it("returns default state when the file doesn't exist yet", async () => {
    const state = await getState(filePath);
    expect(state).toEqual({
      serverStartedAt: null,
      statusMessageId: null,
      voicePresenceMessageId: null,
      lastKnownUp: false,
      restartTriggeredAt: null,
      idleSince: null,
    });
  });

  it("throws on corrupt JSON rather than silently resetting", async () => {
    writeFileSync(filePath, "{not valid json", "utf8");
    await expect(getState(filePath)).rejects.toThrow(/invalid JSON/);
  });

  it("throws when the file doesn't match the expected shape", async () => {
    writeFileSync(filePath, JSON.stringify({ unrelated: true }), "utf8");
    await expect(getState(filePath)).rejects.toThrow(/expected shape/);
  });

  it("updateState merges a partial update and persists it", async () => {
    await updateState({ lastKnownUp: true }, filePath);
    const state = await getState(filePath);
    expect(state.lastKnownUp).toBe(true);
    expect(state.serverStartedAt).toBeNull();
  });

  it("preserves existing fields across successive partial updates", async () => {
    await updateState({ serverStartedAt: "2026-01-01T00:00:00Z" }, filePath);
    await updateState({ lastKnownUp: true }, filePath);
    const state = await getState(filePath);
    expect(state.serverStartedAt).toBe("2026-01-01T00:00:00Z");
    expect(state.lastKnownUp).toBe(true);
  });

  it("writes atomically -- no leftover temp file after a successful write", async () => {
    await updateState({ statusMessageId: "123" }, filePath);
    expect(readdirSync(dir)).toEqual(["state.json"]);
  });

  it("creates the parent directory if it doesn't exist yet", async () => {
    const nestedPath = path.join(dir, "nested", "state.json");
    await updateState({ lastKnownUp: true }, nestedPath);
    const raw = readFileSync(nestedPath, "utf8");
    expect(JSON.parse(raw).lastKnownUp).toBe(true);
  });

  it("serializes concurrent updateState calls without losing any of their updates", async () => {
    // Fired without awaiting between them, on purpose -- this is exactly the "two
    // Discord interactions handled nearly simultaneously" scenario the write queue
    // exists for. Without serialization, each call reads the same starting state
    // and races to write, and whichever rename finishes last wins outright,
    // silently discarding the others' updates.
    await Promise.all([
      updateState({ lastKnownUp: true }, filePath),
      updateState({ statusMessageId: "abc" }, filePath),
      updateState({ serverStartedAt: "2026-01-01T00:00:00Z" }, filePath),
    ]);

    const state = await getState(filePath);
    expect(state).toEqual({
      lastKnownUp: true,
      statusMessageId: "abc",
      voicePresenceMessageId: null,
      serverStartedAt: "2026-01-01T00:00:00Z",
      restartTriggeredAt: null,
      idleSince: null,
    });
  });

  it("leaves no leftover temp files after a batch of concurrent writes", async () => {
    await Promise.all([
      updateState({ lastKnownUp: true }, filePath),
      updateState({ statusMessageId: "abc" }, filePath),
    ]);
    expect(readdirSync(dir)).toEqual(["state.json"]);
  });

  it("keeps the queue moving even if one queued update fails", async () => {
    const badPath = path.join(dir, "state.json");
    writeFileSync(badPath, "{not valid json", "utf8"); // getState() will throw on this

    await expect(updateState({ lastKnownUp: true }, badPath)).rejects.toThrow(/invalid JSON/);

    // Fix the file, then confirm a subsequent update still goes through rather than
    // being permanently stuck behind the failed one.
    writeFileSync(
      badPath,
      JSON.stringify({
        serverStartedAt: null,
        statusMessageId: null,
        voicePresenceMessageId: null,
        lastKnownUp: false,
        restartTriggeredAt: null,
        idleSince: null,
      }),
    );
    const state = await updateState({ lastKnownUp: true }, badPath);
    expect(state.lastKnownUp).toBe(true);
  });
});
