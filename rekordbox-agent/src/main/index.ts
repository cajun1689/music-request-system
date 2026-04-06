import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage } from "electron";
import * as path from "path";
import { getConfig, setConfig } from "./config-store";
import { readCurrentTrack, resolveDbPath, type TrackInfo } from "./rekordbox-reader";
import { drainQueue, enqueueTrack, pushTrack, queueSize, type PushResult } from "./api-client";

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
}

let status: StatusPayload = {
  connected: false,
  mode: "auto",
  dbPath: null,
  lastTrack: null,
  lastResult: null,
  error: null,
  queueSize: 0,
};

function sendStatus(): void {
  mainWindow?.webContents.send("status-update", status);
}

function trackKey(t: TrackInfo): string {
  return `${t.artist}::${t.title}::${t.playedAt}`;
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
      status.error = "Rekordbox database not found. Check that Rekordbox is installed.";
      status.connected = false;
      sendStatus();
      return;
    }
    status.dbPath = dbPath;

    const track = await readCurrentTrack(dbPath, config.sqlcipherKey || undefined);
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

    try {
      const result = await pushTrack(track);
      status.lastResult = result;
      status.connected = true;
      status.queueSize = queueSize();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      status.error = `Push failed: ${message}`;
      status.connected = false;
      enqueueTrack(track);
      status.queueSize = queueSize();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    status.error = `DB read error: ${message}`;
    status.connected = false;
  }

  sendStatus();
}

function startPolling(): void {
  stopPolling();
  const config = getConfig();
  const interval = config.pollingIntervalMs || 10_000;
  void pollOnce();
  pollTimer = setInterval(() => void pollOnce(), interval);
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 640,
    show: false,
    resizable: true,
    title: "Rekordbox Bridge",
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

function toggleWindow(): void {
  if (!mainWindow) {
    createWindow();
    mainWindow?.show();
    return;
  }
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

app.on("ready", () => {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip("Rekordbox Bridge");

  const contextMenu = Menu.buildFromTemplate([
    { label: "Show / Hide", click: toggleWindow },
    { type: "separator" },
    { label: "Quit", click: () => { app.exit(0); } },
  ]);
  tray.setContextMenu(contextMenu);
  tray.on("click", toggleWindow);

  createWindow();
  mainWindow?.show();

  const config = getConfig();
  status.mode = config.mode;
  if (config.mode === "auto") {
    startPolling();
  }
});

app.on("window-all-closed", (e: Event) => {
  e.preventDefault();
});

ipcMain.handle("get-config", () => getConfig());

ipcMain.handle("set-config", (_event, partial: Record<string, unknown>) => {
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
});

ipcMain.handle("get-status", () => status);

ipcMain.handle("manual-push", async (_event, title: string, artist: string) => {
  const track: TrackInfo = { title, artist, playedAt: new Date().toISOString() };
  try {
    const result = await pushTrack(track);
    status.lastTrack = track;
    status.lastResult = result;
    status.connected = true;
    status.error = null;
    sendStatus();
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    status.error = `Manual push failed: ${message}`;
    status.connected = false;
    sendStatus();
    throw err;
  }
});

ipcMain.handle("resolve-db-path", () => {
  const dbPath = resolveDbPath();
  status.dbPath = dbPath;
  sendStatus();
  return dbPath;
});

ipcMain.handle("poll-now", async () => {
  await pollOnce();
  return status;
});
