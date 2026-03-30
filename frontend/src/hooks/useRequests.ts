import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../services/api";
import type { RequestRecord, RequestStatus } from "../types";
import { useWebSocket } from "./useWebSocket";

export function useRequests(eventId: string | undefined, role: "dj" | "overlay") {
  const [requests, setRequests] = useState<RequestRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const refresh = useCallback(async () => {
    if (!eventId) {
      return;
    }
    setLoading(true);
    const data = await api.getRequests(eventId);
    setRequests(data);
    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useWebSocket(eventId, role, (payload) => {
    const parsed = payload as { type?: string; data?: RequestRecord };
    if (parsed.type === "request_updated" && parsed.data) {
      setRequests((prev) => {
        const existing = prev.find((entry) => entry.requestId === parsed.data?.requestId);
        if (!existing) {
          return [parsed.data as RequestRecord, ...prev];
        }
        return prev.map((entry) =>
          entry.requestId === parsed.data?.requestId ? (parsed.data as RequestRecord) : entry,
        );
      });
    }
  });

  const grouped = useMemo(
    () => ({
      pending: requests.filter((req) => req.status === "pending"),
      approved: requests
        .filter((req) => req.status === "approved")
        .sort((a, b) => Number(a.position ?? Number.MAX_SAFE_INTEGER) - Number(b.position ?? Number.MAX_SAFE_INTEGER)),
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

  return { requests, grouped, loading, refresh, applyLocalStatus };
}
