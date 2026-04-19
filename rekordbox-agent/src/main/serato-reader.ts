import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { LibraryTrack, TrackInfo } from "./rekordbox-reader";

const DEFAULT_SERATO_DIRS = [
  path.join(os.homedir(), "Music", "_Serato_"),
  path.join(os.homedir(), "Music", "ScratchLIVE"),
];

function scanVolumesForSerato(): string[] {
  const found: string[] = [];
  try {
    const volumes = fs.readdirSync("/Volumes");
    for (const vol of volumes) {
      if (vol === "Macintosh HD") continue;
      for (const name of ["_Serato_", "ScratchLIVE"]) {
        const candidate = path.join("/Volumes", vol, name);
        if (fs.existsSync(candidate)) found.push(candidate);
      }
    }
  } catch {
    // /Volumes not readable or not macOS
  }
  return found;
}

function getAllSeratoDirs(customPath?: string): string[] {
  const dirs = [...DEFAULT_SERATO_DIRS];

  if (customPath) {
    for (const name of ["_Serato_", "ScratchLIVE"]) {
      const candidate = path.join(customPath, name);
      if (!dirs.includes(candidate)) dirs.push(candidate);
    }
    if (!dirs.includes(customPath)) dirs.push(customPath);
  }

  dirs.push(...scanVolumesForSerato().filter((d) => !dirs.includes(d)));
  return dirs;
}

