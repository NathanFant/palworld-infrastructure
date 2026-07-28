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
      restartTriggeredAt: null,
      idleSince: null,
      lifecycleEventMessageId: null,
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

  it("fills in defaults for fields missing from an older state file rather than rejecting it", async () => {
    // Simulates a real, already-deployed state.json written before a newer field
    // (lifecycleEventMessageId) existed -- it must not fail validation on the very
    // next read after the new field ships.
    writeFileSync(
      filePath,
      JSON.stringify({
        serverStartedAt: "2026-01-01T00:00:00Z",
        statusMessageId: "abc",
        voicePresenceMessageId: null,
        restartTriggeredAt: null,
        idleSince: null,
      }),
      "utf8",
    );
    const state = await getState(filePath);
    expect(state.lifecycleEventMessageId).toBeNull();
    expect(state.serverStartedAt).toBe("2026-01-01T00:00:00Z");
  });

  it("updateState merges a partial update and persists it", async () => {
    await updateState({ restartTriggeredAt: "2026-01-01T00:00:00Z" }, filePath);
    const state = await getState(filePath);
    expect(state.restartTriggeredAt).toBe("2026-01-01T00:00:00Z");
    expect(state.serverStartedAt).toBeNull();
  });

  it("preserves existing fields across successive partial updates", async () => {
    await updateState({ serverStartedAt: "2026-01-01T00:00:00Z" }, filePath);
    await updateState({ restartTriggeredAt: "2026-01-02T00:00:00Z" }, filePath);
    const state = await getState(filePath);
    expect(state.serverStartedAt).toBe("2026-01-01T00:00:00Z");
    expect(state.restartTriggeredAt).toBe("2026-01-02T00:00:00Z");
  });

  it("writes atomically -- no leftover temp file after a successful write", async () => {
    await updateState({ statusMessageId: "123" }, filePath);
    expect(readdirSync(dir)).toEqual(["state.json"]);
  });

  it("creates the parent directory if it doesn't exist yet", async () => {
    const nestedPath = path.join(dir, "nested", "state.json");
    await updateState({ restartTriggeredAt: "2026-01-01T00:00:00Z" }, nestedPath);
    const raw = readFileSync(nestedPath, "utf8");
    expect(JSON.parse(raw).restartTriggeredAt).toBe("2026-01-01T00:00:00Z");
  });

  it("serializes concurrent updateState calls without losing any of their updates", async () => {
    // Fired without awaiting between them, on purpose -- this is exactly the "two
    // Discord interactions handled nearly simultaneously" scenario the write queue
    // exists for. Without serialization, each call reads the same starting state
    // and races to write, and whichever rename finishes last wins outright,
    // silently discarding the others' updates.
    await Promise.all([
      updateState({ restartTriggeredAt: "2026-01-01T00:00:00Z" }, filePath),
      updateState({ statusMessageId: "abc" }, filePath),
      updateState({ serverStartedAt: "2026-01-02T00:00:00Z" }, filePath),
    ]);

    const state = await getState(filePath);
    expect(state).toEqual({
      restartTriggeredAt: "2026-01-01T00:00:00Z",
      statusMessageId: "abc",
      voicePresenceMessageId: null,
      serverStartedAt: "2026-01-02T00:00:00Z",
      idleSince: null,
      lifecycleEventMessageId: null,
    });
  });

  it("leaves no leftover temp files after a batch of concurrent writes", async () => {
    await Promise.all([
      updateState({ restartTriggeredAt: "2026-01-01T00:00:00Z" }, filePath),
      updateState({ statusMessageId: "abc" }, filePath),
    ]);
    expect(readdirSync(dir)).toEqual(["state.json"]);
  });

  it("keeps the queue moving even if one queued update fails", async () => {
    const badPath = path.join(dir, "state.json");
    writeFileSync(badPath, "{not valid json", "utf8"); // getState() will throw on this

    await expect(updateState({ restartTriggeredAt: "2026-01-01T00:00:00Z" }, badPath)).rejects.toThrow(
      /invalid JSON/,
    );

    // Fix the file, then confirm a subsequent update still goes through rather than
    // being permanently stuck behind the failed one.
    writeFileSync(
      badPath,
      JSON.stringify({
        serverStartedAt: null,
        statusMessageId: null,
        voicePresenceMessageId: null,
        restartTriggeredAt: null,
        idleSince: null,
        lifecycleEventMessageId: null,
      }),
    );
    const state = await updateState({ restartTriggeredAt: "2026-01-01T00:00:00Z" }, badPath);
    expect(state.restartTriggeredAt).toBe("2026-01-01T00:00:00Z");
  });
});
