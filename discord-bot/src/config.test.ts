import { describe, it, expect, beforeEach, vi } from "vitest";

const REQUIRED_VARS: Record<string, string> = {
  DISCORD_BOT_TOKEN: "test-token",
  DISCORD_CLIENT_ID: "test-client-id",
  DISCORD_GUILD_ID: "test-guild-id",
  DISCORD_VOICE_CHANNEL_ID: "test-voice-channel-id",
  DISCORD_STATUS_CHANNEL_ID: "test-status-channel-id",
  DISCORD_ADMIN_ROLE_ID: "test-admin-role-id",
};

function stubAllRequired() {
  for (const [key, value] of Object.entries(REQUIRED_VARS)) {
    vi.stubEnv(key, value);
  }
}

// Re-imports config.ts fresh each time so each test sees its own stubbed env vars,
// not a cached module instance from a previous test.
async function importConfig() {
  vi.resetModules();
  return import("./config.js");
}

describe("config", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not throw merely from being imported, even with nothing set", async () => {
    await expect(importConfig()).resolves.not.toThrow();
  });

  it("throws a clear error when a required field is actually read and its var is missing", async () => {
    stubAllRequired();
    vi.stubEnv("DISCORD_BOT_TOKEN", "");
    const { config } = await importConfig();
    expect(() => config.discord.token).toThrow(/DISCORD_BOT_TOKEN/);
  });

  it("loads successfully when all required vars are set", async () => {
    stubAllRequired();
    const { config } = await importConfig();
    expect(config.discord.token).toBe("test-token");
    expect(config.discord.adminRoleId).toBe("test-admin-role-id");
  });

  it("does not require game VM / RCON vars at boot", async () => {
    stubAllRequired();
    vi.stubEnv("GAME_VM_HOST", "");
    vi.stubEnv("RCON_HOST", "");
    const { config } = await importConfig();
    expect(config.gameVm.host).toBe("");
    expect(config.rcon.host).toBe("");
  });

  it("falls back to documented defaults for optional numeric vars", async () => {
    stubAllRequired();
    vi.stubEnv("RCON_PORT", "");
    vi.stubEnv("GAME_VM_SSH_PORT", "");
    vi.stubEnv("SERVER_RESTART_INTERVAL_HOURS", "");
    const { config } = await importConfig();
    expect(config.rcon.port).toBe(25575);
    expect(config.gameVm.sshPort).toBe(22);
    expect(config.lifecycle.restartIntervalHours).toBe(48);
  });
});
