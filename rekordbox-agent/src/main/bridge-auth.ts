export interface BridgeAuthConfig {
  eventId: string;
  pushToken: string;
  sourceId: string;
  deviceId?: string;
  deviceToken?: string;
  pairedEventId?: string;
  pairedSourceId?: string;
}

export function hasPairedCredential(config: BridgeAuthConfig): boolean {
  return Boolean(config.deviceId?.trim() && config.deviceToken?.trim());
}

export function hasBridgeCredential(config: BridgeAuthConfig): boolean {
  return hasPairedCredential(config) || Boolean(config.pushToken.trim());
}

export function getBridgeAuthHeaders(config: BridgeAuthConfig): Record<string, string> {
  if (hasPairedCredential(config)) {
    return {
      Authorization: `Bearer ${config.deviceToken!.trim()}`,
      "x-device-id": config.deviceId!.trim(),
    };
  }

  return config.pushToken.trim()
    ? { "x-push-token": config.pushToken.trim() }
    : {};
}

export function getEffectiveEventId(config: BridgeAuthConfig): string {
  if (hasPairedCredential(config) && config.pairedEventId?.trim()) {
    return config.pairedEventId.trim();
  }
  return config.eventId.trim();
}

export function getPairedSourceId(config: BridgeAuthConfig): string {
  if (hasPairedCredential(config)) {
    return config.pairedSourceId?.trim() ?? "";
  }
  return "";
}
