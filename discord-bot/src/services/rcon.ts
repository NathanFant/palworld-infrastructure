import { Rcon } from "rcon-client";
import { config } from "../config.js";

export interface RconResult {
  ok: boolean;
  response?: string;
  error?: string;
}

// The server being unreachable is an expected, frequent state -- this project's
// whole point is that the game server is intentionally not running 24/7 (see
// CLAUDE.md's operational philosophy). Callers get a typed result, never a thrown
// exception, so a routine "server's off right now" doesn't need try/catch at every
// call site or risk crashing the bot process.
export async function sendRconCommand(command: string): Promise<RconResult> {
  if (!config.rcon.host) {
    return { ok: false, error: "RCON_HOST is not configured" };
  }

  let rcon: Rcon | undefined;
  try {
    rcon = await Rcon.connect({
      host: config.rcon.host,
      port: config.rcon.port,
      password: config.rcon.password,
    });
    const response = await rcon.send(command);
    return { ok: true, response };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    await rcon?.end().catch(() => {
      // Already disconnected or never fully connected -- nothing more to clean up.
    });
  }
}
