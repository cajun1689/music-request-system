import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("bridge", {
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  getConfig: () => ipcRenderer.invoke("get-config"),
  setConfig: (partial: Record<string, unknown>) =>
    ipcRenderer.invoke("set-config", partial),
  getStatus: () => ipcRenderer.invoke("get-status"),
  manualPush: (title: string, artist: string) =>
    ipcRenderer.invoke("manual-push", title, artist),
  resolveDbPath: () => ipcRenderer.invoke("resolve-db-path"),
  resolveSeratoPath: () => ipcRenderer.invoke("resolve-serato-path"),
  detectSoftware: () => ipcRenderer.invoke("detect-software"),
  syncLibrary: () => ipcRenderer.invoke("sync-library"),
  pollNow: () => ipcRenderer.invoke("poll-now"),
  fetchEvents: () => ipcRenderer.invoke("fetch-events"),
  toggleLaunchAtLogin: () => ipcRenderer.invoke("toggle-launch-at-login"),
  openLogs: () => ipcRenderer.invoke("open-logs"),
  getUpdateStatus: () => ipcRenderer.invoke("get-update-status"),
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  quitAndInstall: () => ipcRenderer.invoke("quit-and-install"),
  onStatusUpdate: (callback: (status: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) =>
      callback(data);
    ipcRenderer.on("status-update", handler);
    return () => ipcRenderer.removeListener("status-update", handler);
  },
  onUpdateStatus: (callback: (status: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) =>
      callback(data);
    ipcRenderer.on("update-status", handler);
    return () => ipcRenderer.removeListener("update-status", handler);
  },
  onMainLog: (callback: (entry: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) =>
      callback(data);
    ipcRenderer.on("main-log", handler);
    return () => ipcRenderer.removeListener("main-log", handler);
  },
});
