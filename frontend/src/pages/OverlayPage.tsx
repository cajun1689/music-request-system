import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ScrollingTicker } from "../components/ScrollingTicker";
import { useRequests } from "../hooks/useRequests";
import { api } from "../services/api";
import type { EventRecord } from "../types";
import { toDisplayTitleCase } from "../utils/formatting";
import { buildGenreTickerItem } from "../utils/genreVotes";

export function OverlayPage() {
  const { eventId } = useParams();
  const { grouped } = useRequests(eventId, "overlay");
  const [eventData, setEventData] = useState<EventRecord | null>(null);

  useEffect(() => {
    if (!eventId) {
      return;
    }
    const loadEvent = async () => {
      const event = await api.getEvent(eventId);
      setEventData(event);
    };
    void loadEvent();
    const interval = window.setInterval(() => {
      void loadEvent();
    }, 10000);
    return () => window.clearInterval(interval);
  }, [eventId]);

  useEffect(() => {
    document.body.classList.add("overlay-mode");
    return () => {
      document.body.classList.remove("overlay-mode");
    };
  }, []);

  if (!eventData) {
    return null;
  }

  const genreTickerItem = buildGenreTickerItem(eventData);
  const promoItems = [...(genreTickerItem ? [genreTickerItem] : []), ...(eventData.tickerPromotions ?? [])];
  const requestItems = grouped.approved.map(
    (req) => `${toDisplayTitleCase(req.songTitle)} - ${toDisplayTitleCase(req.artistName)}`,
  );
  const tickerItems =
    eventData.fireSaleActive && eventData.fireSaleMessage
      ? [eventData.fireSaleMessage]
      : requestItems.length
        ? ["COMING UP", ...promoItems, ...requestItems]
        : promoItems;

  return <ScrollingTicker items={tickerItems} accentColor={eventData.accentColor} />;
}
