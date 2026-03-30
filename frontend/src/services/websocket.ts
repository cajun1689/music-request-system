import { config } from "../config";

type Role = "dj" | "overlay" | "guest";

export function connectToEvent(
  eventId: string,
  role: Role,
  onMessage: (payload: unknown) => void,
) {
  const url = new URL(config.websocketUrl);
  url.searchParams.set("eventId", eventId);
  url.searchParams.set("role", role);

  const socket = new WebSocket(url.toString());

  socket.addEventListener("open", () => {
    socket.send(
      JSON.stringify({
        action: "subscribe",
        eventId,
        role,
      }),
    );
  });

  socket.addEventListener("message", (event) => {
    try {
      onMessage(JSON.parse(event.data as string));
    } catch {
      // Ignore malformed websocket payloads.
    }
  });

  return socket;
}
