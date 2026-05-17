import * as fs from "fs";
import * as path from "path";
import * as os from "os";
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

// Rekordbox 6/7 SQLCipher key — same across all installations
const REKORDBOX_DB_KEY =
  "402fd482c38817c35ffa8ffb8c7d93143b749e7d315df7a81732a1ff43608497";

export function getRekordboxKey(): string {
  return REKORDBOX_DB_KEY;
}

function findOptionsJson(): string | null {
  const candidates = [
    // Rekordbox 7 default
    path.join(os.homedir(), "Library", "Application Support", "Pioneer", "rekordbox7", "options.json"),
    path.join(os.homedir(), "Library", "Application Support", "Pioneer", "rekordbox7Agent", "storage", "options.json"),
    // Rekordbox 6 (and earlier 7 betas)
    path.join(os.homedir(), "Library", "Application Support", "Pioneer", "rekordboxAgent", "storage", "options.json"),
    path.join(os.homedir(), "Library", "Application Support", "Pioneer", "rekordbox", "options.json"),
    path.join(os.homedir(), "Library", "Pioneer", "rekordboxAgent", "storage", "options.json"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export type RekordboxMajorVersion = 7 | 6 | 5 | null;

export function detectRekordboxVersion(): RekordboxMajorVersion {
  const rb7 = path.join(os.homedir(), "Library", "Application Support", "Pioneer", "rekordbox7");
  if (fs.existsSync(rb7)) return 7;
  const rb6Agent = path.join(os.homedir(), "Library", "Application Support", "Pioneer", "rekordboxAgent");
  const rb6Db = path.join(os.homedir(), "Library", "Pioneer", "rekordbox", "master.db");
  if (fs.existsSync(rb6Agent) || fs.existsSync(rb6Db)) return 6;
  return null;
}

function extractDbPath(optionsPath: string): string | null {
  try {
    const content = JSON.parse(fs.readFileSync(optionsPath, "utf8"));
    const opts: Array<{ name?: string; val?: string }> = Array.isArray(content?.options) ? content.options : [];
    const optionDbPath = opts.find((opt) => opt.name === "db-path")?.val;
    if (optionDbPath && fs.existsSync(optionDbPath)) return optionDbPath;

    const optionMasterDb = opts.find((opt) => opt.name === "masterDbDirectory" || opt.name === "master-db-path")?.val;
    if (optionMasterDb) {
      const candidate = optionMasterDb.endsWith(".db")
        ? optionMasterDb
        : path.join(optionMasterDb, "master.db");
      if (fs.existsSync(candidate)) return candidate;
    }

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
    // Rekordbox 7 may use rekordbox7 directory in some installs
    path.join(os.homedir(), "Library", "Pioneer", "rekordbox7", "master.db"),
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
  const key = sqlcipherKey || getRekordboxKey();

  // Encrypted attempt — key must be set BEFORE any other operation
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    db.pragma(`cipher='sqlcipher'`);
    db.pragma(`legacy=4`);
    db.pragma(`key='${key.replace(/'/g, "''")}'`);
    db.pragma("journal_mode = WAL");
    db.prepare("SELECT count(*) FROM sqlite_master").get();
    return db;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("SQLCipher open failed:", msg);
  }

  // Plaintext fallback (Rekordbox 5 / unencrypted DB)
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

// History rows older than this aren't current — they're from a previous DJ session.
const HISTORY_FRESH_MS = 30 * 60 * 1000;

function parseRekordboxTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const direct = Date.parse(value);
  if (!Number.isNaN(direct)) return direct;
  const withSpace = value.replace(" ", "T");
  const parsed = Date.parse(withSpace + (withSpace.endsWith("Z") ? "" : "Z"));
  return Number.isNaN(parsed) ? null : parsed;
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

      const ts = parseRekordboxTimestamp(row.playedAt);
      if (ts && Date.now() - ts > HISTORY_FRESH_MS) {
        return null;
      }

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
