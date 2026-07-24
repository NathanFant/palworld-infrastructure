import { NodeSSH } from "node-ssh";
import { config } from "../config.js";

export interface ServerControlResult {
  ok: boolean;
  stdout?: string;
  stderr?: string;
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
    ssh.dispose();
  }
}

export const serverControl = {
  start: () => runPalworldCtl("start"),
  stop: () => runPalworldCtl("stop"),
  status: () => runPalworldCtl("status"),
};
