import { useEffect, useMemo, useRef } from "react";
import { connectToEvent } from "../services/websocket";

type Role = "dj" | "overlay" | "guest";

export function useWebSocket(
  eventId: string | undefined,
  role: Role,
  onMessage: (payload: unknown) => void,
) {
  const stableHandler = useRef(onMessage);
  stableHandler.current = onMessage;

  const key = useMemo(() => `${eventId ?? "none"}-${role}`, [eventId, role]);

  useEffect(() => {
    if (!eventId) {
      return;
    }

    let socket = connectToEvent(eventId, role, (payload) => stableHandler.current(payload));
    let timer: number | undefined;

    const reconnect = () => {
      timer = window.setTimeout(() => {
        socket = connectToEvent(eventId, role, (payload) => stableHandler.current(payload));
        socket.addEventListener("close", reconnect);
      }, 1500);
    };

    socket.addEventListener("close", reconnect);
    return () => {
      if (timer) {
        window.clearTimeout(timer);
      }
      socket.close();
    };
  }, [eventId, role, key]);
}
