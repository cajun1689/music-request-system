import Store from "electron-store";
import { safeStorage } from "electron";
import { getPairedSourceId } from "./bridge-auth";

export type DJSoftwareType = "rekordbox" | "serato" | "showkontrol" | "auto";

export interface ConfigSchema {
  lightingEnabled: boolean;
  lightingLegacyMigrated: boolean;
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
  deviceId?: string;
  deviceToken?: string;
  organizationId?: string;
  pairedEventId?: string;
  pairedSourceId?: string;
  pairedEventName?: string;
  pairedOrganizationName?: string;
}

const store = new Store<ConfigSchema>({
  defaults: {
    lightingEnabled: false,
    lightingLegacyMigrated: false,
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
    deviceId: "",
    deviceToken: "",
    organizationId: "",
    pairedEventId: "",
    pairedSourceId: "",
    pairedEventName: "",
    pairedOrganizationName: "",
  },
});

const ENCRYPTED_PREFIX = "encrypted:v1:";

function readSecret(key: "pushToken" | "deviceToken"): string {
  const stored = store.get(key) ?? "";
  if (!stored || !stored.startsWith(ENCRYPTED_PREFIX)) {
    if (stored) writeSecret(key, stored);
    return stored;
  }
  try {
    if (!safeStorage.isEncryptionAvailable()) return "";
    return safeStorage.decryptString(
      Buffer.from(stored.slice(ENCRYPTED_PREFIX.length), "base64"),
    );
  } catch {
    return "";
  }
}

function writeSecret(key: "pushToken" | "deviceToken", value: string): void {
  if (!value) {
    store.set(key, "");
    return;
  }
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(value).toString("base64");
      store.set(key, `${ENCRYPTED_PREFIX}${encrypted}`);
      return;
    }
  } catch {
    // Preserve compatibility if macOS Keychain is temporarily unavailable.
  }
  store.set(key, value);
}

const CORRECT_API_URL = "https://zjjnyyeo8c.execute-api.us-east-1.amazonaws.com/prod";
const WRONG_API_URLS = [
  "https://casperrequests.com/prod",
  "https://casperrequests.com",
];

if (WRONG_API_URLS.includes(store.get("apiBaseUrl"))) {
  store.set("apiBaseUrl", CORRECT_API_URL);
}

// electron-store supplies defaults for older installs. If a previous pairing
// attempt left only half a credential, discard only pairing data so the
// existing event/push-token setup remains usable.
const storedDeviceId = store.get("deviceId") ?? "";
const storedDeviceToken = store.get("deviceToken") ?? "";
if (Boolean(storedDeviceId) !== Boolean(storedDeviceToken)) {
  store.set({
    deviceId: "",
    deviceToken: "",
    organizationId: "",
    pairedEventId: "",
    pairedSourceId: "",
    pairedEventName: "",
    pairedOrganizationName: "",
  });
}

export function getConfig(): ConfigSchema {
  return {
    lightingEnabled: store.get("lightingEnabled"),
    lightingLegacyMigrated: store.get("lightingLegacyMigrated"),
    apiBaseUrl: store.get("apiBaseUrl"),
    eventId: store.get("eventId"),
    pushToken: readSecret("pushToken"),
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
    deviceId: store.get("deviceId") ?? "",
    deviceToken: readSecret("deviceToken"),
    organizationId: store.get("organizationId") ?? "",
    pairedEventId: store.get("pairedEventId") ?? "",
    pairedSourceId: store.get("pairedSourceId") ?? "",
    pairedEventName: store.get("pairedEventName") ?? "",
    pairedOrganizationName: store.get("pairedOrganizationName") ?? "",
  };
}

export function setConfig(partial: Partial<ConfigSchema>): void {
  for (const [key, value] of Object.entries(partial)) {
    if (value !== undefined) {
      if ((key === "pushToken" || key === "deviceToken") && typeof value === "string") {
        writeSecret(key, value);
        continue;
      }
      store.set(key as keyof ConfigSchema, value);
    }
  }
}

export function getApiBaseUrl(): string {
  const raw = store.get("apiBaseUrl");
  return raw.replace(/\/+$/, "");
}

export function getEffectivePushSourceId(config = getConfig()): string {
  const pairedSourceId = getPairedSourceId(config);
  if (pairedSourceId) return pairedSourceId;

  if (config.softwareType === "showkontrol") {
    const configured = config.showKontrolSourceId.trim();
    if (configured) return configured;
    const booth = config.sourceId.trim() || "booth";
    return `${booth}-showkontrol`;
  }
  return config.sourceId.trim();
}
