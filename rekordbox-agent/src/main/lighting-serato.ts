import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export class PlayedHistory {
  private seen: Set<number> | null = null;
  private session: number | null = null;
  private changedId: number | null = null;
  update(session: number, rows: { id: number; played: number }[]): boolean {
    this.changedId = null;
    const ids = rows.filter((r) => r.played).map((r) => r.id);
    if (this.seen === null) {
      this.session = session; this.seen = new Set(ids); return false;
    }
    if (this.session !== session) { this.session = session; this.seen = new Set(); }
    this.changedId = ids.find((id) => !this.seen!.has(id)) ?? null;
    ids.forEach((id) => this.seen!.add(id));
    // Only retain the bounded recent window returned by the read-only query.
    if (this.seen.size > 2048) this.seen = new Set(ids);
    return this.changedId !== null;
  }
  changedTrackId(): number | null { return this.changedId; }
}

/** Open only while the lighting owner is active; no cloud transition delay. */
export class LightingSeratoReader {
  private db: any = null;
  private history = new PlayedHistory();
  private polling = false;
  private current: string | null = null;
  private closed = false;
  private legacyKey: string | null = null;
  constructor(private onTrack: (key: string) => void, private legacy?: () => Promise<{ title: string; artist: string; playedAt?: string } | null> | { title: string; artist: string; playedAt?: string } | null,
    private filename = path.join(os.homedir(), "Library", "Application Support", "Serato", "Library", "master.sqlite")) {}
  async poll(): Promise<void> {
    if (this.polling || this.closed) return;
    this.polling = true;
    try {
      if (fs.existsSync(this.filename)) {
        try {
          if (!this.db) {
            const Database = require("better-sqlite3-multiple-ciphers");
            this.db = new Database(this.filename, { readonly: true, fileMustExist: true, timeout: 100 });
            this.db.pragma("query_only = ON");
          }
          const session = this.db.prepare("SELECT MAX(id) AS id FROM history_session").get()?.id;
          if (session === null || session === undefined) { this.current = null; return; }
          const rows = this.db.prepare("SELECT id,played FROM history_entry WHERE session_id=? ORDER BY id DESC LIMIT 256").all(session);
          this.current = rows.length ? `serato:${session}:${rows[0].id}` : null;
          if (this.history.update(Number(session), rows)) this.onTrack(`serato:${session}:${this.history.changedTrackId()}`);
          return;
        } catch { this.current = null; this.closeDatabase(); return; }
      }
      if (this.legacy) {
        const track = await this.legacy();
        if (!track || this.closed) { this.current = null; return; }
        const key = `${track.artist}::${track.title}::${track.playedAt ?? ""}`;
        if (this.legacyKey !== null && key !== this.legacyKey) this.onTrack("serato-legacy:" + key);
        this.current = "serato-legacy:" + key;
        this.legacyKey = key;
      }
    } finally { this.polling = false; }
  }
  private closeDatabase(): void { try { this.db?.close(); } catch { /* already closed */ } this.db = null; }
  currentTrackKey(): string | null { return this.current; }
  close(): void { this.closed = true; this.current = null; this.closeDatabase(); this.history = new PlayedHistory(); this.legacyKey = null; }
}
