import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import Database from "better-sqlite3";

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

export async function readCurrentTrack(dbPath: string, sqlcipherKey?: string): Promise<TrackInfo | null> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_BUSY_RETRIES; attempt++) {
    let db: Database.Database | null = null;
    try {
      db = new Database(dbPath, { readonly: true, fileMustExist: true });
      db.pragma("journal_mode = WAL");

      if (sqlcipherKey) {
        db.pragma(`key = '${sqlcipherKey.replace(/'/g, "''")}'`);
      }

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
