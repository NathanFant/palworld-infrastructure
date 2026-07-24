import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "../config.js";

export interface BotState {
  serverStartedAt: string | null;
  statusMessageId: string | null;
  lastKnownUp: boolean;
}

const DEFAULT_STATE: BotState = {
  serverStartedAt: null,
  statusMessageId: null,
  lastKnownUp: false,
};

function isBotState(value: unknown): value is BotState {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    (typeof v.serverStartedAt === "string" || v.serverStartedAt === null) &&
    (typeof v.statusMessageId === "string" || v.statusMessageId === null) &&
    typeof v.lastKnownUp === "boolean"
  );
}

export async function getState(filePath: string = config.lifecycle.stateFilePath): Promise<BotState> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ...DEFAULT_STATE };
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`State file at ${filePath} contains invalid JSON -- refusing to silently reset it.`);
  }

  if (!isBotState(parsed)) {
    throw new Error(`State file at ${filePath} doesn't match the expected shape -- refusing to silently reset it.`);
  }

  return parsed;
}

export async function updateState(
  partial: Partial<BotState>,
  filePath: string = config.lifecycle.stateFilePath,
): Promise<BotState> {
  const current = await getState(filePath);
  const next: BotState = { ...current, ...partial };

  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  // Atomic write: write to a temp file in the SAME directory (same filesystem is
  // what makes the rename below atomic), then rename over the real path. A crash
  // mid-write leaves an orphaned temp file, never a half-written state.json.
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);
  await fs.writeFile(tempPath, JSON.stringify(next, null, 2), "utf8");
  await fs.rename(tempPath, filePath);

  return next;
}
