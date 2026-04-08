import Store from "electron-store";

interface ConfigSchema {
  apiBaseUrl: string;
  eventId: string;
  pushToken: string;
  pollingIntervalMs: number;
  sqlcipherKey: string;
  mode: "auto" | "manual";
  softwareType: "rekordbox" | "serato" | "auto";
  sourceId: string;
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
  },
});

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
