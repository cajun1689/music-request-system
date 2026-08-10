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
import {
  getConfig,
  getEffectivePushSourceId,
  setConfig,
  type ConfigSchema,
  type DJSoftwareType,
} from "./config-store";
import {
  getEffectiveEventId,
  hasBridgeCredential,
} from "./bridge-auth";
import {
  detectRekordboxVersion,
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
  listShowKontrolNetworkInterfaces,
  ShowKontrolReader,
  type ShowKontrolReaderStatus,
} from "./showkontrol-reader";
import {
  approveShoutout,
  drainQueue,
  enqueueTrack,
  fetchEvents,
  fetchEventSources,
  fetchEventStatus,
  fetchGenreVotes,
  fetchRequests,
  pairDevice,
  unpairDevice,
  toggleFireSale,
  pushTrack,
  reviewRequest,
  syncLibrary,
  testConnection,
  queueSize,
  type PushResult,
  type RequestItem,
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
let pollQueue: Promise<void> = Promise.resolve();
let requestsPollTimer: ReturnType<typeof setInterval> | null = null;
let lastTrackKey = "";
let lastPushedKey = "";
let lastHeartbeatPushAt = 0;
let pendingTrack: TrackInfo | null = null;
let pendingTrackSince = 0;
let lastPollError = "";
let isQuitting = false;
let pendingRequestIds = new Set<string>();
let flaggedShoutoutIds = new Set<string>();
let requestsPollerInitialized = false;
let showKontrolReader: ShowKontrolReader | null = null;
let showKontrolReaderKey = "";
let showKontrolStartPromise: Promise<void> | null = null;

function isBridgeConfigured(config = getConfig()): boolean {
  return Boolean(getEffectiveEventId(config) && hasBridgeCredential(config));
}

interface StatusPayload {
  connected: boolean;
  mode: "auto" | "manual";
  softwareType: DJSoftwareType;
  activeSoftware: Exclude<DJSoftwareType, "auto"> | null;
  dbPath: string | null;
  lastTrack: TrackInfo | null;
  pendingTrack: TrackInfo | null;
  pendingSeconds: number;
  lastResult: PushResult | null;
  error: string | null;
  queueSize: number;
  transitionDelaySec: number;
  version: string;
  logsPath: string;
  launchAtLogin: boolean;
  pendingRequestsCount: number;
  flaggedShoutoutsCount: number;
  rekordboxVersion: number | null;
  showKontrol: ShowKontrolReaderStatus | null;
}

let status: StatusPayload = {
  connected: false,
  mode: "auto",
  softwareType: "auto",
  activeSoftware: null,
  dbPath: null,
  lastTrack: null,
  pendingTrack: null,
  pendingSeconds: 0,
  lastResult: null,
  error: null,
  queueSize: 0,
  transitionDelaySec: 45,
  version: "",
  logsPath: "",
  launchAtLogin: false,
  pendingRequestsCount: 0,
  flaggedShoutoutsCount: 0,
  rekordboxVersion: null,
  showKontrol: null,
};

function sendStatus(): void {
  status.pendingTrack = pendingTrack;
  status.pendingSeconds = pendingTrack && pendingTrackSince > 0
    ? Math.round((Date.now() - pendingTrackSince) / 1000)
    : 0;
  const config = getConfig();
  status.transitionDelaySec = config.transitionDelaySec ?? 45;
  status.showKontrol = showKontrolReader?.getStatus() ?? status.showKontrol;
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
  if (status.pendingRequestsCount > 0) {
    parts.push(`📥 ${status.pendingRequestsCount} pending request${status.pendingRequestsCount === 1 ? "" : "s"}`);
  }
  if (status.flaggedShoutoutsCount > 0) {
    parts.push(`⚠️ ${status.flaggedShoutoutsCount} flagged shoutout${status.flaggedShoutoutsCount === 1 ? "" : "s"}`);
  }
  if (status.lastTrack) {
    parts.push(`♫ ${status.lastTrack.artist} – ${status.lastTrack.title}`);
  }
  if (status.pendingTrack) {
    parts.push(`⏳ ${status.pendingTrack.artist} – ${status.pendingTrack.title}`);
  }
  if (status.error) {
    parts.push(`⚠ ${status.error}`);
  }
  tray.setToolTip(parts.join("\n"));
}

function updateTrayTitle(): void {
  if (!tray) return;
  if (typeof tray.setTitle !== "function") return;
  if (status.pendingRequestsCount > 0) {
    tray.setTitle(` ${status.pendingRequestsCount}`);
  } else if (status.flaggedShoutoutsCount > 0) {
    tray.setTitle(` ⚠️`);
  } else {
    tray.setTitle("");
  }
}

function updateTrayMenu(): void {
  buildTrayMenu();
}

let cachedContextMenu: Electron.Menu | null = null;

function buildTrayMenu(): void {
  if (!tray) return;
  updateTrayTooltip();
  updateTrayTitle();

  const trackLabel = status.lastTrack
    ? `♫ ${status.lastTrack.artist} – ${status.lastTrack.title}`
    : "No track detected";

  const statusLabel = status.connected
    ? "● Connected"
    : status.error
      ? "● Error"
      : "○ Idle";

  const pendingLabel =
    status.pendingRequestsCount > 0
      ? `📥 ${status.pendingRequestsCount} pending request${status.pendingRequestsCount === 1 ? "" : "s"}`
      : "📥 No pending requests";
  const flaggedLabel =
    status.flaggedShoutoutsCount > 0
      ? `⚠️ ${status.flaggedShoutoutsCount} flagged shoutout${status.flaggedShoutoutsCount === 1 ? "" : "s"}`
      : null;

  cachedContextMenu = Menu.buildFromTemplate([
    { label: statusLabel, enabled: false },
    { label: trackLabel, enabled: false },
    { type: "separator" },
    { label: pendingLabel, enabled: false },
    ...(flaggedLabel ? [{ label: flaggedLabel, enabled: false } as Electron.MenuItemConstructorOptions] : []),
    { type: "separator" },
    { label: "Show Window", click: showWindow },
    { type: "separator" },
    {
      label: `Software: ${status.activeSoftware ?? status.softwareType}${
        status.activeSoftware === "rekordbox" && status.rekordboxVersion ? ` v${status.rekordboxVersion}` : ""
      }`,
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
    void stopShowKontrolReader();
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

function resetTrackDetectionState(): void {
  lastTrackKey = "";
  lastPushedKey = "";
  lastHeartbeatPushAt = 0;
  pendingTrack = null;
  pendingTrackSince = 0;
}

async function stopShowKontrolReader(): Promise<void> {
  const reader = showKontrolReader;
  showKontrolReader = null;
  showKontrolReaderKey = "";
  showKontrolStartPromise = null;
  if (reader) {
    await reader.stop();
    log.info("ShowKontrol TCNet reader stopped");
  }
  status.showKontrol = null;
}

async function ensureShowKontrolReader(config: ConfigSchema): Promise<ShowKontrolReader> {
  const key = [
    config.showKontrolInterface,
    config.showKontrolConfirmSec,
    config.transitionDelaySec,
  ].join(":");

  const existingState = showKontrolReader?.getStatus().state;
  if (
    showKontrolReader
    && showKontrolReaderKey === key
    && existingState !== "stopped"
    && existingState !== "error"
  ) {
    if (showKontrolStartPromise) await showKontrolStartPromise;
    return showKontrolReader;
  }

  await stopShowKontrolReader();
  const reader = new ShowKontrolReader(
    {
      networkInterface: config.showKontrolInterface || undefined,
      confirmationSeconds: config.showKontrolConfirmSec ?? 10,
      fallbackConfirmationSeconds: config.transitionDelaySec ?? 45,
      onStatus: (showKontrolStatus) => {
        if (showKontrolReader !== reader) return;
        status.showKontrol = showKontrolStatus;
        if (status.activeSoftware === "showkontrol") {
          status.connected = showKontrolStatus.connected;
          status.error = showKontrolStatus.lastError;
        }
        sendStatus();
      },
      onTrack: () => {
        if (showKontrolReader !== reader || getConfig().softwareType !== "showkontrol") return;
        // Process an on-air edge immediately instead of waiting for the normal
        // ten-second file-reader polling interval.
        void pollOnce();
      },
    },
    log,
  );

  showKontrolReader = reader;
  showKontrolReaderKey = key;
  showKontrolStartPromise = reader.start()
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      status.error = `ShowKontrol connection failed: ${message}`;
      status.connected = false;
      log.error(status.error);
      throw error;
    })
    .finally(() => {
      showKontrolStartPromise = null;
    });
  await showKontrolStartPromise;
  return reader;
}

function detectSoftware(customPath?: string): "rekordbox" | "serato" | null {
  if (resolveDbPath()) return "rekordbox";
  if (resolveSeratoSessionDir(customPath)) return "serato";
  return null;
}

async function readTrackForSoftware(
  sw: Exclude<DJSoftwareType, "auto">,
  config: ReturnType<typeof getConfig>,
): Promise<TrackInfo | null> {
  if (sw === "showkontrol") {
    const reader = await ensureShowKontrolReader(config);
    status.dbPath = null;
    status.showKontrol = reader.getStatus();
    const track = reader.readCurrentTrack();
    return track
      ? {
          ...track,
          pushSourceId: getEffectivePushSourceId(config),
          sourceAliasId: config.sourceId.trim(),
        }
      : null;
  }

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

function pollOnce(): Promise<void> {
  const next = pollQueue.then(
    () => pollOnceInternal(),
    () => pollOnceInternal(),
  );
  pollQueue = next.catch(() => undefined);
  return next;
}

async function pollOnceInternal(): Promise<void> {
  const config = getConfig();
  if (config.mode !== "auto") return;
  status.softwareType = config.softwareType;

  if (!isBridgeConfigured(config)) {
    status.error = "Pair this device or configure an Event ID and Push Token.";
    sendStatus();
    return;
  }

  let sw: Exclude<DJSoftwareType, "auto"> | null = null;
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
  if (sw !== "showkontrol" && showKontrolReader) {
    await stopShowKontrolReader();
  }

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
      if (sw === "showkontrol") {
        const showKontrolStatus = showKontrolReader?.getStatus() ?? null;
        status.showKontrol = showKontrolStatus;
        status.connected = showKontrolStatus?.connected ?? false;
        status.error = showKontrolStatus?.lastError
          ?? (showKontrolStatus?.connected ? null : "Waiting for ShowKontrol on the TCNet network…");
      } else {
        status.error = null;
      }
      sendStatus();
      return;
    }

    const key = trackKey(track);
    const now = Date.now();

    // Check if the pending track's transition delay has elapsed
    const transitionDelayMs = track.playbackConfirmed
      ? 0
      : (config.transitionDelaySec ?? 45) * 1000;
    if (pendingTrack && pendingTrackSince > 0) {
      const pendingKey = trackKey(pendingTrack);
      const elapsed = now - pendingTrackSince;
      if (elapsed >= transitionDelayMs && pendingKey !== lastPushedKey) {
        log.info(`Transition delay elapsed, pushing:`, pendingTrack.artist, "–", pendingTrack.title);
        try {
          const result = await pushTrack(pendingTrack);
          lastPushedKey = pendingKey;
          lastHeartbeatPushAt = now;
          status.lastResult = result;
          status.lastTrack = pendingTrack;
          status.connected = true;
          status.queueSize = queueSize();

          if (result.matched) {
            log.info("Track matched request!", { score: result.confidenceScore });
            showNotification(
              "Request Matched!",
              `"${pendingTrack.title}" by ${pendingTrack.artist} matched a request.`,
            );
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log.error("Pending push failed:", message);
          status.error = `Push failed: ${message}`;
          status.connected = false;
          enqueueTrack(pendingTrack);
          status.queueSize = queueSize();
        }
        pendingTrack = null;
        pendingTrackSince = 0;
      }
    }

    if (key === lastTrackKey) {
      if (queueSize() > 0) {
        await drainQueue();
        status.queueSize = queueSize();
      }
      // Heartbeat: re-push the current track periodically so the dashboard
      // keeps showing this source as active while the same song is playing.
      const HEARTBEAT_PUSH_MS = 45_000;
      if (
        lastPushedKey === key &&
        track &&
        now - lastHeartbeatPushAt >= HEARTBEAT_PUSH_MS
      ) {
        lastHeartbeatPushAt = now;
        try {
          await pushTrack(track);
          status.connected = true;
          status.lastTrack = track;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log.warn("Heartbeat push failed:", message);
        }
      }
      sendStatus();
      return;
    }

    lastTrackKey = key;
    status.error = null;
    log.info(`New track detected from ${sw}:`, track.artist, "–", track.title);

    // First track of the session, or delay set to 0 — push immediately
    if (!lastPushedKey || transitionDelayMs === 0) {
      log.info("First track of session, pushing immediately");
      status.lastTrack = track;
      try {
        const result = await pushTrack(track);
        lastPushedKey = key;
        lastHeartbeatPushAt = now;
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
    } else {
      // If there's already a pending track, push it now (loading a third track
      // means the DJ has transitioned to the pending one)
      if (pendingTrack) {
        const prevPendingKey = trackKey(pendingTrack);
        if (prevPendingKey !== lastPushedKey) {
          log.info("New track loaded — flushing pending track:", pendingTrack.artist, "–", pendingTrack.title);
          try {
            const result = await pushTrack(pendingTrack);
            lastPushedKey = prevPendingKey;
            lastHeartbeatPushAt = now;
            status.lastResult = result;
            status.connected = true;
            status.queueSize = queueSize();
            if (result.matched) {
              log.info("Track matched request!", { score: result.confidenceScore });
              showNotification(
                "Request Matched!",
                `"${pendingTrack.title}" by ${pendingTrack.artist} matched a request.`,
              );
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log.error("Flush pending failed:", message);
            enqueueTrack(pendingTrack);
            status.queueSize = queueSize();
          }
        }
      }

      // Queue the new track with transition delay
      log.info(`Track queued with ${transitionDelayMs / 1000}s transition delay`);
      pendingTrack = track;
      pendingTrackSince = now;
      status.lastTrack = track;
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

const REQUESTS_POLL_MS = 8_000;

async function pollRequestsOnce(): Promise<void> {
  const config = getConfig();
  if (!isBridgeConfigured(config)) return;

  try {
    const all = await fetchRequests();
    if (!Array.isArray(all)) return;

    const pending = all.filter((r) => {
      if (r.status !== "pending") return false;
      const isShoutoutOnly = !!r.shoutout && !r.songTitle;
      if (isShoutoutOnly && r.shoutoutApproved === true) return false;
      return true;
    });
    const flagged = all.filter(
      (r) =>
        !!r.shoutout &&
        (r.shoutoutFlagSeverity === "warn" || r.shoutoutFlagSeverity === "block") &&
        r.shoutoutApproved !== false &&
        r.shoutoutApproved !== true,
    );

    const newPendingIds = new Set(pending.map((r) => r.requestId));
    const incoming = pending.filter((r) => !pendingRequestIds.has(r.requestId));

    if (incoming.length > 0 && requestsPollerInitialized) {
      const first = incoming[0];
      const summary = first.shoutout && !first.songTitle
        ? `Shoutout from ${first.requesterName || "Guest"}`
        : `${first.songTitle || "Unknown"}${first.artistName ? " — " + first.artistName : ""}`;
      showNotification(
        incoming.length > 1 ? `${incoming.length} new requests` : "New request",
        incoming.length > 1 ? `Latest: ${summary}` : summary,
      );
    }

    pendingRequestIds = newPendingIds;
    const newFlaggedIds = new Set(flagged.map((r) => r.requestId));
    const newlyFlagged = flagged.filter((r) => !flaggedShoutoutIds.has(r.requestId));
    if (newlyFlagged.length > 0 && requestsPollerInitialized) {
      const first = newlyFlagged[0];
      showNotification(
        newlyFlagged.length > 1 ? `${newlyFlagged.length} flagged shoutouts` : "Flagged shoutout",
        first.shoutoutFlagReason || "Review before approving",
      );
    }
    flaggedShoutoutIds = newFlaggedIds;

    const changed =
      status.pendingRequestsCount !== pending.length ||
      status.flaggedShoutoutsCount !== flagged.length;

    status.pendingRequestsCount = pending.length;
    status.flaggedShoutoutsCount = flagged.length;
    requestsPollerInitialized = true;

    if (changed) {
      mainWindow?.webContents.send("requests-updated", {
        pending: pending.length,
        flagged: flagged.length,
      });
      sendStatus();
    } else {
      updateTrayTitle();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("Requests poll failed:", msg);
  }
}

function startRequestsPolling(): void {
  stopRequestsPolling();
  log.info("Starting requests poll, interval:", REQUESTS_POLL_MS, "ms");
  void pollRequestsOnce();
  requestsPollTimer = setInterval(() => void pollRequestsOnce(), REQUESTS_POLL_MS);
}

function stopRequestsPolling(): void {
  if (requestsPollTimer) {
    clearInterval(requestsPollTimer);
    requestsPollTimer = null;
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
  status.rekordboxVersion = detectRekordboxVersion();
  if (status.rekordboxVersion) {
    log.info("Detected Rekordbox v" + status.rekordboxVersion);
  }

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
  if (isBridgeConfigured(config)) {
    startRequestsPolling();
  }

  log.info("App ready. Mode:", config.mode, "Software:", config.softwareType);

  initAutoUpdater();
  onUpdateStatus((us) => {
    mainWindow?.webContents.send("update-status", us);
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  void stopShowKontrolReader();
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

ipcMain.handle("pair-device", async (_event, code: string, deviceName: string) => {
  const result = await pairDevice(code, deviceName);
  setConfig({
    deviceId: result.deviceId,
    deviceToken: result.deviceToken,
    organizationId: result.organizationId,
    pairedEventId: result.eventId,
    pairedSourceId: result.sourceId,
    pairedEventName: result.eventName,
    pairedOrganizationName: result.organizationName,
  });

  resetTrackDetectionState();
  status.error = null;
  requestsPollerInitialized = false;
  pendingRequestIds = new Set();
  flaggedShoutoutIds = new Set();
  if (getConfig().mode === "auto") startPolling();
  startRequestsPolling();
  sendStatus();
  log.info("Device paired:", result.deviceId, result.organizationId, result.eventId);
  return result;
});

ipcMain.handle("clear-device-pairing", async () => {
  let remoteRevoked = true;
  try {
    await unpairDevice();
  } catch (error) {
    remoteRevoked = false;
    log.warn("Could not revoke pairing remotely; clearing local credential:", String(error));
  }
  setConfig({
    deviceId: "",
    deviceToken: "",
    organizationId: "",
    pairedEventId: "",
    pairedSourceId: "",
    pairedEventName: "",
    pairedOrganizationName: "",
  });

  resetTrackDetectionState();
  status.error = null;
  const config = getConfig();
  if (config.mode === "auto") startPolling();
  if (isBridgeConfigured(config)) {
    requestsPollerInitialized = false;
    pendingRequestIds = new Set();
    flaggedShoutoutIds = new Set();
    startRequestsPolling();
  } else {
    stopRequestsPolling();
    status.pendingRequestsCount = 0;
    status.flaggedShoutoutsCount = 0;
  }
  sendStatus();
  log.info("Device pairing cleared; legacy configuration retained");
  return { ...config, remoteRevoked };
});

ipcMain.handle(
  "set-config",
  async (_event, partial: Record<string, unknown>) => {
    const current = getConfig();
    const proposed = {
      ...current,
      ...(partial as Partial<ConfigSchema>),
    };

    if (proposed.softwareType === "showkontrol") {
      const generatedSourceId = `${proposed.sourceId.trim() || "booth"}-showkontrol`;
      proposed.showKontrolSourceId = proposed.showKontrolSourceId.trim() || generatedSourceId;
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/.test(proposed.showKontrolSourceId)) {
        throw new Error(
          "ShowKontrol Source ID must be 2-64 characters using letters, numbers, dashes, or underscores.",
        );
      }
      if (proposed.showKontrolSourceId === proposed.sourceId.trim()) {
        throw new Error(
          "ShowKontrol Source ID must be different from the selected live-playlist source. "
          + "Add -showkontrol to keep dashboard slots separate.",
        );
      }

      try {
        const liveSources = proposed.eventId
          ? await fetchEventSources(proposed.eventId)
          : [];
        if (liveSources.some((source) => source.id === proposed.showKontrolSourceId)) {
          throw new Error(
            `ShowKontrol Source ID "${proposed.showKontrolSourceId}" conflicts with a live-playlist source. `
            + "Use a unique ID such as booth-showkontrol.",
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("conflicts with a live-playlist source")) {
          throw error;
        }
        log.warn("Could not validate ShowKontrol source ID against event sources:", message);
      }
    }

    await stopShowKontrolReader();
    resetTrackDetectionState();
    setConfig(proposed);
    const config = getConfig();
    status.mode = config.mode;
    status.softwareType = config.softwareType;
    status.activeSoftware = null;

    if (config.mode === "auto") {
      startPolling();
    } else {
      stopPolling();
    }

    if (isBridgeConfigured(config)) {
      requestsPollerInitialized = false;
      pendingRequestIds = new Set();
      flaggedShoutoutIds = new Set();
      startRequestsPolling();
    } else {
      stopRequestsPolling();
      status.pendingRequestsCount = 0;
      status.flaggedShoutoutsCount = 0;
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
  if (config.softwareType === "showkontrol") {
    return showKontrolReader?.getStatus().connected ? "showkontrol" : null;
  }
  const sw = detectSoftware(config.musicLibraryPath || undefined);
  log.info("Detected software:", sw);
  return sw;
});

ipcMain.handle("get-showkontrol-interfaces", () => listShowKontrolNetworkInterfaces());
ipcMain.handle("get-showkontrol-status", () => showKontrolReader?.getStatus() ?? null);
ipcMain.handle("restart-showkontrol", async () => {
  const config = getConfig();
  await stopShowKontrolReader();
  if (config.mode !== "auto" || config.softwareType !== "showkontrol") {
    return null;
  }
  const reader = await ensureShowKontrolReader(config);
  return reader.getStatus();
});

ipcMain.handle("poll-now", async () => {
  await pollOnce();
  return status;
});

ipcMain.handle("push-pending-now", async () => {
  if (!pendingTrack) {
    return { error: "No pending track" };
  }
  const track = pendingTrack;
  const key = trackKey(track);
  log.info("Manual push-pending-now:", track.artist, "–", track.title);
  try {
    const result = await pushTrack(track);
    lastPushedKey = key;
    lastHeartbeatPushAt = Date.now();
    status.lastResult = result;
    status.lastTrack = track;
    status.connected = true;
    status.queueSize = queueSize();
    pendingTrack = null;
    pendingTrackSince = 0;
    if (result.matched) {
      showNotification(
        "Request Matched!",
        `"${track.title}" by ${track.artist} matched a request.`,
      );
    }
    sendStatus();
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("Push pending failed:", message);
    status.error = `Push failed: ${message}`;
    sendStatus();
    throw err;
  }
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
  // ShowKontrol supplies live deck metadata, not the complete USB/library.
  // Keep scanning local Rekordbox and Serato libraries for request suggestions.
  const scanBoth = config.softwareType === "auto" || config.softwareType === "showkontrol";
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

ipcMain.handle(
  "approve-shoutout",
  async (_e, requestId: string, approved: boolean, autoStatus?: string) => {
    log.info("Shoutout review:", requestId, "→", approved ? "approved" : "rejected", autoStatus ?? "");
    const result = await approveShoutout(requestId, approved, autoStatus as "played" | "vetoed" | undefined);
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

ipcMain.handle("fetch-event-status", async () => {
  try {
    return await fetchEventStatus();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("Failed to fetch event status:", message);
    return {
      genreVotes: { hip_hop: 0, country: 0, edm: 0, alternative_rock: 0, total: 0 },
      fireSaleActive: false,
    };
  }
});

ipcMain.handle("toggle-fire-sale", async (_e, active: boolean, message?: string) => {
  log.info("Fire sale:", active ? "ON" : "OFF");
  try {
    return await toggleFireSale(active, message);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("Fire sale toggle failed:", msg);
    throw err;
  }
});

ipcMain.handle("test-connection", async (_e, forceReconnect?: boolean) => {
  try {
    const result = await testConnection(Boolean(forceReconnect));
    log.info("Connection test result:", JSON.stringify(result));
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("Connection test failed:", msg);
    throw err;
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
