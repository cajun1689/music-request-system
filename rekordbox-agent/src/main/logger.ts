import log from "electron-log";
import * as path from "path";
import { app, BrowserWindow } from "electron";

log.transports.file.resolvePathFn = () =>
  path.join(app.getPath("logs"), "rekordbox-bridge.log");

log.transports.file.maxSize = 5 * 1024 * 1024; // 5 MB
log.transports.file.format = "[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}";
log.transports.console.format = "[{h}:{i}:{s}] [{level}] {text}";

let rendererWindow: BrowserWindow | null = null;

export function setLogWindow(win: BrowserWindow | null): void {
  rendererWindow = win;
}

log.hooks.push((message, _transport, transportName) => {
  if (transportName === "console" && rendererWindow && !rendererWindow.isDestroyed()) {
    const level = message.level ?? "info";
    const text = message.data?.map((d: unknown) =>
      typeof d === "object" ? JSON.stringify(d) : String(d)
    ).join(" ") ?? "";
    rendererWindow.webContents.send("main-log", { level, text });
  }
  return message;
});

export default log;
