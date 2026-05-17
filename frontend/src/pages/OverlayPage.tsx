import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ScrollingTicker } from "../components/ScrollingTicker";
import { useRequests } from "../hooks/useRequests";
import { api } from "../services/api";
import type { EventRecord } from "../types";
import { toDisplayTitleCase } from "../utils/formatting";
import { buildGenreTickerItem } from "../utils/genreVotes";
import { activeTickerText } from "../utils/tickerPromotions";

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
    }, 5000);
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
  const promoItems = [...(genreTickerItem ? [genreTickerItem] : []), ...activeTickerText(eventData.tickerPromotions)];
  const SHOUTOUT_TTL_MS = 30 * 60 * 1000;
  const now = Date.now();

  function isShoutoutLive(req: { shoutoutApproved?: boolean; shoutoutApprovedAt?: string; submittedAt: string }) {
    if (!req.shoutoutApproved) return false;
    const approvedMs = req.shoutoutApprovedAt
      ? new Date(req.shoutoutApprovedAt).getTime()
      : new Date(req.submittedAt).getTime();
    return now - approvedMs < SHOUTOUT_TTL_MS;
  }

  const requestItems = grouped.approved.map((req) => {
    const hasSong = req.songTitle?.trim();
    const base = hasSong
      ? `${toDisplayTitleCase(req.songTitle)} - ${toDisplayTitleCase(req.artistName)}`
      : "";
    if (req.shoutout && isShoutoutLive(req)) {
      return base ? `${base} — "${req.shoutout}"` : `"${req.shoutout}"`;
    }
    return base;
  }).filter(Boolean);

  const shoutoutItems: string[] = [];
  for (const req of grouped.played) {
    if (req.shoutout && isShoutoutLive(req)) {
      const songPart = req.songTitle?.trim() ? `${toDisplayTitleCase(req.songTitle)} — ` : "";
      shoutoutItems.push(`NOW PLAYING: ${songPart}${req.shoutout}`);
    }
  }

  const allRequests = [...grouped.pending, ...grouped.approved, ...grouped.played, ...grouped.vetoed];
  const standaloneShoutouts: string[] = [];
  for (const req of allRequests) {
    if (req.shoutout && isShoutoutLive(req) && !req.songTitle?.trim()) {
      standaloneShoutouts.push(`"${req.shoutout}"`);
    }
  }

  const NOW_PLAYING_STALE_MS = 3 * 60 * 1000;
  const nowPlayingItems: string[] = [];
  if (eventData.nowPlayingOnTicker && eventData.nowPlayingSlots?.length) {
    for (const slot of eventData.nowPlayingSlots) {
      if (!slot.active || !slot.songTitle) continue;
      if (slot.updatedAt && now - new Date(slot.updatedAt).getTime() > NOW_PLAYING_STALE_MS) continue;
      nowPlayingItems.push(`NOW PLAYING: ${slot.djName} - ${slot.songTitle}`);
    }
  }

  const hasRequests = requestItems.length > 0;
  const cta = hasRequests
    ? "SCAN THE QR CODE TO REQUEST A SONG"
    : "SCAN THE QR CODE TO REQUEST A SONG, SEND A SHOUTOUT & PICK TONIGHT'S GENRE";

  const tickerItems =
    eventData.fireSaleActive && eventData.fireSaleMessage
      ? [eventData.fireSaleMessage]
      : [
          ...promoItems,
          ...nowPlayingItems,
          ...shoutoutItems,
          ...standaloneShoutouts,
          ...(hasRequests ? [cta, "COMING UP", ...requestItems] : [cta]),
        ];

  return <ScrollingTicker items={tickerItems} accentColor={eventData.accentColor} />;
}
