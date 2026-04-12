import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Tray,
  nativeImage,
  Notification,
} from "electron";
import * as path from "path";
import log, { setLogWindow } from "./logger";
import { getConfig, setConfig } from "./config-store";
import {
  readCurrentTrack,
  readRekordboxLibrary,
  resolveDbPath,
  type TrackInfo,
} from "./rekordbox-reader";
import {
  readCurrentSeratoTrack,
  readSeratoLibrary,
  resolveSeratoSessionDir,
} from "./serato-reader";
import {
  drainQueue,
  enqueueTrack,
  fetchEvents,
  fetchEventSources,
  fetchGenreVotes,
  fetchRequests,
  pushTrack,
  reviewRequest,
  syncLibrary,
  queueSize,
  type PushResult,
} from "./api-client";
import {
  initAutoUpdater,
  checkForUpdates,
  quitAndInstall,
  getUpdateStatus,
  onUpdateStatus,
} from "./updater";

log.info("DJ Bridge starting", { version: app.getVersion() });

process.on("unhandledRejection", (reason) => {
  log.error("Unhandled rejection:", String(reason));
});

let tray: Tray | null = null;
let mainWindow: BrowserWindow | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastTrackKey = "";
let lastPollError = "";
let isQuitting = false;

interface StatusPayload {
  connected: boolean;
  mode: "auto" | "manual";
  softwareType: "rekordbox" | "serato" | "auto";
  activeSoftware: "rekordbox" | "serato" | null;
  dbPath: string | null;
  lastTrack: TrackInfo | null;
  lastResult: PushResult | null;
  error: string | null;
  queueSize: number;
  version: string;
  logsPath: string;
  launchAtLogin: boolean;
}

let status: StatusPayload = {
  connected: false,
  mode: "auto",
  softwareType: "auto",
  activeSoftware: null,
  dbPath: null,
  lastTrack: null,
  lastResult: null,
  error: null,
  queueSize: 0,
  version: "",
  logsPath: "",
  launchAtLogin: false,
};

function sendStatus(): void {
  mainWindow?.webContents.send("status-update", status);
  updateTrayMenu();
}

function trackKey(t: TrackInfo): string {
  return `${t.artist}::${t.title}`;
}

function showNotification(title: string, body: string): void {
  if (Notification.isSupported()) {
    new Notification({ title, body, silent: true }).show();
  }
}

function trayIconPath(): string {
  const resourceDir = process.resourcesPath;
  return path.join(resourceDir, "trayTemplate.png");
}

function updateTrayTooltip(): void {
  if (!tray) return;
  const parts = ["DJ Bridge"];
  if (status.activeSoftware) {
    parts[0] += ` (${status.activeSoftware})`;
  }
  if (status.lastTrack) {
    parts.push(`${status.lastTrack.artist} – ${status.lastTrack.title}`);
  }
  if (status.error) {
    parts.push(`⚠ ${status.error}`);
  }
  tray.setToolTip(parts.join("\n"));
}

function updateTrayMenu(): void {
  buildTrayMenu();
}

let cachedContextMenu: Electron.Menu | null = null;

