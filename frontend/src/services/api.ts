import { config } from "../config";
import { auth } from "./auth";
import type {
  BridgeDevice,
  EventRecord,
  GenreName,
  Membership,
  Organization,
  OrganizationInvitation,
  OrganizationRole,
  PaymentStatus,
  PlatformAccess,
  PlatformAuditEntry,
  PlatformOrganization,
  PlatformOrganizationAction,
  PlatformOrganizationDetail,
  PlatformSupportSession,
  PlatformSupportView,
  PlatformUser,
  RequestRecord,
  RequestStatus,
  SaasPlanId,
  StripeConnectStatus,
  SupportSessionMode,
} from "../types";

const SUPPORT_SESSION_KEY = "casper_platform_support_session";

function supportSessionHeaders(path: string): Record<string, string> {
  if (!path.startsWith("/platform/") || path === "/platform/me") return {};
  try {
    const raw = sessionStorage.getItem(SUPPORT_SESSION_KEY);
    if (!raw) return {};
    const session = JSON.parse(raw) as { supportSessionId?: string };
    return session.supportSessionId
      ? { "x-support-session-id": session.supportSessionId }
      : {};
  } catch {
    return {};
  }
}

async function request<T>(path: string, init?: RequestInit, token?: string): Promise<T> {
  const refreshed = token ? await auth.getValidSession().catch(() => null) : null;
  const authToken = refreshed?.idToken ?? token;
  let response: Response;
  try {
    response = await fetch(`${config.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...supportSessionHeaders(path),
        ...init?.headers,
      },
    });
  } catch {
    throw new Error("Network request failed. Please refresh and sign in again.");
  }

  if (!response.ok) {
    if (response.status === 401 && token) {
      const retrySession = await auth.getValidSession().catch(() => null);
      if (retrySession?.idToken && retrySession.idToken !== authToken) {
        const retry = await fetch(`${config.apiBaseUrl}${path}`, {
          ...init,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${retrySession.idToken}`,
            ...supportSessionHeaders(path),
            ...init?.headers,
          },
        });
        if (retry.ok) {
          return (await retry.json()) as T;
        }
      }
      throw new Error("Session expired or unauthorized. Please sign in again.");
    }
    const text = await response.text();
    let message = text;
    try {
      const parsed = JSON.parse(text) as { error?: string; message?: string };
      message = parsed.error ?? parsed.message ?? text;
    } catch {
      // Keep the raw response when it is not JSON.
    }
    if (
      path.startsWith("/platform/")
      && /support session (?:has ended|has expired|not found|belongs to another)/i.test(message)
    ) {
      try {
        sessionStorage.removeItem(SUPPORT_SESSION_KEY);
        window.dispatchEvent(new Event("casper:support-session-invalid"));
      } catch {
        // The API error still reaches the caller when browser storage is unavailable.
      }
    }
    throw new Error(message || `Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Unable to read file."));
        return;
      }
      const commaIndex = result.indexOf(",");
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(new Error("Failed to read selected file."));
    reader.readAsDataURL(file);
  });
}

function queryString(values: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== "") query.set(key, String(value));
  });
  const encoded = query.toString();
  return encoded ? `?${encoded}` : "";
}

export const api = {
  createEvent(payload: Partial<EventRecord>, token: string) {
    return request<EventRecord>(
      "/events",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      token,
    );
  },

  updateEvent(eventId: string, payload: Partial<EventRecord>, token: string) {
    return request<EventRecord>(
      `/events/${eventId}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      },
      token,
    );
  },

  getEvent(eventId: string) {
    return request<EventRecord>(`/events/${eventId}`);
  },

  getAdminEvent(eventId: string, token: string) {
    return request<EventRecord>(`/admin/events/${encodeURIComponent(eventId)}`, undefined, token);
  },

  listEvents() {
    return request<{ events: Array<{ eventId: string; name: string; date: string; venueName: string; djBrandName: string; isActive: boolean; slug?: string }> }>("/events");
  },

  deleteEvent(eventId: string, token: string) {
    return request<{ deleted: boolean; eventId: string; deletedRequests: number }>(
      `/events/${eventId}`,
      { method: "DELETE" },
      token,
    );
  },

  submitGenreVote(eventId: string, genre: GenreName, previousGenre?: GenreName) {
    return request<EventRecord>(`/events/${eventId}/genre-votes`, {
      method: "POST",
      body: JSON.stringify({ genre, previousGenre }),
    });
  },

  resetGenreVotes(eventId: string, token: string) {
    return request<EventRecord>(
      `/events/${eventId}/genre-votes/reset`,
      {
        method: "POST",
      },
      token,
    );
  },

  adminAdjustGenreVotes(
    eventId: string,
    payload: { adjustments?: Partial<Record<GenreName, number>>; set?: Partial<Record<GenreName, number>> },
    token: string,
  ) {
    return request<EventRecord>(
      `/events/${eventId}/genre-votes/admin-adjust`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      token,
    );
  },

  getEventBySlug(slug: string, token: string) {
    return request<EventRecord>(`/events/by-slug/${encodeURIComponent(slug)}`, undefined, token);
  },

  getOrganizations(token: string) {
    return request<{ organizations: Organization[]; memberships: Membership[] }>("/me/organizations", undefined, token);
  },

  getPlatformMe(token: string) {
    return request<{ access: PlatformAccess }>("/platform/me", undefined, token);
  },

  getPlatformSummary(token: string) {
    return request<{ summary: Record<string, unknown> }>("/platform/summary", undefined, token);
  },

  getPlatformOrganizations(
    filters: { q?: string; status?: string; plan?: string; limit?: number; cursor?: string },
    token: string,
  ) {
    return request<{ organizations: PlatformOrganization[]; nextCursor?: string }>(
      `/platform/organizations${queryString(filters)}`,
      undefined,
      token,
    );
  },

  getPlatformOrganization(organizationId: string, token: string) {
    return request<PlatformOrganizationDetail>(
      `/platform/organizations/${encodeURIComponent(organizationId)}`,
      undefined,
      token,
    );
  },

  updatePlatformOrganization(
    organizationId: string,
    payload: { action: PlatformOrganizationAction; reason: string; planId?: string; days?: number },
    token: string,
  ) {
    return request<{ organization?: PlatformOrganization } & Record<string, unknown>>(
      `/platform/organizations/${encodeURIComponent(organizationId)}`,
      { method: "PATCH", body: JSON.stringify(payload) },
      token,
    );
  },

  createPlatformInvitation(
    organizationId: string,
    payload: { email: string; role: Exclude<OrganizationRole, "owner">; reason: string },
    token: string,
  ) {
    return request<{ invitation: OrganizationInvitation }>(
      `/platform/organizations/${encodeURIComponent(organizationId)}/invitations`,
      { method: "POST", body: JSON.stringify(payload) },
      token,
    );
  },

  revokePlatformInvitation(
    organizationId: string,
    invitationId: string,
    reason: string,
    token: string,
  ) {
    return request<{ revoked?: boolean }>(
      `/platform/organizations/${encodeURIComponent(organizationId)}/invitations/${encodeURIComponent(invitationId)}`,
      { method: "DELETE", body: JSON.stringify({ reason }) },
      token,
    );
  },

  updatePlatformMember(
    organizationId: string,
    userId: string,
    payload: { role?: OrganizationRole; transferOwnership?: boolean; reason: string },
    token: string,
  ) {
    return request<Record<string, unknown>>(
      `/platform/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(userId)}`,
      { method: "PATCH", body: JSON.stringify(payload) },
      token,
    );
  },

  removePlatformMember(organizationId: string, userId: string, reason: string, token: string) {
    return request<{ removed?: boolean }>(
      `/platform/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(userId)}`,
      { method: "DELETE", body: JSON.stringify({ reason }) },
      token,
    );
  },

  revokePlatformDevice(organizationId: string, deviceId: string, reason: string, token: string) {
    return request<{ revoked?: boolean }>(
      `/platform/organizations/${encodeURIComponent(organizationId)}/devices/${encodeURIComponent(deviceId)}`,
      { method: "DELETE", body: JSON.stringify({ reason }) },
      token,
    );
  },

  getPlatformOrganizationExport(organizationId: string, token: string) {
    return request<Record<string, unknown>>(
      `/platform/organizations/${encodeURIComponent(organizationId)}/export`,
      undefined,
      token,
    );
  },

  getPlatformUsers(filters: { q?: string; limit?: number; cursor?: string }, token: string) {
    return request<{ users: PlatformUser[]; nextCursor?: string }>(
      `/platform/users${queryString(filters)}`,
      undefined,
      token,
    );
  },

  runPlatformUserAction(
    userId: string,
    payload: { action: "disable" | "enable" | "reset_password"; reason: string },
    token: string,
  ) {
    return request<Record<string, unknown>>(
      `/platform/users/${encodeURIComponent(userId)}/actions`,
      { method: "POST", body: JSON.stringify(payload) },
      token,
    );
  },

  getPlatformAudit(token: string) {
    return request<{ audit?: PlatformAuditEntry[]; entries?: PlatformAuditEntry[] } | PlatformAuditEntry[]>(
      "/platform/audit",
      undefined,
      token,
    );
  },

  createPlatformSupportSession(
    payload: {
      organizationId: string;
      targetUserId?: string;
      mode: SupportSessionMode;
      reason: string;
      durationMinutes: number;
    },
    token: string,
  ) {
    return request<{ supportSession: PlatformSupportSession } | PlatformSupportSession>(
      "/platform/support-sessions",
      { method: "POST", body: JSON.stringify(payload) },
      token,
    );
  },

  getPlatformSupportSessions(token: string) {
    return request<{ supportSessions?: PlatformSupportSession[]; sessions?: PlatformSupportSession[] } | PlatformSupportSession[]>(
      "/platform/support-sessions",
      undefined,
      token,
    );
  },

  getPlatformSupportView(supportSessionId: string, token: string) {
    return request<PlatformSupportView>(
      `/platform/support-sessions/${encodeURIComponent(supportSessionId)}/view`,
      undefined,
      token,
    );
  },

  endPlatformSupportSession(supportSessionId: string, token: string) {
    return request<{ ended?: boolean; revoked?: boolean }>(
      `/platform/support-sessions/${encodeURIComponent(supportSessionId)}`,
      { method: "DELETE" },
      token,
    );
  },

  createOrganization(payload: { name: string; slug: string; planId?: SaasPlanId }, token: string) {
    return request<{ organization: Organization; membership: Membership }>(
      "/organizations",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      token,
    );
  },

  async getOrganization(organizationId: string, token: string) {
    const result = await request<{ organization: Organization; membership: Membership }>(
      `/organizations/${encodeURIComponent(organizationId)}`,
      undefined,
      token,
    );
    return result.organization;
  },

  getOrganizationExport(organizationId: string, token: string) {
    return request<Record<string, unknown>>(
      `/organizations/${encodeURIComponent(organizationId)}?export=true`,
      undefined,
      token,
    );
  },

  async updateOrganization(
    organizationId: string,
    payload: {
      name?: string;
      branding?: Organization["branding"];
      defaults?: Organization["defaults"];
      requestDeletion?: boolean;
      cancelDeletion?: boolean;
    },
    token: string,
  ) {
    const result = await request<{ organization: Organization }>(
      `/organizations/${encodeURIComponent(organizationId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      },
      token,
    );
    return result.organization;
  },

  getOrganizationMembers(organizationId: string, token: string) {
    return request<{ members: Membership[] }>(
      `/organizations/${encodeURIComponent(organizationId)}/members`,
      undefined,
      token,
    );
  },

  inviteOrganizationMember(
    organizationId: string,
    payload: { email: string; role: Exclude<OrganizationRole, "owner"> },
    token: string,
  ) {
    return request<{ invitation: OrganizationInvitation }>(
      `/organizations/${encodeURIComponent(organizationId)}/invitations`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      token,
    ).then((result) => result.invitation);
  },

  acceptInvitation(invitationToken: string, token: string) {
    return request<{ organization?: Organization; membership?: Membership }>(
      `/invitations/${encodeURIComponent(invitationToken)}/accept`,
      { method: "POST" },
      token,
    );
  },

  createBillingCheckout(organizationId: string, planId: SaasPlanId, token: string) {
    return request<{ url: string }>(
      `/organizations/${encodeURIComponent(organizationId)}/billing/checkout`,
      { method: "POST", body: JSON.stringify({ planId }) },
      token,
    );
  },

  createBillingPortal(organizationId: string, token: string) {
    return request<{ url: string }>(
      `/organizations/${encodeURIComponent(organizationId)}/billing/portal`,
      { method: "POST" },
      token,
    );
  },

  createStripeConnectOnboarding(organizationId: string, token: string) {
    return request<{ url: string }>(
      `/organizations/${encodeURIComponent(organizationId)}/stripe/connect`,
      { method: "POST" },
      token,
    );
  },

  getStripeConnectStatus(organizationId: string, token: string) {
    return request<StripeConnectStatus>(
      `/organizations/${encodeURIComponent(organizationId)}/stripe/status`,
      undefined,
      token,
    );
  },

  getOrganizationEvents(organizationId: string, token: string) {
    return request<{ events: EventRecord[] }>(
      `/organizations/${encodeURIComponent(organizationId)}/events`,
      undefined,
      token,
    );
  },

  getBridgeDevices(organizationId: string, token: string) {
    return request<{ devices: BridgeDevice[] }>(
      `/organizations/${encodeURIComponent(organizationId)}/devices`,
      undefined,
      token,
    );
  },

  createBridgePairingCode(
    payload: { eventId: string; sourceId: string; deviceName?: string },
    token: string,
  ) {
    return request<{ code: string; expiresAt: number }>(
      "/bridge/pairing-codes",
      { method: "POST", body: JSON.stringify(payload) },
      token,
    );
  },

  revokeBridgeDevice(organizationId: string, deviceId: string, token: string) {
    return request<{ deviceId: string; revoked: boolean }>(
      `/organizations/${encodeURIComponent(organizationId)}/devices/${encodeURIComponent(deviceId)}`,
      { method: "DELETE" },
      token,
    );
  },

  updateOrganizationMember(
    organizationId: string,
    userId: string,
    payload: { role?: "admin" | "dj"; transferOwnership?: boolean },
    token: string,
  ) {
    return request<{ membership?: Membership; transferred?: boolean }>(
      `/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(userId)}`,
      { method: "PATCH", body: JSON.stringify(payload) },
      token,
    );
  },

  removeOrganizationMember(
    organizationId: string,
    userId: string,
    token: string,
  ) {
    return request<{ removed: boolean; userId: string }>(
      `/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(userId)}`,
      { method: "DELETE" },
      token,
    );
  },

  createRequest(eventId: string, payload: Partial<RequestRecord>) {
    return request<RequestRecord>(`/events/${eventId}/requests`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  createPaypalOrder(eventId: string, requestId: string, tipAmount: number) {
    return request<{
      orderId?: string;
      approveUrl?: string;
      environment?: string;
      alreadyPaid?: boolean;
    }>(`/events/${eventId}/requests/${requestId}/payments/paypal-order`, {
      method: "POST",
      body: JSON.stringify({ tipAmount }),
    });
  },

  createStripeCheckout(eventId: string, requestId: string, tipAmount: number) {
    return request<{ checkoutUrl?: string; alreadyPaid?: boolean }>(
      `/events/${eventId}/requests/${requestId}/payments/stripe-checkout`,
      {
        method: "POST",
        body: JSON.stringify({ tipAmount }),
      },
    );
  },

  capturePaypalOrder(eventId: string, requestId: string, orderId: string) {
    return request<{
      verified: boolean;
      alreadyPaid?: boolean;
      captureId?: string;
      request?: RequestRecord;
      error?: string;
    }>(`/events/${eventId}/requests/${requestId}/payments/paypal-capture`, {
      method: "POST",
      body: JSON.stringify({ orderId }),
    });
  },

  upvoteRequest(eventId: string, requestId: string) {
    return request<RequestRecord>(`/events/${eventId}/requests/${requestId}/upvote`, {
      method: "POST",
    });
  },

  getRequests(eventId: string, status?: RequestStatus) {
    const query = status ? `?status=${status}` : "";
    return request<RequestRecord[]>(`/events/${eventId}/requests${query}`);
  },

  getAdminRequests(eventId: string, token: string) {
    return request<RequestRecord[]>(
      `/admin/events/${encodeURIComponent(eventId)}/requests`,
      undefined,
      token,
    );
  },

  updateRequest(
    eventId: string,
    requestId: string,
    payload: { status?: RequestStatus; reviewedBy?: string; position?: number; shoutoutApproved?: boolean },
    token: string,
  ) {
    return request<RequestRecord>(
      `/events/${eventId}/requests/${requestId}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      },
      token,
    );
  },

  updateRequestPayment(
    eventId: string,
    requestId: string,
    payload: {
      paymentStatus?: PaymentStatus;
      paymentReference?: string;
      tipAmount?: number;
      reviewedBy?: string;
    },
    token: string,
  ) {
    return request<RequestRecord>(
      `/events/${eventId}/requests/${requestId}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      },
      token,
    );
  },

  async uploadBrandAsset(eventId: string, file: File, token: string) {
    const extension = file.name.split(".").pop() ?? "png";
    const contentType = file.type || "application/octet-stream";

    try {
      const presign = await request<{ uploadUrl?: string; assetUrl: string }>(
        `/events/${eventId}/assets`,
        {
          method: "POST",
          body: JSON.stringify({
            contentType,
            extension,
          }),
        },
        token,
      );

      if (presign.uploadUrl) {
        const uploadResponse = await fetch(presign.uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type": contentType,
          },
          body: file,
        });
        if (!uploadResponse.ok) {
          const text = await uploadResponse.text();
          throw new Error(text || `Logo upload failed: ${uploadResponse.status}`);
        }
        return presign.assetUrl;
      }
    } catch {
      // Fallback path below.
    }

    // Fallback to direct API upload for smaller files.
    if (file.size > 4 * 1024 * 1024) {
      throw new Error("Upload failed. Please use an image smaller than 4MB.");
    }

    const fileBase64 = await fileToBase64(file);
    const direct = await request<{ assetUrl: string }>(
      `/events/${eventId}/assets`,
      {
        method: "POST",
        body: JSON.stringify({
          contentType,
          extension,
          fileBase64,
        }),
      },
      token,
    );
    return direct.assetUrl;
  },

  resetRequests(eventId: string, token: string) {
    return request<{ archivedCount: number; message: string }>(
      `/events/${eventId}/reset-requests`,
      { method: "POST" },
      token,
    );
  },

  detectPlayed(
    eventId: string,
    payload: {
      playedTitle: string;
      playedArtist?: string;
      sourceId?: string;
      reviewedBy?: string;
    },
    token: string,
  ) {
    return request<{
      matched: boolean;
      confidenceScore?: number;
      request?: RequestRecord;
      reason?: string;
    }>(
      `/events/${eventId}/detect-played`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      token,
    );
  },

  autoDetectPlayed(eventId: string, token: string) {
    return request<{
      matched: boolean;
      confidenceScore?: number;
      request?: RequestRecord;
      reason?: string;
      sourceId?: string;
      sourceName?: string;
      currentTrack?: string;
      sourceStatuses?: Array<{
        sourceId: string;
        sourceName: string;
        health: "live" | "private" | "no_track_data" | "unreachable";
        detail?: string;
        currentTrack?: string;
      }>;
    }>(
      `/events/${eventId}/auto-detect-played`,
      {
        method: "POST",
      },
      token,
    );
  },

  getLibrary(eventId: string) {
    return request<{
      eventId: string;
      sourceId: string;
      syncedAt: string;
      trackCount: number;
      tracks: Array<{
        title: string;
        artist: string;
        titleNorm: string;
        artistNorm: string;
        playCount: number;
      }>;
    }>(`/events/${eventId}/library`);
  },

  getAdminLibrary(eventId: string, token: string) {
    return request<{
      eventId: string;
      sourceId: string;
      syncedAt: string;
      trackCount: number;
      tracks: Array<{
        title: string;
        artist: string;
        titleNorm: string;
        artistNorm: string;
        playCount: number;
      }>;
    }>(`/admin/events/${encodeURIComponent(eventId)}/library`, undefined, token);
  },
};
