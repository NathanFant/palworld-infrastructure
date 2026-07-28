import { connect, type Socket } from "node:net";
import { config } from "../config.js";

export interface RconResult {
  ok: boolean;
  response?: string;
  error?: string;
}

// Palworld's RCON `ShowPlayers` returns a CSV header line ("name,playeruid,steamid")
// followed by one line per connected player, or just the header alone when nobody's
// connected. Shared by idleShutdownManager.ts (idle detection) and
// statusHeartbeat.ts (the displayed player count) rather than each parsing it
// independently.
export function parsePlayerCount(response: string): number {
  const lines = response
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return Math.max(0, lines.length - 1);
}

// A minimal Source RCON protocol client, hand-rolled instead of using the
// `rcon-client` npm package it replaced. Palworld's dedicated server does not echo
// the request packet's own id in its command response -- it always responds with
// id=0, a real deviation from the protocol spec that strict id-matching clients
// (rcon-client included) rely on to pair a response with its request. Confirmed
// directly against the live server: the command genuinely executes and the real
// response payload arrives correctly, just tagged with the wrong id, causing
// spec-compliant clients to wait forever for an id that never comes and time out.
//
// This project only ever has one RCON command in flight at a time (every call site
// awaits sendRconCommand() to completion before the next), so treating "the next
// packet that arrives after our request" as that request's response is correct
// here, without needing to reimplement id-based multi-request pipelining just to
// work around one wrong id.
const SERVERDATA_AUTH = 3;
const SERVERDATA_AUTH_RESPONSE = 2;
const SERVERDATA_EXECCOMMAND = 2;

const CONNECT_TIMEOUT_MS = 5000;
const RESPONSE_TIMEOUT_MS = 5000;

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

interface DecodedPacket {
  id: number;
  type: number;
  payload: string;
}

// Decodes as many complete packets as are present in `buf`, returning them plus
// any leftover bytes that don't yet form a complete packet (a single TCP `data`
// event isn't guaranteed to align with RCON packet boundaries).
function decodePackets(buf: Buffer): { packets: DecodedPacket[]; rest: Buffer } {
  const packets: DecodedPacket[] = [];
  let offset = 0;
  while (offset + 4 <= buf.length) {
    const size = buf.readInt32LE(offset);
    if (offset + 4 + size > buf.length) break;
    const id = buf.readInt32LE(offset + 4);
    const type = buf.readInt32LE(offset + 8);
    const payload = buf.subarray(offset + 12, offset + 4 + size - 2).toString("utf-8");
    packets.push({ id, type, payload });
    offset += 4 + size;
  }
  return { packets, rest: buf.subarray(offset) };
}

function closeSocket(socket: Socket): void {
  if (!socket.destroyed) {
    socket.destroy();
  }
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

  return new Promise<RconResult>((resolve) => {
    let settled = false;
    let buffered: Buffer = Buffer.alloc(0);
    let authenticated = false;

    const finish = (result: RconResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      clearTimeout(responseTimer);
      closeSocket(socket);
      resolve(result);
    };

    const connectTimer = setTimeout(() => {
      finish({ ok: false, error: "Timed out connecting to RCON" });
    }, CONNECT_TIMEOUT_MS);

    let responseTimer: NodeJS.Timeout;

    const socket = connect({ host: config.rcon.host, port: config.rcon.port });
    socket.setNoDelay(true);

    socket.on("error", (error) => {
      finish({ ok: false, error: error.message });
    });

    socket.on("close", () => {
      finish({ ok: false, error: "Connection closed before a response was received" });
    });

    socket.on("connect", () => {
      clearTimeout(connectTimer);
      socket.write(encodePacket(0, SERVERDATA_AUTH, config.rcon.password));
      responseTimer = setTimeout(() => {
        finish({ ok: false, error: "Timed out waiting for RCON auth response" });
      }, RESPONSE_TIMEOUT_MS);
    });

    socket.on("data", (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      const { packets, rest } = decodePackets(buffered);
      buffered = rest;

      for (const packet of packets) {
        if (!authenticated) {
          if (packet.type !== SERVERDATA_AUTH_RESPONSE) continue;
          if (packet.id === -1) {
            finish({ ok: false, error: "RCON authentication failed" });
            return;
          }
          authenticated = true;
          clearTimeout(responseTimer);
          socket.write(encodePacket(1, SERVERDATA_EXECCOMMAND, command));
          responseTimer = setTimeout(() => {
            finish({ ok: false, error: "Timed out waiting for RCON command response" });
          }, RESPONSE_TIMEOUT_MS);
        } else {
          finish({ ok: true, response: packet.payload });
          return;
        }
      }
    });
  });
}