function buildTrayMenu(): void {
  if (!tray) return;
  updateTrayTooltip();

  const trackLabel = status.lastTrack
    ? `♫ ${status.lastTrack.artist} – ${status.lastTrack.title}`
    : "No track detected";

  const statusLabel = status.connected
    ? "● Connected"
    : status.error
      ? "● Error"
      : "○ Idle";

  cachedContextMenu = Menu.buildFromTemplate([
    { label: statusLabel, enabled: false },
    { label: trackLabel, enabled: false },
    { type: "separator" },
    { label: "Show Window", click: showWindow },
    { type: "separator" },
    {
      label: `Software: ${status.activeSoftware ?? status.softwareType}`,
      enabled: false,
    },
    {
      label: "Mode",
      submenu: [
        {
          label: "Auto (poll DJ software)",
          type: "radio",
          checked: status.mode === "auto",
          click: () => switchMode("auto"),
        },
        {
          label: "Manual",
          type: "radio",
          checked: status.mode === "manual",
          click: () => switchMode("manual"),
        },
      ],
    },
    {
      label: "Launch at Login",
      type: "checkbox",
      checked: status.launchAtLogin,
      click: () => toggleLaunchAtLogin(),
    },
    { type: "separator" },
    {
      label: "Quit DJ Bridge",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
}

function switchMode(mode: "auto" | "manual"): void {
  setConfig({ mode });
  status.mode = mode;
  if (mode === "auto") {
    startPolling();
  } else {
    stopPolling();
  }
  sendStatus();
}

function toggleLaunchAtLogin(): void {
  const current = app.getLoginItemSettings().openAtLogin;
  app.setLoginItemSettings({ openAtLogin: !current });
  status.launchAtLogin = !current;
  log.info("Launch at login:", !current);
  sendStatus();
}

function detectSoftware(customPath?: string): "rekordbox" | "serato" | null {
  if (resolveDbPath()) return "rekordbox";
  if (resolveSeratoSessionDir(customPath)) return "serato";
  return null;
}

async function readTrackForSoftware(
  sw: "rekordbox" | "serato",
  config: ReturnType<typeof getConfig>,
): Promise<TrackInfo | null> {
  if (sw === "rekordbox") {
    const dbPath = status.dbPath || resolveDbPath();
    if (!dbPath) {
      status.error = "Rekordbox database not found.";
      status.connected = false;
      return null;
    }
    status.dbPath = dbPath;
    return readCurrentTrack(dbPath, config.sqlcipherKey || undefined);
  }

  const customPath = config.musicLibraryPath || undefined;
  const sessDir = resolveSeratoSessionDir(customPath);
  status.dbPath = sessDir;
  return readCurrentSeratoTrack(customPath);
}

async function pollOnce(): Promise<void> {
  const config = getConfig();
  if (config.mode !== "auto") return;
  status.softwareType = config.softwareType;

  if (!config.eventId || !config.pushToken) {
    status.error = "Event ID and Push Token must be configured.";
    sendStatus();
    return;
  }

  let sw: "rekordbox" | "serato" | null = null;
  if (config.softwareType === "auto") {
    sw = detectSoftware(config.musicLibraryPath || undefined);
    if (!sw) {
      status.error = "No DJ software detected (Rekordbox or Serato).";
      status.activeSoftware = null;
      status.connected = false;
      sendStatus();
      return;
    }
  } else {
    sw = config.softwareType;
  }
  status.activeSoftware = sw;

  try {
    let track: TrackInfo | null = null;
    try {
      track = await readTrackForSoftware(sw, config);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isDbUnreadable =
        msg.includes("file is not a database") || msg.includes("not a database");
      const isNativeModuleError =
        msg.includes("incompatible architecture") ||
        msg.includes("dlopen") ||
        msg.includes("MODULE_NOT_FOUND");

      if (config.softwareType === "auto" && sw === "rekordbox" && (isDbUnreadable || isNativeModuleError)) {
        const reason = isNativeModuleError
          ? "Rekordbox native module failed (architecture mismatch), trying Serato…"
          : "Rekordbox DB unreadable (encrypted?), trying Serato…";
        log.warn(reason);
        sw = "serato";
        status.activeSoftware = sw;
        track = await readTrackForSoftware(sw, config);
      } else if (sw === "rekordbox" && isNativeModuleError) {
        throw new Error(
          "Rekordbox support unavailable: native SQLite module is not compatible with this Mac's architecture. " +
          "Reinstall DJ Bridge or switch DJ Software to Serato.",
        );
      } else {
        throw err;
      }
    }

    if (!track) {
      status.error = null;
      sendStatus();
      return;
    }

    const key = trackKey(track);
    if (key === lastTrackKey) {
      if (queueSize() > 0) {
        await drainQueue();
        status.queueSize = queueSize();
      }
      sendStatus();
      return;
    }

    lastTrackKey = key;
    status.lastTrack = track;
    status.error = null;
    log.info(`New track from ${sw}:`, track.artist, "–", track.title);

    try {
      const result = await pushTrack(track);
      status.lastResult = result;
      status.connected = true;
      status.queueSize = queueSize();

      if (result.matched) {
        log.info("Track matched request!", { score: result.confidenceScore });
        showNotification(
          "Request Matched!",
          `"${track.title}" by ${track.artist} matched a request.`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("Push failed:", message);
      status.error = `Push failed: ${message}`;
      status.connected = false;
      enqueueTrack(track);
      status.queueSize = queueSize();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message !== lastPollError) {
      log.error("Read error:", message);
      lastPollError = message;
    }
    status.error = message.includes("file is not a database")
      ? "Rekordbox 6+ DB is encrypted. Provide a SQLCipher key or switch to Serato."
      : `Read error: ${message}`;
    status.connected = false;
  }

  sendStatus();
}

function startPolling(): void {
  stopPolling();
  const config = getConfig();
  const interval = config.pollingIntervalMs || 10_000;
  log.info("Starting auto-poll, interval:", interval, "ms");
  void pollOnce();
  pollTimer = setInterval(() => void pollOnce(), interval);
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    log.info("Polling stopped");
  }
}

function positionWindowTopRight(): void {
  if (!mainWindow) return;
  const { screen } = require("electron");
  const display = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = display.workAreaSize;
  const { x: workX, y: workY } = display.workArea;
  const windowBounds = mainWindow.getBounds();
  const padding = 12;
  const x = workX + screenW - windowBounds.width - padding;
  const y = workY + padding;
  mainWindow.setPosition(x, y, false);
}

function createWindow(): void {
  const preloadPath = path.join(__dirname, "preload.js");
  log.info("Preload path:", preloadPath);

  mainWindow = new BrowserWindow({
    width: 420,
    height: 700,
    minWidth: 380,
    minHeight: 500,
    show: false,
    resizable: true,
    skipTaskbar: true,
    title: "DJ Bridge",
    titleBarStyle: "hiddenInset",
    vibrancy: "sidebar",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  setLogWindow(mainWindow);

  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

  mainWindow.webContents.on("did-finish-load", () => {
    log.info("Renderer loaded successfully");
    mainWindow?.webContents.executeJavaScript(
      `JSON.stringify({ bridge: typeof window.bridge, _preloadOk: window._preloadOk, _preloadError: window._preloadError })`
    ).then((result) => {
      log.info("Preload check from renderer:", result);
    }).catch((err) => {
      log.error("Failed to check preload state:", String(err));
    });
  });

  mainWindow.webContents.on("did-fail-load", (_e, code, desc) => {
    log.error("Renderer failed to load:", code, desc);
  });

  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
}

function showWindow(): void {
  if (!mainWindow) {
    createWindow();
  }
  if (mainWindow) {
    positionWindowTopRight();
    mainWindow.show();
    mainWindow.focus();
  }
}

function toggleWindow(): void {
  if (!mainWindow) {
    createWindow();
  }
  if (mainWindow && mainWindow.isVisible()) {
    mainWindow.hide();
  } else if (mainWindow) {
    positionWindowTopRight();
    mainWindow.show();
    mainWindow.focus();
  }
}

app.on("ready", () => {
  if (app.dock) app.dock.hide();

  status.version = app.getVersion();
  status.logsPath = app.getPath("logs");
  status.launchAtLogin = app.getLoginItemSettings().openAtLogin;

  const iconPath = trayIconPath();
  let icon: Electron.NativeImage;
  try {
    icon = nativeImage.createFromPath(iconPath);
    icon.setTemplateImage(true);
  } catch {
    log.warn("Tray icon not found at", iconPath, "— using empty icon");
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip("DJ Bridge");
  tray.on("click", () => {
    showWindow();
  });
  tray.on("right-click", () => {
    buildTrayMenu();
    if (cachedContextMenu) tray?.popUpContextMenu(cachedContextMenu);
  });
  buildTrayMenu();

  createWindow();
  mainWindow?.show();

  const config = getConfig();
  status.mode = config.mode;
  status.softwareType = config.softwareType;
  if (config.mode === "auto") {
    startPolling();
  }

  log.info("App ready. Mode:", config.mode, "Software:", config.softwareType);

  initAutoUpdater();
  onUpdateStatus((us) => {
    mainWindow?.webContents.send("update-status", us);
  });
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => {
  // Keep running in tray
});

app.on("activate", () => {
  showWindow();
});

// ─── IPC Handlers ────────────────────────────────────────────

ipcMain.handle("get-app-version", () => app.getVersion());
ipcMain.handle("get-config", () => getConfig());

ipcMain.handle(
  "set-config",
  (_event, partial: Record<string, unknown>) => {
    setConfig(partial as Parameters<typeof setConfig>[0]);
    const config = getConfig();
    status.mode = config.mode;

    if (config.mode === "auto") {
      startPolling();
    } else {
      stopPolling();
    }
    sendStatus();
    return config;
  },
);

ipcMain.handle("get-status", () => status);

ipcMain.handle(
  "manual-push",
  async (_event, title: string, artist: string) => {
    const track: TrackInfo = {
      title,
      artist,
      playedAt: new Date().toISOString(),
    };
    log.info("Manual push:", artist, "–", title);
    try {
      const result = await pushTrack(track);
      status.lastTrack = track;
      status.lastResult = result;
      status.connected = true;
      status.error = null;
      if (result.matched) {
        showNotification(
          "Request Matched!",
          `"${title}" by ${artist} matched a request.`,
        );
      }
      sendStatus();
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("Manual push failed:", message);
      status.error = `Manual push failed: ${message}`;
      status.connected = false;
      sendStatus();
      throw err;
    }
  },
);

ipcMain.handle("resolve-db-path", () => {
  const dbPath = resolveDbPath();
  status.dbPath = dbPath;
  log.info("Resolved DB path:", dbPath);
  sendStatus();
  return dbPath;
});

ipcMain.handle("resolve-serato-path", () => {
  const config = getConfig();
  const sessDir = resolveSeratoSessionDir(config.musicLibraryPath || undefined);
  log.info("Resolved Serato session dir:", sessDir);
  return sessDir;
});

ipcMain.handle("detect-software", () => {
  const config = getConfig();
  const sw = detectSoftware(config.musicLibraryPath || undefined);
  log.info("Detected software:", sw);
  return sw;
});

ipcMain.handle("poll-now", async () => {
  await pollOnce();
  return status;
});

ipcMain.handle("toggle-launch-at-login", () => {
  toggleLaunchAtLogin();
  return status.launchAtLogin;
});

ipcMain.handle("fetch-events", async () => {
  try {
    const events = await fetchEvents();
    log.info("Fetched events:", events.length);
    return events;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("Failed to fetch events:", message);
    return [];
  }
});

ipcMain.handle("fetch-event-sources", async (_e, eventId: string) => {
  try {
    const sources = await fetchEventSources(eventId);
    log.info("Fetched sources for event", eventId, ":", sources.length);
    return sources;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("Failed to fetch event sources:", message);
    return [];
  }
});

ipcMain.handle("open-logs", () => {
  const { shell } = require("electron");
  shell.openPath(app.getPath("logs"));
});

ipcMain.handle("browse-folder", async () => {
  const { dialog } = require("electron");
  const result = await dialog.showOpenDialog({
    title: "Select Music Library Folder",
    properties: ["openDirectory"],
    message: "Choose the drive or folder containing your _Serato_ folder",
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle("sync-library", async () => {
  const config = getConfig();
  const customPath = config.musicLibraryPath || undefined;
  const scanBoth = config.softwareType === "auto";
  const sw = scanBoth ? detectSoftware(customPath) : config.softwareType;

  log.info("Library sync starting, software:", sw, "scanBoth:", scanBoth);

  const allTracks: Array<{ title: string; artist: string; playCount: number }> = [];

  if (sw === "rekordbox" || scanBoth) {
    try {
      const dbPath = resolveDbPath();
      if (dbPath) {
        const rbTracks = await readRekordboxLibrary(dbPath, config.sqlcipherKey || undefined);
        log.info("Rekordbox library:", rbTracks.length, "tracks");
        allTracks.push(...rbTracks);
      }
    } catch (err) {
      log.error("Rekordbox library scan error:", err instanceof Error ? err.message : String(err));
    }
  }

  if (sw === "serato" || scanBoth) {
    try {
      const seratoTracks = await readSeratoLibrary(customPath);
      log.info("Serato library:", seratoTracks.length, "tracks");
      allTracks.push(...seratoTracks);
    } catch (err) {
      log.error("Serato library scan error:", err instanceof Error ? err.message : String(err));
    }
  }

  if (allTracks.length === 0) {
    return { error: "No tracks found in any DJ library." };
  }

  // Deduplicate by normalized title+artist, keeping highest play count
  const bestByKey = new Map<string, typeof allTracks[0]>();
  for (const t of allTracks) {
    const key = `${t.title.toLowerCase().trim()}::${t.artist.toLowerCase().trim()}`;
    const existing = bestByKey.get(key);
    if (!existing || t.playCount > existing.playCount) {
      bestByKey.set(key, t);
    }
  }
  const unique = [...bestByKey.values()];

  log.info("Syncing", unique.length, "unique tracks (from", allTracks.length, "total)");

  try {
    const result = await syncLibrary(unique);
    log.info("Library sync complete:", result);
    showNotification("Library Synced", `${result.trackCount} tracks uploaded.`);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("Library sync failed:", message);
    return { error: message };
  }
});

let lastRequestCount = -1;
ipcMain.handle("fetch-requests", async (_e, statusFilter?: string) => {
  try {
    const requests = await fetchRequests(statusFilter);
    if (requests.length !== lastRequestCount) {
      log.info("Requests:", requests.length, statusFilter ?? "all");
      lastRequestCount = requests.length;
    }
    return requests;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("Failed to fetch requests:", message);
    return [];
  }
});

ipcMain.handle(
  "review-request",
  async (_e, requestId: string, newStatus: "approved" | "vetoed" | "played") => {
    log.info("Review request:", requestId, "→", newStatus);
    const result = await reviewRequest(requestId, newStatus);
    return result;
  },
);

ipcMain.handle("fetch-genre-votes", async () => {
  try {
    return await fetchGenreVotes();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("Failed to fetch genre votes:", message);
    return { hip_hop: 0, country: 0, edm: 0, alternative_rock: 0, total: 0 };
  }
});

ipcMain.handle("get-update-status", () => getUpdateStatus());

ipcMain.handle("check-for-updates", () => {
  checkForUpdates();
});

ipcMain.handle("quit-and-install", () => {
  log.info("Quit-and-install requested, setting isQuitting=true");
  isQuitting = true;
  quitAndInstall();
});
