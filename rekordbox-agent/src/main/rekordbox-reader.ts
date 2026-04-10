import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as zlib from "zlib";
import Database from "better-sqlite3-multiple-ciphers";

export interface TrackInfo {
  title: string;
  artist: string;
  album?: string;
  playedAt: string;
}

const HISTORY_QUERY = `
  SELECT
    c.Title   AS title,
    a.Name    AS artist,
    al.Name   AS album,
    h.created_at AS playedAt
  FROM djmdSongHistory h
  JOIN djmdContent c ON c.ID = h.ContentID
  LEFT JOIN djmdArtist a ON a.ID = c.ArtistID
  LEFT JOIN djmdAlbum al ON al.ID = c.AlbumID
  ORDER BY h.created_at DESC
  LIMIT 1
`;

// Rekordbox 6/7 obfuscated database password (same across all installations)
const RB_BLOB = Buffer.from(
  "PN_Pq^*N>(JYe*u^8;Yg76HuZ)b9;DpoTXV(6ItkU`}8*m6tx_I{Solh_N#dfe{v=",
  "ascii",
);
const RB_BLOB_KEY = Buffer.from("657f48f84c437cc1", "ascii");

function base85Decode(input: Buffer): Buffer {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+-;<=>?@^_`{|}~";
  const str = input.toString("ascii");
  const result: number[] = [];
  for (let i = 0; i < str.length; i += 5) {
    let acc = 0;
    for (let j = 0; j < 5 && i + j < str.length; j++) {
      const idx = chars.indexOf(str[i + j]);
      acc = acc * 85 + (idx >= 0 ? idx : 0);
    }
    const chunkSize = Math.min(4, Math.floor(((str.length - i) * 4) / 5));
    for (let j = 3; j >= 4 - chunkSize; j--) {
      result.push((acc >> (j * 8)) & 0xff);
    }
  }
  return Buffer.from(result);
}

function deobfuscateRekordboxKey(): string {
  const data = base85Decode(RB_BLOB);
  const xored = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) {
    xored[i] = data[i] ^ RB_BLOB_KEY[i % RB_BLOB_KEY.length];
  }
  return zlib.inflateSync(xored).toString("utf8");
}

let cachedRbKey: string | null = null;

export function getRekordboxKey(): string {
  if (!cachedRbKey) {
    cachedRbKey = deobfuscateRekordboxKey();
  }
  return cachedRbKey;
}

function findOptionsJson(): string | null {
  const candidates = [
    path.join(os.homedir(), "Library", "Application Support", "Pioneer", "rekordboxAgent", "storage", "options.json"),
    path.join(os.homedir(), "Library", "Pioneer", "rekordboxAgent", "storage", "options.json"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function extractDbPath(optionsPath: string): string | null {
  try {
    const content = JSON.parse(fs.readFileSync(optionsPath, "utf8"));
    const dbPath: string | undefined = content?.options?.find?.(
      (opt: { name?: string; val?: string }) => opt.name === "db-path",
    )?.val;
    if (dbPath && fs.existsSync(dbPath)) return dbPath;

    const defaultDbDir = path.join(os.homedir(), "Library", "Pioneer", "rekordbox");
    const masterDb = path.join(defaultDbDir, "master.db");
    if (fs.existsSync(masterDb)) return masterDb;
  } catch {
    // Fall through
  }
  return null;
}

function findDbPathFallback(): string | null {
  const candidates = [
    path.join(os.homedir(), "Library", "Pioneer", "rekordbox", "master.db"),
    path.join(os.homedir(), "Library", "Pioneer", "rekordbox", "datafile.edb"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function resolveDbPath(): string | null {
  const optionsJson = findOptionsJson();
  if (optionsJson) {
    const fromOpts = extractDbPath(optionsJson);
    if (fromOpts) return fromOpts;
  }
  return findDbPathFallback();
}

const MAX_BUSY_RETRIES = 3;
const BUSY_RETRY_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface LibraryTrack {
  title: string;
  artist: string;
  playCount: number;
}

const LIBRARY_QUERY = `
  SELECT
    c.Title       AS title,
    a.Name        AS artist,
    COUNT(h.ID)   AS playCount
  FROM djmdContent c
  LEFT JOIN djmdArtist a ON a.ID = c.ArtistID
  LEFT JOIN djmdSongHistory h ON h.ContentID = c.ID
  WHERE c.Title IS NOT NULL AND c.Title != ''
  GROUP BY c.ID
  ORDER BY playCount DESC
`;

function openDatabase(dbPath: string, sqlcipherKey?: string): Database.Database {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  db.pragma("journal_mode = WAL");

  const key = sqlcipherKey || getRekordboxKey();

  try {
    db.pragma(`cipher='sqlcipher'`);
    db.pragma(`legacy=4`);
    db.pragma(`key='${key.replace(/'/g, "''")}'`);
    db.prepare("SELECT count(*) FROM sqlite_master").get();
    return db;
  } catch {
    // Key didn't work — try without encryption (Rekordbox 5 / unencrypted DB)
    try { db.close(); } catch { /* ignore */ }
  }

  const plainDb = new Database(dbPath, { readonly: true, fileMustExist: true });
  plainDb.pragma("journal_mode = WAL");
  plainDb.prepare("SELECT count(*) FROM sqlite_master").get();
  return plainDb;
}

export async function readRekordboxLibrary(dbPath: string, sqlcipherKey?: string): Promise<LibraryTrack[]> {
  let db: Database.Database | null = null;
  try {
    db = openDatabase(dbPath, sqlcipherKey);
    const rows = db.prepare(LIBRARY_QUERY).all() as Array<{
      title: string;
      artist: string | null;
      playCount: number;
    }>;
    return rows.map((r) => ({
      title: r.title ?? "",
      artist: r.artist ?? "",
      playCount: r.playCount ?? 0,
    }));
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

export async function readCurrentTrack(dbPath: string, sqlcipherKey?: string): Promise<TrackInfo | null> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_BUSY_RETRIES; attempt++) {
    let db: Database.Database | null = null;
    try {
      db = openDatabase(dbPath, sqlcipherKey);

      const row = db.prepare(HISTORY_QUERY).get() as {
        title: string;
        artist: string;
        album: string | null;
        playedAt: string;
      } | undefined;

      if (!row) return null;

      return {
        title: row.title ?? "",
        artist: row.artist ?? "",
        album: row.album ?? undefined,
        playedAt: row.playedAt ?? "",
      };
    } catch (err: unknown) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);

      if (message.includes("SQLITE_BUSY") || message.includes("database is locked")) {
        await sleep(BUSY_RETRY_DELAY_MS * (attempt + 1));
        continue;
      }

      throw err;
    } finally {
      try {
        db?.close();
      } catch {
        // Ignore close errors
      }
    }
  }

  throw lastError;
}