export function findSeratoDir(customPath?: string): string | null {
  for (const dir of getAllSeratoDirs(customPath)) {
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}

export function resolveSeratoSessionDir(customPath?: string): string | null {
  for (const dir of getAllSeratoDirs(customPath)) {
    const sessDir = path.join(dir, "History", "Sessions");
    if (fs.existsSync(sessDir)) return sessDir;
  }
  return null;
}

function findLatestSessionFile(sessDir: string): string | null {
  let files: { path: string; mtime: number }[];
  try {
    files = fs
      .readdirSync(sessDir)
      .filter((f) => f.endsWith(".session"))
      .map((f) => {
        const full = path.join(sessDir, f);
        return { path: full, mtime: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return null;
  }
  return files[0]?.path ?? null;
}

function readUint32BE(buf: Buffer, offset: number): number {
  if (offset + 4 > buf.length) return 0;
  return buf.readUInt32BE(offset);
}

function readTag(buf: Buffer, offset: number): string {
  if (offset + 4 > buf.length) return "";
  return buf.toString("ascii", offset, offset + 4);
}

function readUtf16BE(buf: Buffer, offset: number, length: number): string {
  const end = Math.min(offset + length, buf.length);
  const chars: string[] = [];
  for (let i = offset; i + 1 < end; i += 2) {
    const code = buf.readUInt16BE(i);
    if (code === 0) break;
    chars.push(String.fromCharCode(code));
  }
  return chars.join("");
}

interface SeratoEntry {
  title: string;
  artist: string;
  album: string;
  startTime: number;
  deck: number;
  played: boolean;
}

function parseAdatFields(buf: Buffer, start: number, length: number): SeratoEntry {
  const entry: SeratoEntry = {
    title: "",
    artist: "",
    album: "",
    startTime: 0,
    deck: 0,
    played: false,
  };
  const end = start + length;
  let pos = start;

  while (pos + 8 <= end) {
    const fieldId = readUint32BE(buf, pos);
    const fieldLen = readUint32BE(buf, pos + 4);
    pos += 8;

    if (fieldLen === 0 || pos + fieldLen > end) {
      pos += fieldLen;
      continue;
    }

    switch (fieldId) {
      case 2:
        if (fieldLen >= 4) entry.deck = readUint32BE(buf, pos);
        break;
      case 6:
        entry.title = readUtf16BE(buf, pos, fieldLen);
        break;
      case 7:
        entry.artist = readUtf16BE(buf, pos, fieldLen);
        break;
      case 8:
        entry.album = readUtf16BE(buf, pos, fieldLen);
        break;
      case 13:
        if (fieldLen >= 4) entry.startTime = readUint32BE(buf, pos);
        break;
      case 31:
        if (fieldLen >= 4) entry.played = readUint32BE(buf, pos) === 1;
        break;
    }

    pos += fieldLen;
  }

  return entry;
}

function parseSessionFile(filePath: string): SeratoEntry[] {
  let buf: Buffer;
  try {
    buf = fs.readFileSync(filePath);
  } catch {
    return [];
  }

  const entries: SeratoEntry[] = [];
  let pos = 0;

  while (pos + 8 <= buf.length) {
    const tag = readTag(buf, pos);
    const chunkLen = readUint32BE(buf, pos + 4);
    pos += 8;

    if (pos + chunkLen > buf.length) break;

    if (tag === "oent") {
      let innerPos = pos;
      const oentEnd = pos + chunkLen;
      while (innerPos + 8 <= oentEnd) {
        const innerTag = readTag(buf, innerPos);
        const innerLen = readUint32BE(buf, innerPos + 4);
        innerPos += 8;

        if (innerTag === "adat" && innerPos + innerLen <= oentEnd) {
          const entry = parseAdatFields(buf, innerPos, innerLen);
          if (entry.title) {
            entries.push(entry);
          }
        }
        innerPos += innerLen;
      }
    }

    pos += chunkLen;
  }

  return entries;
}

function getAllSessionFiles(sessDir: string): string[] {
  try {
    return fs
      .readdirSync(sessDir)
      .filter((f) => f.endsWith(".session"))
      .map((f) => path.join(sessDir, f));
  } catch {
    return [];
  }
}

function buildPlayCountMap(customPath?: string): Map<string, number> {
  const counts = new Map<string, number>();
  const scannedDirs = new Set<string>();

  for (const dir of getAllSeratoDirs(customPath)) {
    const sessDir = path.join(dir, "History", "Sessions");
    if (scannedDirs.has(sessDir) || !fs.existsSync(sessDir)) continue;
    scannedDirs.add(sessDir);

    for (const file of getAllSessionFiles(sessDir)) {
      for (const entry of parseSessionFile(file)) {
        if (!entry.title) continue;
        const key = `${entry.title.toLowerCase().trim()}::${entry.artist.toLowerCase().trim()}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return counts;
}

function resolveAllSeratoDatabasePaths(customPath?: string): string[] {
  const paths: string[] = [];
  for (const dir of getAllSeratoDirs(customPath)) {
    const dbFile = path.join(dir, "database V2");
    if (fs.existsSync(dbFile) && !paths.includes(dbFile)) paths.push(dbFile);
  }
  return paths;
}

interface OtrkResult {
  title: string;
  artist: string;
}

function parseOtrkFields(buf: Buffer, start: number, length: number): OtrkResult | null {
  let title = "";
  let artist = "";
  const end = start + length;
  let pos = start;

  while (pos + 8 <= end) {
    const tag = readTag(buf, pos);
    const fieldLen = readUint32BE(buf, pos + 4);
    pos += 8;

    if (pos + fieldLen > end) break;

    if (tag === "tsng") {
      title = readUtf16BE(buf, pos, fieldLen);
    } else if (tag === "tart") {
      artist = readUtf16BE(buf, pos, fieldLen);
    }

    pos += fieldLen;
  }

  if (!title) return null;
  return { title, artist };
}

function parseSeratoDatabase(buf: Buffer): OtrkResult[] {
  const results: OtrkResult[] = [];
  let pos = 0;
  while (pos + 8 <= buf.length) {
    const tag = readTag(buf, pos);
    const chunkLen = readUint32BE(buf, pos + 4);
    pos += 8;
    if (pos + chunkLen > buf.length) break;
    if (tag === "otrk") {
      const parsed = parseOtrkFields(buf, pos, chunkLen);
      if (parsed) results.push(parsed);
    }
    pos += chunkLen;
  }
  return results;
}

export async function readSeratoLibrary(customPath?: string): Promise<LibraryTrack[]> {
  const dbPaths = resolveAllSeratoDatabasePaths(customPath);
  if (!dbPaths.length) return [];

  const playCounts = buildPlayCountMap(customPath);
  const seen = new Set<string>();
  const tracks: LibraryTrack[] = [];

  for (const dbPath of dbPaths) {
    let buf: Buffer;
    try {
      buf = fs.readFileSync(dbPath);
    } catch {
      continue;
    }

    for (const parsed of parseSeratoDatabase(buf)) {
      const key = `${parsed.title.toLowerCase().trim()}::${parsed.artist.toLowerCase().trim()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tracks.push({
        title: parsed.title,
        artist: parsed.artist,
        playCount: playCounts.get(key) ?? 0,
      });
    }
  }

  return tracks;
}

const STALE_SESSION_MS = 4 * 60 * 60 * 1000; // 4 hours
const STALE_LOG_MS = 4 * 60 * 60 * 1000;

function findSeratoLogFile(): string | null {
  const logDir = path.join(os.homedir(), "Music", "_Serato_", "Logs");
  const symlink = path.join(logDir, "DJ.INFO");
  try {
    if (fs.existsSync(symlink)) {
      const resolved = fs.realpathSync(symlink);
      if (fs.existsSync(resolved)) return resolved;
    }
  } catch {
    // Symlink broken; fall back to scanning
  }

  try {
    const files = fs
      .readdirSync(logDir)
      .filter((f) => f.endsWith(".log"))
      .map((f) => {
        const full = path.join(logDir, f);
        return { path: full, mtime: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    return files[0]?.path ?? null;
  } catch {
    return null;
  }
}

interface DeckLoadEntry {
  timestamp: Date;
  filePath: string;
  deck: number;
  artist: string;
  title: string;
}

const DECK_LOAD_RE =
  /^I(\d{8} \d{2}:\d{2}:\d{2})\.\d+.*Creating audio cache store resource for 'cache:\/\/\/(.*?):deck_(\d+)_instrumental\?/;

const DJ_POOL_TAGS_RE = new RegExp(
  "\\b(" +
    [
      "dirty", "clean", "explicit", "radio edit",
      "quick hit", "quick hitter", "short edit",
      "intro", "outro", "intro edit", "outro edit",
      "instrumental", "acapella", "acap",
      "funkymix", "x-mix", "xtendz",
      "transition", "re-drum", "redrum", "hype",
      "ck cut", "dj edit", "dj tool",
    ].join("|") +
  ")\\b",
  "gi",
);

function cleanDjPoolTitle(raw: string): string {
  let s = raw;
  s = s.replace(/^\d{1,3}\s+/, "");
  s = s.replace(/\s+\d{1,2}[AB]\s+\d{2,3}$/, "");
  s = s.replace(/\s*\(([^)]*)\)\s*/g, (full, inner) => {
    if (DJ_POOL_TAGS_RE.test(inner)) return " ";
    return full;
  });
  s = s.replace(/\s*\[([^\]]*)\]\s*/g, (full, inner) => {
    if (DJ_POOL_TAGS_RE.test(inner)) return " ";
    return full;
  });
  s = s.replace(DJ_POOL_TAGS_RE, " ");
  s = s.replace(/\b(?:by\s+\w[\w\s]{0,25})$/i, "").trim();
  s = s.replace(/\s{2,}/g, " ").trim();
  return s;
}

function cleanFeaturing(artist: string): string {
  return artist
    .replace(/\s+(?:ft\.?|feat\.?|featuring)\s+/gi, " & ")
    .trim();
}

function extractArtistTitle(filePath: string): { artist: string; title: string } {
  const basename = path.basename(filePath).replace(/\.\w{2,4}$/, "");

  let rawArtist = "";
  let rawTitle = basename;

  const dashMatch = basename.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (dashMatch) {
    rawArtist = dashMatch[1].trim();
    rawTitle = dashMatch[2].trim();
  } else {
    const ddMatch = basename.match(/^(.+?)\s+--\s+(.+)$/);
    if (ddMatch) {
      rawArtist = ddMatch[1].trim();
      rawTitle = ddMatch[2].trim();
    }
  }

  return {
    artist: cleanFeaturing(cleanDjPoolTitle(rawArtist)),
    title: cleanDjPoolTitle(rawTitle),
  };
}

function parseSeratoTimestamp(raw: string): Date {
  const m = raw.match(/^(\d{4})(\d{2})(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return new Date();
  return new Date(
    parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]),
    parseInt(m[4]), parseInt(m[5]), parseInt(m[6]),
  );
}

function readRecentDeckLoads(logPath: string, tailBytes = 200_000): DeckLoadEntry[] {
  let data: string;
  try {
    const stat = fs.statSync(logPath);
    const start = Math.max(0, stat.size - tailBytes);
    const buf = Buffer.alloc(Math.min(tailBytes, stat.size));
    const fd = fs.openSync(logPath, "r");
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    data = buf.toString("utf8");
  } catch {
    return [];
  }

  const entries: DeckLoadEntry[] = [];
  for (const line of data.split("\n")) {
    const m = DECK_LOAD_RE.exec(line);
    if (!m) continue;

    const timestamp = parseSeratoTimestamp(m[1]);
    const filePath = m[2];
    const deck = parseInt(m[3]);
    const { artist, title } = extractArtistTitle(filePath);

    entries.push({ timestamp, filePath, deck, artist, title });
  }

  return entries;
}

function readCurrentTrackFromLog(): TrackInfo | null {
  const logFile = findSeratoLogFile();
  if (!logFile) return null;

  try {
    const stat = fs.statSync(logFile);
    if (Date.now() - stat.mtimeMs > STALE_LOG_MS) return null;
  } catch {
    return null;
  }

  const loads = readRecentDeckLoads(logFile);
  if (!loads.length) return null;

  // Build per-deck state: the latest load for each deck
  const deckState = new Map<number, DeckLoadEntry>();
  for (const entry of loads) {
    deckState.set(entry.deck, entry);
  }

  // If we have tracks on 2+ decks, the most recently loaded deck is the "prep" deck.
  // The OTHER deck is likely what's currently playing (the DJ loaded a new track
  // to prepare the next transition while the other deck outputs audio).
  if (deckState.size >= 2) {
    let latestDeck = 0;
    let latestTime = 0;
    for (const [deck, entry] of deckState) {
      if (entry.timestamp.getTime() > latestTime) {
        latestTime = entry.timestamp.getTime();
        latestDeck = deck;
      }
    }

    // Find the "active" deck (the one NOT most recently loaded)
    let activeDeckEntry: DeckLoadEntry | null = null;
    let activeDeckTime = 0;
    for (const [deck, entry] of deckState) {
      if (deck !== latestDeck && entry.timestamp.getTime() > activeDeckTime) {
        activeDeckTime = entry.timestamp.getTime();
        activeDeckEntry = entry;
      }
    }

    if (activeDeckEntry && activeDeckEntry.title) {
      return {
        title: activeDeckEntry.title,
        artist: activeDeckEntry.artist,
        playedAt: activeDeckEntry.timestamp.toISOString(),
      };
    }
  }

  // Fallback: single deck or no multi-deck info
  const latest = loads[loads.length - 1];
  if (!latest.title) return null;

  return {
    title: latest.title,
    artist: latest.artist,
    playedAt: latest.timestamp.toISOString(),
  };
}

function readCurrentTrackFromSession(customPath?: string): TrackInfo | null {
  const sessDir = resolveSeratoSessionDir(customPath);
  if (!sessDir) return null;

  const latestFile = findLatestSessionFile(sessDir);
  if (!latestFile) return null;

  try {
    const stat = fs.statSync(latestFile);
    if (Date.now() - stat.mtimeMs > STALE_SESSION_MS) return null;
  } catch {
    return null;
  }

  const entries = parseSessionFile(latestFile);
  if (!entries.length) return null;

  // Prefer the latest entry marked as "played" (actually played, not just loaded)
  const playedEntries = entries.filter((e) => e.played);
  const latest = playedEntries.length > 0
    ? playedEntries[playedEntries.length - 1]
    : entries[entries.length - 1];
  if (!latest.title) return null;

  return {
    title: latest.title,
    artist: latest.artist,
    album: latest.album || undefined,
    playedAt: latest.startTime
      ? new Date(latest.startTime * 1000).toISOString()
      : new Date().toISOString(),
  };
}

export async function readCurrentSeratoTrack(customPath?: string): Promise<TrackInfo | null> {
  const fromLog = readCurrentTrackFromLog();
  if (fromLog) return fromLog;
  return readCurrentTrackFromSession(customPath);
}
