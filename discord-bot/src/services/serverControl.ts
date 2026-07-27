import { NodeSSH } from "node-ssh";
import { config } from "../config.js";

export interface ServerControlResult {
  ok: boolean;
  stdout?: string;
  stderr?: string;
  error?: string;
}

export interface PalworldContainerStatus {
  running: boolean;
  /** Raw `State` field from `docker compose ps`, e.g. "running", "exited". */
  state?: string;
  /** Raw `Health` field from `docker compose ps --format json`, e.g. "starting",
   * "healthy", "unhealthy" -- reflects the image's own baked-in HEALTHCHECK, which
   * only passes once the game process is actually up (not just the container).
   * Undefined if the service defines no healthcheck at all. */
  health?: string;
}

export interface ServerStatusResult {
  ok: boolean;
  status?: PalworldContainerStatus;
  error?: string;
}

// The remote end enforces a forced command (see infrastructure/cloud-init's
// palworld-ctl setup): whatever string is sent here as the SSH exec command becomes
// $SSH_ORIGINAL_COMMAND on the game VM regardless of what this client requests, and
// palworld-ctl's own case statement is the only thing that ever actually runs.
async function runPalworldCtl(subcommand: "start" | "stop" | "status"): Promise<ServerControlResult> {
  if (!config.gameVm.host || !config.gameVm.sshPrivateKeyPath) {
    return { ok: false, error: "GAME_VM_HOST / GAME_VM_SSH_PRIVATE_KEY_PATH is not configured" };
  }

  const ssh = new NodeSSH();
  try {
    await ssh.connect({
      host: config.gameVm.host,
      port: config.gameVm.sshPort,
      username: config.gameVm.sshUser,
      privateKeyPath: config.gameVm.sshPrivateKeyPath,
    });
    const result = await ssh.execCommand(subcommand);
    return { ok: result.code === 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    try {
      ssh.dispose();
    } catch {
      // Already disconnected or never fully connected -- nothing more to clean up.
    }
  }
}

// `docker compose ps --format json` emits one JSON object per line (JSON Lines),
// not a single JSON array -- and emits nothing at all if the container isn't
// currently up. Only one service is ever defined (docker/compose.yml), so at most
// one line is expected.
function parsePalworldStatus(stdout: string): PalworldContainerStatus {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return { running: false };
  }

  try {
    const parsed = JSON.parse(lines[0]) as { State?: string; Health?: string };
    return { running: parsed.State === "running", state: parsed.State, health: parsed.Health };
  } catch {
    return { running: false };
  }
}

async function getStatus(): Promise<ServerStatusResult> {
  const result = await runPalworldCtl("status");
  if (!result.ok) {
    return { ok: false, error: result.error ?? result.stderr };
  }
  return { ok: true, status: parsePalworldStatus(result.stdout ?? "") };
}

export const serverControl = {
  start: () => runPalworldCtl("start"),
  stop: () => runPalworldCtl("stop"),
  status: getStatus,
};
