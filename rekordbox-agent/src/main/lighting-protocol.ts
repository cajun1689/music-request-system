import * as net from "net";

export const LIGHTING_PROTOCOL = "djbridge1";
export const LIGHTING_PROFILE = "gaslight-club-v1";
export const LIGHTING_PLUGIN = 930;
export const LIGHTING_REPLY_PORT = 9150;
export const LIGHTING_COMMAND_PORT = 8000;
const ID = /^[a-f0-9]{32}$/;

export function privateIPv4(value: string): boolean {
  if (net.isIP(value) !== 4) return false;
  const [a, b] = value.split(".").map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export function oscString(value: string): Buffer {
  if (value.includes("\0")) throw new Error("OSC string contains a null byte");
  const data = Buffer.from(value + "\0", "utf8");
  return Buffer.concat([data, Buffer.alloc((4 - data.length % 4) % 4)]);
}

export function oscCommand(command: string): Buffer {
  return Buffer.concat([oscString("/gma3/cmd"), oscString(",s"), oscString(command)]);
}

export function decodeOSCString(packet: Buffer, address: string): string | null {
  let offset = 0;
  function read(): string | null {
    const end = packet.indexOf(0, offset);
    if (end < offset) return null;
    const value = packet.subarray(offset, end).toString("utf8");
    offset = (end + 4) & ~3;
    return offset <= packet.length ? value : null;
  }
  if (packet.length > 4096 || read() !== address || read() !== ",s") return null;
  const result = read();
  return offset === packet.length ? result : null;
}

export interface LightingReply {
  nonce: string;
  result: string;
  profile: string;
  show: string;
  station: string;
  owner: string;
  ownerLabel: string;
  leaseSeconds: number;
  timer: boolean;
  colors: boolean;
  opening: boolean;
}

export function parseLightingReply(packet: Buffer): LightingReply | null {
  const value = decodeOSCString(packet, "/djbridge/status");
  if (!value) return null;
  const fields = value.split("|");
  if (fields.length !== 13 || fields[0] !== LIGHTING_PROTOCOL || !ID.test(fields[1])) return null;
  if (!/^[a-z_]{1,32}$/.test(fields[2]) || fields[3] !== LIGHTING_PROFILE) return null;
  if (fields[4] !== "Gaslight_Club_Live" || fields[5] !== "CWXT-E9A9VF8LTU") return null;
  if (fields[6] !== "-" && !ID.test(fields[6])) return null;
  if (!/^[\w .-]{1,64}$/.test(fields[7])) return null;
  const seconds = Number(fields[8]);
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > 12 || fields[9] !== "1") return null;
  if (!/^[01]$/.test(fields[10]) || !/^[01]$/.test(fields[11]) || !/^[01]$/.test(fields[12])) return null;
  return { nonce: fields[1], result: fields[2], profile: fields[3], show: fields[4], station: fields[5],
    owner: fields[6] === "-" ? "" : fields[6], ownerLabel: fields[7], leaseSeconds: seconds,
    timer: fields[10] === "1", colors: fields[11] === "1", opening: fields[12] === "1" };
}

export type LightingOperation = "hello" | "claim" | "heartbeat" | "release" | "start" | "normal" | "tempo" | "track";
export function lightingCommand(operation: LightingOperation, owner: string, nonce: string,
  replyAddress: string, label: string, payload = ""): string {
  if (!ID.test(owner) || !ID.test(nonce) || !privateIPv4(replyAddress)) throw new Error("Invalid lighting request");
  if (!["hello", "claim", "heartbeat", "release", "start", "normal", "tempo", "track"].includes(operation)) throw new Error("Unknown lighting action");
  if (operation === "tempo" && (!/^\d{2,3}(\.\d{1,3})?$/.test(payload) || Number(payload) < 30 || Number(payload) > 225)) throw new Error("Tempo must be 30–225 BPM");
  if (operation === "track" && !["cdj", "serato"].includes(payload)) throw new Error("Invalid track source");
  if (operation !== "tempo" && operation !== "track" && payload) throw new Error("Unexpected lighting payload");
  const safeLabel = label.replace(/[^\w .-]/g, "").trim().slice(0, 64) || "DJ Bridge";
  return `Plugin ${LIGHTING_PLUGIN} '${[operation, owner, nonce, replyAddress, safeLabel, payload || "-"].join("|")}'`;
}
