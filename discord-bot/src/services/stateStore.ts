import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { config } from "../config.js";

export interface BotState {
  serverStartedAt: string | null;
  statusMessageId: string | null;
  /** Live-edited "who's in voice" message -- separate from statusMessageId (the
   * server up/down heartbeat's own message) so the two features never clobber
   * each other's message. */
  voicePresenceMessageId: string | null;
  /** Set when the lifecycle manager has triggered the RCON Shutdown countdown for a
   * scheduled 48h restart, so it doesn't retrigger every check during the lead-time
   * window. Cleared once the restart cycle completes, or by any manual
   * /server start|stop|restart. */
  restartTriggeredAt: string | null;
  /** Set the first time the idle-shutdown manager observes a running server with
   * zero players; cleared as soon as a player is seen again or the server stops.
   * Once (now - idleSince) exceeds config.lifecycle.idleShutdownMinutes, the server
   * is auto-stopped. Null whenever idleness isn't currently being tracked. */
  idleSince: string | null;
  /** Live-edited "lifecycle event" message (auto-start/auto-stop/scheduled-restart
   * announcements) -- shared across idleShutdownManager.ts, presenceWatcher.ts, and
   * lifecycleManager.ts via announcements.ts's announceLifecycleEvent(), so a burst
   * of these events edits one message in place instead of posting a new one each
   * time. Separate from statusMessageId/voicePresenceMessageId so none of the three
   * clobber each other's message. */
  lifecycleEventMessageId: string | null;
}

const DEFAULT_STATE: BotState = {
  serverStartedAt: null,
  statusMessageId: null,
  voicePresenceMessageId: null,
  restartTriggeredAt: null,
  idleSince: null,
  lifecycleEventMessageId: null,
};

// lifecycleEventMessageId is checked separately (see getState) rather than required
// here, since a real, already-deployed state.json predating that field's addition
// must still validate successfully -- it's filled in with its default rather than
// being treated as a shape mismatch. Every other field stays strictly required:
// this function must still reject a genuinely unrelated/corrupt object outright,
// not just paper over missing fields with defaults across the board.
function isBotState(value: unknown): value is Omit<BotState, "lifecycleEventMessageId"> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    (typeof v.serverStartedAt === "string" || v.serverStartedAt === null) &&
    (typeof v.statusMessageId === "string" || v.statusMessageId === null) &&
    (typeof v.voicePresenceMessageId === "string" || v.voicePresenceMessageId === null) &&
    (typeof v.restartTriggeredAt === "string" || v.restartTriggeredAt === null) &&
    (typeof v.idleSince === "string" || v.idleSince === null)
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

  const withLifecycleField = parsed as Partial<Pick<BotState, "lifecycleEventMessageId">>;
  const lifecycleEventMessageId =
    typeof withLifecycleField.lifecycleEventMessageId === "string" ||
    withLifecycleField.lifecycleEventMessageId === null
      ? withLifecycleField.lifecycleEventMessageId
      : null;

  return { ...parsed, lifecycleEventMessageId };
}

// Serializes updateState() calls per file path -- without this, two overlapping
// calls (e.g. two Discord interactions handled nearly simultaneously) would both
// read the same "current" state, merge independently, and race to write: the
// second rename to complete silently wins, discarding the first call's update.
// Keyed by resolved path so unrelated state files (e.g. in tests) never block
// each other.
const writeQueues = new Map<string, Promise<unknown>>();

export async function updateState(
  partial: Partial<BotState>,
  filePath: string = config.lifecycle.stateFilePath,
): Promise<BotState> {
  const key = path.resolve(filePath);
  const previous = writeQueues.get(key) ?? Promise.resolve();

  const task = previous.then(async () => {
    const current = await getState(filePath);
    const next: BotState = { ...current, ...partial };

    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    // Atomic write: write to a temp file in the SAME directory (same filesystem is
    // what makes the rename below atomic), then rename over the real path. A crash
    // mid-write leaves an orphaned temp file, never a half-written state.json.
    // Unique per call (not just per-process) so queued-but-not-yet-awaited calls
    // can never collide on the same temp path even if the queueing above were ever
    // bypassed.
    const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
    await fs.writeFile(tempPath, JSON.stringify(next, null, 2), "utf8");
    await fs.rename(tempPath, filePath);

    return next;
  });

  // Keep the queue advancing even if this call fails, so one rejected update
  // doesn't permanently wedge every future update to the same file.
  writeQueues.set(
    key,
    task.catch(() => undefined),
  );

  return task;
}
