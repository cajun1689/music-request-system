import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("bridge", {
  getConfig: () => ipcRenderer.invoke("get-config"),
  setConfig: (partial: Record<string, unknown>) =>
    ipcRenderer.invoke("set-config", partial),
  getStatus: () => ipcRenderer.invoke("get-status"),
  manualPush: (title: string, artist: string) =>
    ipcRenderer.invoke("manual-push", title, artist),
  resolveDbPath: () => ipcRenderer.invoke("resolve-db-path"),
  pollNow: () => ipcRenderer.invoke("poll-now"),
  toggleLaunchAtLogin: () => ipcRenderer.invoke("toggle-launch-at-login"),
  openLogs: () => ipcRenderer.invoke("open-logs"),
  onStatusUpdate: (callback: (status: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) =>
      callback(data);
    ipcRenderer.on("status-update", handler);
    return () => ipcRenderer.removeListener("status-update", handler);
  },
});
