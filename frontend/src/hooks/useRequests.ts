import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../services/api";
import type { RequestRecord, RequestStatus } from "../types";
import { comparePriority } from "../utils/priority";
import { useWebSocket } from "./useWebSocket";

export function useRequests(
  eventId: string | undefined,
  role: "dj" | "overlay",
  token?: string,
) {
  const [requests, setRequests] = useState<RequestRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const refresh = useCallback(async () => {
    if (!eventId) {
      return;
    }
    setLoading(true);
    const data = role === "dj" && token
      ? await api.getAdminRequests(eventId, token)
      : await api.getRequests(eventId);
    setRequests(data);
    setLoading(false);
  }, [eventId, role, token]);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    const request = role === "dj" && token
      ? api.getAdminRequests(eventId, token)
      : api.getRequests(eventId);
    void request.then((data) => {
      if (cancelled) return;
      setRequests(data);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [eventId, role, token]);

  useWebSocket(eventId, role, (payload) => {
    const parsed = payload as { type?: string; action?: string; data?: RequestRecord };
    if (parsed.type === "request_updated" && parsed.data) {
      if (parsed.action === "REMOVE") {
        setRequests((prev) => prev.filter((entry) => entry.requestId !== parsed.data?.requestId));
        return;
      }
      setRequests((prev) => {
        const existing = prev.find((entry) => entry.requestId === parsed.data?.requestId);
        if (!existing) {
          if (role === "dj" && token) {
            void api.getAdminRequests(eventId!, token).then(setRequests);
            return prev;
          }
          return [parsed.data as RequestRecord, ...prev];
        }
        return prev.map((entry) =>
          entry.requestId === parsed.data?.requestId
            ? { ...entry, ...(parsed.data as RequestRecord) }
            : entry,
        );
      });
    }
  });

  const grouped = useMemo(
    () => ({
      pending: requests.filter((req) => req.status === "pending"),
      approved: requests
        .filter((req) => req.status === "approved")
        .sort(comparePriority),
      vetoed: requests.filter((req) => req.status === "vetoed"),
      played: requests.filter((req) => req.status === "played"),
    }),
    [requests],
  );

  const applyLocalStatus = useCallback((requestId: string, status: RequestStatus) => {
    setRequests((prev) =>
      prev.map((req) =>
        req.requestId === requestId ? { ...req, status, reviewedAt: new Date().toISOString() } : req,
      ),
    );
  }, []);

  const swapPositions = useCallback((idA: string, posA: number, idB: string, posB: number) => {
    setRequests((prev) =>
      prev.map((req) => {
        if (req.requestId === idA) return { ...req, position: posB };
        if (req.requestId === idB) return { ...req, position: posA };
        return req;
      }),
    );
  }, []);

  return { requests, grouped, loading, refresh, applyLocalStatus, swapPositions };
}
