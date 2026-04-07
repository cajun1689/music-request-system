import { autoUpdater, type UpdateInfo } from "electron-updater";
import log from "./logger";

export interface UpdateStatus {
  checking: boolean;
  available: boolean;
  downloaded: boolean;
  downloading: boolean;
  progress: number;
  version: string | null;
  error: string | null;
}

let status: UpdateStatus = {
  checking: false,
  available: false,
  downloaded: false,
  downloading: false,
  progress: 0,
  version: null,
  error: null,
};

type Listener = (status: UpdateStatus) => void;
const listeners: Listener[] = [];

function emit(): void {
  for (const fn of listeners) fn({ ...status });
}

export function onUpdateStatus(fn: Listener): () => void {
  listeners.push(fn);
  return () => {
    const idx = listeners.indexOf(fn);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

export function getUpdateStatus(): UpdateStatus {
  return { ...status };
}

export function initAutoUpdater(): void {
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    log.info("Updater: checking for update…");
    status = { ...status, checking: true, error: null };
    emit();
  });

  autoUpdater.on("update-available", (info: UpdateInfo) => {
    log.info("Updater: update available", info.version);
    status = {
      ...status,
      checking: false,
      available: true,
      version: info.version,
    };
    emit();
  });

  autoUpdater.on("update-not-available", () => {
    log.info("Updater: up to date");
    status = { ...status, checking: false, available: false };
    emit();
  });

  autoUpdater.on("download-progress", (progress) => {
    status = {
      ...status,
      downloading: true,
      progress: Math.round(progress.percent),
    };
    emit();
  });

  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
    log.info("Updater: update downloaded", info.version);
    status = {
      ...status,
      downloading: false,
      downloaded: true,
      progress: 100,
      version: info.version,
    };
    emit();
  });

  autoUpdater.on("error", (err: Error) => {
    log.error("Updater error:", err.message);
    status = {
      ...status,
      checking: false,
      downloading: false,
      error: err.message,
    };
    emit();
  });

  checkForUpdates();

  setInterval(checkForUpdates, 60 * 60 * 1000);
}

export function checkForUpdates(): void {
  autoUpdater.checkForUpdates().catch((err: Error) => {
    log.warn("Updater: check failed silently:", err.message);
  });
}

export function quitAndInstall(): void {
  log.info("Updater: quit and install");
  autoUpdater.quitAndInstall();
}
