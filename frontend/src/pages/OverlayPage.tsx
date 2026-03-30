import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ScrollingTicker } from "../components/ScrollingTicker";
import { useRequests } from "../hooks/useRequests";
import { api } from "../services/api";
import type { EventRecord } from "../types";

export function OverlayPage() {
  const { eventId } = useParams();
  const { grouped } = useRequests(eventId, "overlay");
  const [eventData, setEventData] = useState<EventRecord | null>(null);

  useEffect(() => {
    if (!eventId) {
      return;
    }
    void api.getEvent(eventId).then(setEventData);
  }, [eventId]);

  if (!eventData) {
    return null;
  }

  return (
    <div
      style={{
        background: "transparent",
        minHeight: "100vh",
      }}
    >
      <ScrollingTicker requests={grouped.approved} accentColor={eventData.accentColor} />
    </div>
  );
}
