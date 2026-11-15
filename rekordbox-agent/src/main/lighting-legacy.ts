import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
const run = promisify(execFile);
export const LEGACY_LIGHTING_LABELS = ["com.fnm.lightkey-a9-clock", "com.fnm.grandma3-a9-tempo", "com.fnm.grandma3-track-colors"];
export function legacyLightingFiles(): string[] {
  if (process.platform !== "darwin") return [];
  return LEGACY_LIGHTING_LABELS.map((name) => path.join(os.homedir(), "Library", "LaunchAgents", `${name}.plist`)).filter(fs.existsSync);
}
export async function migrateLegacyLighting(backupDirectory: string): Promise<void> {
  fs.mkdirSync(backupDirectory, { recursive: true });
  const domain = `gui/${process.getuid!()}`;
  for (const file of legacyLightingFiles()) {
    const label = path.basename(file, ".plist");
    fs.copyFileSync(file, path.join(backupDirectory, path.basename(file)));
    // Disable first so a stopped KeepAlive service cannot immediately restart.
    await run("/bin/launchctl", ["disable", `${domain}/${label}`]);
    try { await run("/bin/launchctl", ["bootout", `${domain}/${label}`]); }
    catch (error: any) {
      if (!/could not find|no such process|not found/i.test(`${error.stderr ?? ""} ${error.message ?? ""}`)) throw error;
    }
  }
  fs.writeFileSync(path.join(backupDirectory, "RECOVERY.txt"),
    "Quit DJ Bridge before recovery. Restore only the required saved plist to ~/Library/LaunchAgents, then run launchctl enable gui/$(id -u)/LABEL and launchctl bootstrap gui/$(id -u) PATH_TO_PLIST. Never run both connector systems together.\n");
}
