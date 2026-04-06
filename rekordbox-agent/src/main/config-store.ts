import Store from "electron-store";

interface ConfigSchema {
  apiBaseUrl: string;
  eventId: string;
  pushToken: string;
  pollingIntervalMs: number;
  sqlcipherKey: string;
  mode: "auto" | "manual";
}

const store = new Store<ConfigSchema>({
  defaults: {
    apiBaseUrl: "https://casperrequests.com/prod",
    eventId: "",
    pushToken: "",
    pollingIntervalMs: 10_000,
    sqlcipherKey: "",
    mode: "auto",
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
