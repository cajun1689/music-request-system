import { config } from "../config";
import type { EventRecord, PaymentStatus, RequestRecord, RequestStatus } from "../types";

async function request<T>(path: string, init?: RequestInit, token?: string): Promise<T> {
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
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

  getEventBySlug(slug: string, token: string) {
    return request<EventRecord>(`/events/by-slug/${encodeURIComponent(slug)}`, undefined, token);
  },

  createRequest(eventId: string, payload: Partial<RequestRecord>) {
    return request<RequestRecord>(`/events/${eventId}/requests`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  getRequests(eventId: string, status?: RequestStatus) {
    const query = status ? `?status=${status}` : "";
    return request<RequestRecord[]>(`/events/${eventId}/requests${query}`);
  },

  updateRequest(
    eventId: string,
    requestId: string,
    payload: { status?: RequestStatus; reviewedBy?: string; position?: number },
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
    const presign = await request<{ uploadUrl: string; assetUrl: string }>(
      `/events/${eventId}/assets`,
      {
        method: "POST",
        body: JSON.stringify({ contentType: file.type, extension }),
      },
      token,
    );

    await fetch(presign.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": file.type,
      },
      body: file,
    });

    return presign.assetUrl;
  },

  resetRequests(eventId: string, token: string) {
    return request<{ deletedCount: number; message: string }>(
      `/events/${eventId}/reset-requests`,
      { method: "POST" },
      token,
    );
  },
};
