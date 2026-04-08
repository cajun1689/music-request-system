const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bridge", {
  getAppVersion: function () { return ipcRenderer.invoke("get-app-version"); },
  getConfig: function () { return ipcRenderer.invoke("get-config"); },
  setConfig: function (partial) { return ipcRenderer.invoke("set-config", partial); },
  getStatus: function () { return ipcRenderer.invoke("get-status"); },
  manualPush: function (title, artist) { return ipcRenderer.invoke("manual-push", title, artist); },
  resolveDbPath: function () { return ipcRenderer.invoke("resolve-db-path"); },
  resolveSeratoPath: function () { return ipcRenderer.invoke("resolve-serato-path"); },
  detectSoftware: function () { return ipcRenderer.invoke("detect-software"); },
  syncLibrary: function () { return ipcRenderer.invoke("sync-library"); },
  pollNow: function () { return ipcRenderer.invoke("poll-now"); },
  fetchEvents: function () { return ipcRenderer.invoke("fetch-events"); },
  toggleLaunchAtLogin: function () { return ipcRenderer.invoke("toggle-launch-at-login"); },
  openLogs: function () { return ipcRenderer.invoke("open-logs"); },
  getUpdateStatus: function () { return ipcRenderer.invoke("get-update-status"); },
  checkForUpdates: function () { return ipcRenderer.invoke("check-for-updates"); },
  quitAndInstall: function () { return ipcRenderer.invoke("quit-and-install"); },
  onStatusUpdate: function (callback) {
    var handler = function (_event, data) { callback(data); };
    ipcRenderer.on("status-update", handler);
    return function () { ipcRenderer.removeListener("status-update", handler); };
  },
  onUpdateStatus: function (callback) {
    var handler = function (_event, data) { callback(data); };
    ipcRenderer.on("update-status", handler);
    return function () { ipcRenderer.removeListener("update-status", handler); };
  },
  onMainLog: function (callback) {
    var handler = function (_event, data) { callback(data); };
    ipcRenderer.on("main-log", handler);
    return function () { ipcRenderer.removeListener("main-log", handler); };
  },
});
