try {
  var electron = require("electron");
  var contextBridge = electron.contextBridge;
  var ipcRenderer = electron.ipcRenderer;

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
    fetchRequests: function (statusFilter) { return ipcRenderer.invoke("fetch-requests", statusFilter); },
    reviewRequest: function (requestId, status) { return ipcRenderer.invoke("review-request", requestId, status); },
    approveShoutout: function (requestId, approved, autoStatus) { return ipcRenderer.invoke("approve-shoutout", requestId, approved, autoStatus); },
    fetchGenreVotes: function () { return ipcRenderer.invoke("fetch-genre-votes"); },
    fetchEventStatus: function () { return ipcRenderer.invoke("fetch-event-status"); },
    toggleFireSale: function (active, message) { return ipcRenderer.invoke("toggle-fire-sale", active, message); },
    testConnection: function (forceReconnect) { return ipcRenderer.invoke("test-connection", forceReconnect); },
    pollNow: function () { return ipcRenderer.invoke("poll-now"); },
    pushPendingNow: function () { return ipcRenderer.invoke("push-pending-now"); },
    fetchEvents: function () { return ipcRenderer.invoke("fetch-events"); },
    fetchEventSources: function (eventId) { return ipcRenderer.invoke("fetch-event-sources", eventId); },
    toggleLaunchAtLogin: function () { return ipcRenderer.invoke("toggle-launch-at-login"); },
    openLogs: function () { return ipcRenderer.invoke("open-logs"); },
    browseFolder: function () { return ipcRenderer.invoke("browse-folder"); },
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

  contextBridge.exposeInMainWorld("_preloadOk", true);
} catch (err) {
  console.error("PRELOAD FAILED:", err);
  try {
    require("electron").contextBridge.exposeInMainWorld("_preloadError", String(err));
  } catch (e2) {
    // last resort
  }
}
