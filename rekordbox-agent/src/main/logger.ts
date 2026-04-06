import log from "electron-log";
import * as path from "path";
import { app } from "electron";

log.transports.file.resolvePathFn = () =>
  path.join(app.getPath("logs"), "rekordbox-bridge.log");

log.transports.file.maxSize = 5 * 1024 * 1024; // 5 MB
log.transports.file.format = "[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}";
log.transports.console.format = "[{h}:{i}:{s}] [{level}] {text}";

export default log;
