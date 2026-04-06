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
import log from "./logger";
import { getConfig, setConfig } from "./config-store";
import {
  readCurrentTrack,
  resolveDbPath,
  type TrackInfo,
} from "./rekordbox-reader";
import {
  drainQueue,
  enqueueTrack,
  fetchEvents,
  pushTrack,
  queueSize,
  type PushResult,
} from "./api-client";

log.info("Rekordbox Bridge starting", { version: app.getVersion() });

let tray: Tray | null = null;
let mainWindow: BrowserWindow | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastTrackKey = "";

interface StatusPayload {
  connected: boolean;
  mode: "auto" | "manual";
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
  return `${t.artist}::${t.title}::${t.playedAt}`;
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
  const parts = ["Rekordbox Bridge"];
  if (status.lastTrack) {
    parts.push(`${status.lastTrack.artist} – ${status.lastTrack.title}`);
  }
  if (status.error) {
    parts.push(`⚠ ${status.error}`);
  }
  tray.setToolTip(parts.join("\n"));
}

function updateTrayMenu(): void {
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

  const contextMenu = Menu.buildFromTemplate([
    { label: statusLabel, enabled: false },
    { label: trackLabel, enabled: false },
    { type: "separator" },
    { label: "Show Window", click: showWindow },
    { type: "separator" },
    {
      label: "Mode",
      submenu: [
        {
          label: "Auto (poll Rekordbox)",
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
      label: "Quit Rekordbox Bridge",
      click: () => {
        app.exit(0);
      },
    },
  ]);
  tray.setContextMenu(contextMenu);
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

async function pollOnce(): Promise<void> {
  const config = getConfig();
  if (config.mode !== "auto") return;

  if (!config.eventId || !config.pushToken) {
    status.error = "Event ID and Push Token must be configured.";
    sendStatus();
    return;
  }

  try {
    const dbPath = status.dbPath || resolveDbPath();
    if (!dbPath) {
      status.error =
        "Rekordbox database not found. Check that Rekordbox is installed.";
      status.connected = false;
      sendStatus();
      return;
    }
    status.dbPath = dbPath;

    const track = await readCurrentTrack(
      dbPath,
      config.sqlcipherKey || undefined,
    );
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
    log.info("New track detected:", track.artist, "–", track.title);

    try {
      const result = await pushTrack(track);
      status.lastResult = result;
      status.connected = true;
      status.queueSize = queueSize();

      if (result.matched) {
        log.info("Track matched request!", {
          score: result.confidenceScore,
        });
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
    log.error("DB read error:", message);
    status.error = `DB read error: ${message}`;
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

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 720,
    minWidth: 420,
    minHeight: 500,
    show: false,
    resizable: true,
    title: "Rekordbox Bridge",
    titleBarStyle: "hiddenInset",
    vibrancy: "sidebar",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

  mainWindow.on("close", (e) => {
    e.preventDefault();
    mainWindow?.hide();
  });
}

function showWindow(): void {
  if (!mainWindow) {
    createWindow();
  }
  if (mainWindow) {
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
    mainWindow.show();
    mainWindow.focus();
  }
}

app.on("ready", () => {
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
  tray.setToolTip("Rekordbox Bridge");
  tray.on("click", toggleWindow);
  updateTrayMenu();

  createWindow();
  mainWindow?.show();

  const config = getConfig();
  status.mode = config.mode;
  if (config.mode === "auto") {
    startPolling();
  }

  log.info("App ready. Mode:", config.mode);
});

app.on("window-all-closed", () => {
  // Keep running in tray
});

app.on("activate", () => {
  showWindow();
});

// ─── IPC Handlers ────────────────────────────────────────────

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

ipcMain.handle("open-logs", () => {
  const { shell } = require("electron");
  shell.openPath(app.getPath("logs"));
});
