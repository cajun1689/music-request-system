import Store from "electron-store";

export type DJSoftwareType = "rekordbox" | "serato" | "showkontrol" | "auto";

export interface ConfigSchema {
  apiBaseUrl: string;
  eventId: string;
  pushToken: string;
  pollingIntervalMs: number;
  sqlcipherKey: string;
  mode: "auto" | "manual";
  softwareType: DJSoftwareType;
  sourceId: string;
  musicLibraryPath: string;
  transitionDelaySec: number;
  showKontrolInterface: string;
  showKontrolConfirmSec: number;
  showKontrolSourceId: string;
}

const store = new Store<ConfigSchema>({
  defaults: {
    apiBaseUrl: "https://zjjnyyeo8c.execute-api.us-east-1.amazonaws.com/prod",
    eventId: "gaslight-residency",
    pushToken: "",
    pollingIntervalMs: 10_000,
    sqlcipherKey: "",
    mode: "auto",
    softwareType: "auto",
    sourceId: "",
    musicLibraryPath: "",
    transitionDelaySec: 45,
    showKontrolInterface: "",
    showKontrolConfirmSec: 10,
    showKontrolSourceId: "",
  },
});

const CORRECT_API_URL = "https://zjjnyyeo8c.execute-api.us-east-1.amazonaws.com/prod";
const WRONG_API_URLS = [
  "https://casperrequests.com/prod",
  "https://casperrequests.com",
];

if (WRONG_API_URLS.includes(store.get("apiBaseUrl"))) {
  store.set("apiBaseUrl", CORRECT_API_URL);
}

export function getConfig(): ConfigSchema {
  return {
    apiBaseUrl: store.get("apiBaseUrl"),
    eventId: store.get("eventId"),
    pushToken: store.get("pushToken"),
    pollingIntervalMs: store.get("pollingIntervalMs"),
    sqlcipherKey: store.get("sqlcipherKey"),
    mode: store.get("mode"),
    softwareType: store.get("softwareType"),
    sourceId: store.get("sourceId"),
    musicLibraryPath: store.get("musicLibraryPath"),
    transitionDelaySec: store.get("transitionDelaySec"),
    showKontrolInterface: store.get("showKontrolInterface"),
    showKontrolConfirmSec: store.get("showKontrolConfirmSec"),
    showKontrolSourceId: store.get("showKontrolSourceId"),
  };
}

export function setConfig(partial: Partial<ConfigSchema>): void {
  for (const [key, value] of Object.entries(partial)) {
    if (value !== undefined) {
      store.set(key as keyof ConfigSchema, value);
    }
  }
}

export function getApiBaseUrl(): string {
  const raw = store.get("apiBaseUrl");
  return raw.replace(/\/+$/, "");
}

export function getEffectivePushSourceId(config = getConfig()): string {
  if (config.softwareType === "showkontrol") {
    const configured = config.showKontrolSourceId.trim();
    if (configured) return configured;
    const booth = config.sourceId.trim() || "booth";
    return `${booth}-showkontrol`;
  }
  return config.sourceId.trim();
}
