import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { RequestCard } from "../components/RequestCard";
import { useAuth } from "../context/AuthContext";
import { useRequests } from "../hooks/useRequests";
import { api } from "../services/api";
import type { EventRecord, LivePlaylistSource, NowPlayingSlot } from "../types";
import { ALL_GENRES, GENRE_LABELS, GENRE_VOTE_THRESHOLD, normalizeGenreVotes } from "../utils/genreVotes";
import { comparePriority } from "../utils/priority";

type Tab = "pending" | "approved" | "played" | "vetoed";
const FIRE_SALE_MESSAGE = "🔥🔥🔥 FIRE SALE 🔥🔥🔥  $1 SHOTS 🥃🥃  Bartender's Choice - Until The End Of This Song";

function defaultNowPlayingSlots(): NowPlayingSlot[] {
  return [
    { id: "dj-1", djName: "DJ 1", songTitle: "", artistName: "", active: false },
    { id: "dj-2", djName: "DJ 2", songTitle: "", artistName: "", active: false },
    { id: "dj-3", djName: "DJ 3", songTitle: "", artistName: "", active: false },
  ];
}

function defaultLiveSources(eventData: EventRecord | null): LivePlaylistSource[] {
  return [
    {
      id: "serato-a",
      name: "Serato A",
      type: "serato",
      url: eventData?.seratoLiveUrl ?? "",
      active: Boolean(eventData?.seratoLiveUrl),
    },
    { id: "serato-b", name: "Serato B", type: "serato", url: "", active: false },
    {
      id: "rekordbox",
      name: "Rekordbox",
      type: "rekordbox",
      url: eventData?.rekordboxLiveUrl ?? "",
      active: Boolean(eventData?.rekordboxLiveUrl),
    },
  ];
}

export function DashboardPage() {
  const { eventId: routeEventId } = useParams();
  const { session, logout } = useAuth();
  const [eventId, setEventId] = useState(routeEventId ?? localStorage.getItem("activeEventId") ?? "");
  const [eventData, setEventData] = useState<EventRecord | null>(null);
  const [showNowPlaying, setShowNowPlaying] = useState(false);
  const [nowPlayingSlots, setNowPlayingSlots] = useState<NowPlayingSlot[]>(defaultNowPlayingSlots());
  const [savingNowPlaying, setSavingNowPlaying] = useState(false);
  const [playedTitle, setPlayedTitle] = useState("");
  const [playedArtist, setPlayedArtist] = useState("");
  const [selectedSourceId, setSelectedSourceId] = useState("serato-a");
  const [detecting, setDetecting] = useState(false);
  const [detectMessage, setDetectMessage] = useState("");
  const [autoMatchingEnabled, setAutoMatchingEnabled] = useState(false);
  const [autoMatchingBusy, setAutoMatchingBusy] = useState(false);
  const [autoMatchingMessage, setAutoMatchingMessage] = useState("");
  const [promotionInput, setPromotionInput] = useState("");
  const [tickerPromotions, setTickerPromotions] = useState<string[]>([]);
  const [fireSaleActive, setFireSaleActive] = useState(false);
  const [fireSaleMessage, setFireSaleMessage] = useState("");
  const [tickerMessage, setTickerMessage] = useState("");
  const [nowPlayingAutoEnabled, setNowPlayingAutoEnabled] = useState(false);
  const [nowPlayingOnTicker, setNowPlayingOnTicker] = useState(false);
  const [blockedPushSources, setBlockedPushSources] = useState<string[]>([]);
  const [sourceHealth, setSourceHealth] = useState<
    Array<{
      sourceId: string;
      sourceName: string;
      health: "live" | "private" | "no_track_data" | "unreachable";
      detail?: string;
      currentTrack?: string;
    }>
  >([]);
  interface LibraryEntry {
    title: string;
    artist: string;
    titleNorm: string;
    artistNorm: string;
    playCount: number;
  }
  const [libraryTracks, setLibraryTracks] = useState<LibraryEntry[] | null>(null);
  const [tab, setTab] = useState<Tab>("pending");
  const { grouped, loading, applyLocalStatus, swapPositions, refresh } = useRequests(eventId || undefined, "dj");

  const isShoutoutOnly = (req: { songTitle?: string; shoutout?: string }) =>
    !req.songTitle?.trim() && !!req.shoutout;

  const pendingShoutouts = useMemo(
    () => grouped.pending.filter(isShoutoutOnly),
    [grouped.pending],
  );

  const filteredGrouped = useMemo(
    () => ({
      pending: grouped.pending.filter((r) => !isShoutoutOnly(r)),
      approved: grouped.approved.filter((r) => !isShoutoutOnly(r)),
      played: grouped.played,
      vetoed: grouped.vetoed,
    }),
    [grouped],
  );

  const visible = useMemo(() => filteredGrouped[tab], [filteredGrouped, tab]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const selectedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelectedIndex(-1);
  }, [tab]);

  const handleKeyAction = useCallback(
    (key: string) => {
      if (!session || !eventId) return;
      const req = visible[selectedIndex];
      if (!req) return;

      if (key === "a" && tab === "pending") {
        void updateStatus(req.requestId, "approved");
        setSelectedIndex((prev) => Math.min(prev, visible.length - 2));
      } else if (key === "v" && (tab === "pending" || tab === "approved")) {
        void updateStatus(req.requestId, "vetoed");
        setSelectedIndex((prev) => Math.min(prev, visible.length - 2));
      } else if (key === "p" && tab === "approved") {
        void updateStatus(req.requestId, "played");
        setSelectedIndex((prev) => Math.min(prev, visible.length - 2));
      }
    },
    [session, eventId, tab, visible, selectedIndex],
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, visible.length - 1));
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "a") {
        handleKeyAction("a");
      } else if (e.key === "v") {
        handleKeyAction("v");
      } else if (e.key === "p") {
        handleKeyAction("p");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visible.length, handleKeyAction]);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedIndex]);

  function normalizeForLibrary(s: string): string {
    return s.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
  }

  interface LibraryMatch {
    found: boolean;
    bestTrack?: LibraryEntry;
  }

  function findLibraryMatch(songTitle: string, artistName: string): LibraryMatch | undefined {
    if (!libraryTracks) return undefined;
    const titleNorm = normalizeForLibrary(songTitle);
    const artistNorm = normalizeForLibrary(artistName);

    const candidates: LibraryEntry[] = [];

    for (const t of libraryTracks) {
      // Exact title+artist
      if (t.titleNorm === titleNorm && t.artistNorm === artistNorm) {
        candidates.push(t);
        continue;
      }
      // Exact title only
      if (t.titleNorm === titleNorm) {
        candidates.push(t);
        continue;
      }
      // Partial title match (both directions, min 4 chars)
      if (titleNorm.length > 3 && (t.titleNorm.includes(titleNorm) || titleNorm.includes(t.titleNorm))) {
        candidates.push(t);
      }
    }

    if (candidates.length === 0) return { found: false };

    // Pick the one with the highest play count
    candidates.sort((a, b) => b.playCount - a.playCount);
    return { found: true, bestTrack: candidates[0] };
  }

  useEffect(() => {
    if (!eventId) {
      return;
    }
    setSourceHealth([]);
    void api
      .getEvent(eventId)
      .then((evt) => {
        setEventData(evt);
        setNowPlayingSlots(evt.nowPlayingSlots?.length ? evt.nowPlayingSlots : defaultNowPlayingSlots());
        setTickerPromotions(evt.tickerPromotions ?? []);
        setFireSaleActive(Boolean(evt.fireSaleActive));
        setFireSaleMessage(evt.fireSaleMessage ?? "");
        setNowPlayingAutoEnabled(Boolean(evt.nowPlayingAutoEnabled));
        setNowPlayingOnTicker(Boolean(evt.nowPlayingOnTicker));
        setBlockedPushSources(evt.blockedPushSources ?? []);
      })
      .catch(() => {
        setEventData(null);
        setNowPlayingSlots(defaultNowPlayingSlots());
        setTickerPromotions([]);
        setFireSaleActive(false);
        setFireSaleMessage("");
        setNowPlayingAutoEnabled(false);
        setNowPlayingOnTicker(false);
        setBlockedPushSources([]);
      });

    void api
      .getLibrary(eventId)
      .then((lib) => {
        setLibraryTracks(lib.tracks);
      })
      .catch(() => {
        setLibraryTracks(null);
      });
  }, [eventId]);

  async function updateStatus(requestId: string, status: "approved" | "vetoed" | "played") {
    if (!session || !eventId) {
      return;
    }
    applyLocalStatus(requestId, status);
    await api.updateRequest(eventId, requestId, { status, reviewedBy: session.email }, session.idToken);
  }

  async function moveApproved(requestId: string, direction: "up" | "down") {
    if (!session || !eventId) {
      return;
    }
    const list = [...grouped.approved].sort(comparePriority);
    const idx = list.findIndex((entry) => entry.requestId === requestId);
    if (idx < 0) {
      return;
    }

    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= list.length) {
      return;
    }

    const current = list[idx];
    const target = list[swapIdx];
    const currentPos = current.position ?? Date.now();
    const targetPos = target.position ?? Date.now() + 1;

    swapPositions(current.requestId, currentPos, target.requestId, targetPos);

    try {
      await Promise.all([
        api.updateRequest(
          eventId,
          current.requestId,
          { position: targetPos },
          session.idToken,
        ),
        api.updateRequest(
          eventId,
          target.requestId,
          { position: currentPos },
          session.idToken,
        ),
      ]);
    } catch {
      swapPositions(current.requestId, targetPos, target.requestId, currentPos);
    }
  }

  async function updateShoutout(requestId: string, approved: boolean, shoutoutOnly = false) {
    if (!session || !eventId) return;
    if (shoutoutOnly) {
      const patch: { shoutoutApproved: boolean; status?: "played" | "vetoed"; reviewedBy?: string } = {
        shoutoutApproved: approved,
        status: approved ? "played" : "vetoed",
        reviewedBy: session.email,
      };
      applyLocalStatus(requestId, approved ? "played" : "vetoed");
      await api.updateRequest(eventId, requestId, patch, session.idToken);
    } else {
      await api.updateRequest(eventId, requestId, { shoutoutApproved: approved }, session.idToken);
    }
    await refresh();
  }

  async function updatePayment(requestId: string, paymentStatus: "verified" | "rejected") {
    if (!session || !eventId) {
      return;
    }
    await api.updateRequestPayment(
      eventId,
      requestId,
      {
        paymentStatus,
        reviewedBy: session.email,
      },
      session.idToken,
    );
    await refresh();
  }

  async function saveNowPlayingSlots(nextSlots: NowPlayingSlot[]) {
    if (!session || !eventId) {
      return;
    }
    setSavingNowPlaying(true);
    try {
      const updated = await api.updateEvent(eventId, { nowPlayingSlots: nextSlots }, session.idToken);
      setEventData(updated);
      setNowPlayingSlots(updated.nowPlayingSlots?.length ? updated.nowPlayingSlots : nextSlots);
    } finally {
      setSavingNowPlaying(false);
    }
  }

  function updateSlotField(slotId: string, patch: Partial<NowPlayingSlot>) {
    setNowPlayingSlots((prev) => prev.map((slot) => (slot.id === slotId ? { ...slot, ...patch } : slot)));
  }

  async function markSlotActive(slotId: string) {
    const next = nowPlayingSlots.map((slot) =>
      slot.id === slotId
        ? { ...slot, active: true, updatedAt: new Date().toISOString() }
        : slot,
    );
    setNowPlayingSlots(next);
    await saveNowPlayingSlots(next);
  }

  async function clearSlot(slotId: string) {
    const next = nowPlayingSlots.map((slot) =>
      slot.id === slotId
        ? { ...slot, songTitle: "", artistName: "", active: false, updatedAt: new Date().toISOString() }
        : slot,
    );
    setNowPlayingSlots(next);
    await saveNowPlayingSlots(next);
  }

  async function toggleNowPlayingAuto() {
    if (!session || !eventId) return;
    const next = !nowPlayingAutoEnabled;
    setNowPlayingAutoEnabled(next);
    try {
      await api.updateEvent(eventId, { nowPlayingAutoEnabled: next } as Partial<EventRecord>, session.idToken);
    } catch {
      setNowPlayingAutoEnabled(!next);
    }
  }

  async function toggleNowPlayingOnTicker() {
    if (!session || !eventId) return;
    const next = !nowPlayingOnTicker;
    setNowPlayingOnTicker(next);
    try {
      await api.updateEvent(eventId, { nowPlayingOnTicker: next } as Partial<EventRecord>, session.idToken);
    } catch {
      setNowPlayingOnTicker(!next);
    }
  }

  async function disconnectDjSource(slotId: string) {
    if (!session || !eventId) return;
    const isPushSource = slotId.startsWith("src-");
    const sourceId = slotId.replace(/^src-/, "");
    const nextBlocked = isPushSource
      ? [...new Set([...blockedPushSources, sourceId])]
      : blockedPushSources;
    const nextSlots = nowPlayingSlots.map((s) =>
      s.id === slotId ? { ...s, songTitle: "", artistName: "", active: false, updatedAt: new Date().toISOString() } : s,
    );
    if (isPushSource) setBlockedPushSources(nextBlocked);
    setNowPlayingSlots(nextSlots);
    try {
      const patch: Partial<EventRecord> = { nowPlayingSlots: nextSlots };
      if (isPushSource) patch.blockedPushSources = nextBlocked;
      const updated = await api.updateEvent(eventId, patch, session.idToken);
      setEventData(updated);
    } catch {
      if (isPushSource) setBlockedPushSources(blockedPushSources);
      setNowPlayingSlots(nowPlayingSlots);
    }
  }

  async function unblockDjSource(sourceId: string) {
    if (!session || !eventId) return;
    const nextBlocked = blockedPushSources.filter((s) => s !== sourceId);
    setBlockedPushSources(nextBlocked);
    try {
      const updated = await api.updateEvent(
        eventId,
        { blockedPushSources: nextBlocked } as Partial<EventRecord>,
        session.idToken,
      );
      setEventData(updated);
    } catch {
      setBlockedPushSources(blockedPushSources);
    }
  }

  async function detectPlayedTrack() {
    if (!session || !eventId || !playedTitle.trim()) {
      return;
    }
    setDetecting(true);
    setDetectMessage("");
    try {
      const result = await api.detectPlayed(
        eventId,
        {
          playedTitle: playedTitle.trim(),
          playedArtist: playedArtist.trim() || undefined,
          sourceId: selectedSourceId,
          reviewedBy: session.email,
        },
        session.idToken,
      );
      if (result.matched) {
        setDetectMessage(`Matched and marked played (score ${result.confidenceScore ?? 0}).`);
        setPlayedTitle("");
        setPlayedArtist("");
        await refresh();
      } else {
        setDetectMessage(result.reason ?? "No matching approved request found.");
      }
    } catch (error) {
      setDetectMessage((error as Error).message);
    } finally {
      setDetecting(false);
    }
  }

  async function runAutoDetectPlayed() {
    if (!session || !eventId) {
      return;
    }
    setAutoMatchingBusy(true);
    try {
      const result = await api.autoDetectPlayed(eventId, session.idToken);
      setSourceHealth(result.sourceStatuses ?? []);
      const latestEvent = await api.getEvent(eventId);
      setEventData(latestEvent);
      setTickerPromotions(latestEvent.tickerPromotions ?? []);
      setFireSaleActive(Boolean(latestEvent.fireSaleActive));
      setFireSaleMessage(latestEvent.fireSaleMessage ?? "");
      if (latestEvent.nowPlayingAutoEnabled && latestEvent.nowPlayingSlots?.length) {
        setNowPlayingSlots(latestEvent.nowPlayingSlots);
      }
      if (result.matched) {
        if (fireSaleActive) {
          await saveTickerSettings(tickerPromotions, false, "");
        }
        setAutoMatchingMessage(
          `Auto-matched ${result.request?.songTitle ?? "track"} from ${result.sourceName ?? result.sourceId ?? "source"}${
            result.currentTrack ? ` (live: ${result.currentTrack})` : ""
          }.`,
        );
        await refresh();
      } else {
        setAutoMatchingMessage(result.reason ?? "No live match.");
      }
    } catch (error) {
      setAutoMatchingMessage((error as Error).message);
    } finally {
      setAutoMatchingBusy(false);
    }
  }

  useEffect(() => {
    if (!autoMatchingEnabled || !session || !eventId) {
      return;
    }
    void runAutoDetectPlayed();
    const interval = window.setInterval(() => {
      void runAutoDetectPlayed();
    }, 15000);
    return () => window.clearInterval(interval);
  }, [autoMatchingEnabled, session, eventId]);

  async function saveTickerSettings(nextPromotions: string[], nextFireSaleActive: boolean, nextFireSaleMessage: string) {
    if (!session || !eventId) {
      return;
    }
    try {
      const updated = await api.updateEvent(
        eventId,
        {
          tickerPromotions: nextPromotions,
          fireSaleActive: nextFireSaleActive,
          fireSaleMessage: nextFireSaleMessage,
        },
        session.idToken,
      );
      setEventData(updated);
      setTickerPromotions(updated.tickerPromotions ?? nextPromotions);
      setFireSaleActive(Boolean(updated.fireSaleActive));
      setFireSaleMessage(updated.fireSaleMessage ?? nextFireSaleMessage);
      setTickerMessage("Ticker settings saved.");
    } catch (error) {
      setTickerMessage((error as Error).message);
    }
  }

  async function addPromotion() {
    const value = promotionInput.trim();
    if (!value) {
      return;
    }
    const nextPromotions = [...tickerPromotions, value];
    setTickerPromotions(nextPromotions);
    setPromotionInput("");
    await saveTickerSettings(nextPromotions, fireSaleActive, fireSaleMessage);
  }

  async function removePromotion(index: number) {
    const nextPromotions = tickerPromotions.filter((_, idx) => idx !== index);
    setTickerPromotions(nextPromotions);
    await saveTickerSettings(nextPromotions, fireSaleActive, fireSaleMessage);
  }

  async function triggerFireSale() {
    await saveTickerSettings(tickerPromotions, true, FIRE_SALE_MESSAGE);
  }

  async function turnOffFireSale() {
    await saveTickerSettings(tickerPromotions, false, "");
  }

  async function resetGenreVotes() {
    if (!session || !eventId) {
      return;
    }
    try {
      const updated = await api.resetGenreVotes(eventId, session.idToken);
      setEventData(updated);
      setTickerMessage("Genre votes reset.");
    } catch (error) {
      setTickerMessage((error as Error).message);
    }
  }

  async function clearRequestQueue() {
    if (!session || !eventId) {
      return;
    }
    try {
      const response = await api.resetRequests(eventId, session.idToken);
      setTickerMessage(`Queue cleared. Archived ${response.archivedCount} requests (analytics preserved).`);
      await refresh();
    } catch (error) {
      setTickerMessage((error as Error).message);
    }
  }

  if (!eventId) {
    return (
      <div className="mx-auto max-w-xl p-6 text-slate-100">
        <h1 className="text-2xl font-bold">Select Event</h1>
        <p className="mt-2 text-slate-300">Enter an event ID to load the DJ moderation queue.</p>
        <input
          className="mt-4 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
          placeholder="eventId"
          value={eventId}
          onChange={(e) => setEventId(e.target.value)}
        />
        <button
          className="mt-3 rounded-lg bg-orange-400 px-4 py-2 font-semibold text-orange-950"
          onClick={() => localStorage.setItem("activeEventId", eventId)}
        >
          Save Event
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <title>{eventData ? `Dashboard — ${eventData.name}` : "Dashboard — Casper Requests"}</title>
      <div className="mx-auto max-w-6xl">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div>
            <h1 className="text-2xl font-bold">DJ Dashboard</h1>
            <p className="text-sm text-slate-300">Event: {eventId}</p>
          </div>
          <div className="flex gap-2">
            {(eventData?.livePlaylistSources?.length ? eventData.livePlaylistSources : defaultLiveSources(eventData))
              .filter((source) => source.url)
              .map((source) => (
                <a
                  key={source.id}
                  className="rounded-md border border-sky-500/60 px-3 py-1.5 text-sm text-sky-300"
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open {source.name}
                </a>
              ))}
            {eventId ? (
              <Link className="rounded-md border border-violet-500/60 px-3 py-1.5 text-sm text-violet-300" to={`/analytics/${eventId}`}>
                Analytics
              </Link>
            ) : null}
            <Link className="rounded-md border border-slate-600 px-3 py-1.5 text-sm" to="/admin">
              Admin
            </Link>
            <button className="rounded-md bg-slate-700 px-3 py-1.5 text-sm" onClick={logout}>
              Sign Out
            </button>
          </div>
        </header>

        <section className="mb-5 rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold">Now Playing</h2>
              <button
                className={`rounded px-3 py-1 text-xs font-semibold ${
                  nowPlayingAutoEnabled ? "bg-emerald-400 text-emerald-950" : "bg-slate-700 text-slate-100"
                }`}
                onClick={() => void toggleNowPlayingAuto()}
              >
                {nowPlayingAutoEnabled ? "Auto: ON" : "Auto: OFF"}
              </button>
              <button
                className={`rounded px-3 py-1 text-xs font-semibold ${
                  nowPlayingOnTicker ? "bg-violet-400 text-violet-950" : "bg-slate-700 text-slate-100"
                }`}
                onClick={() => void toggleNowPlayingOnTicker()}
              >
                {nowPlayingOnTicker ? "On Ticker: YES" : "On Ticker: NO"}
              </button>
            </div>
            <button
              className="rounded bg-slate-700 px-3 py-1 text-xs font-semibold text-slate-100"
              onClick={() => setShowNowPlaying((prev) => !prev)}
            >
              {showNowPlaying ? "Hide" : "Show"}
            </button>
          </div>
          {(() => {
            const allSources = eventData?.livePlaylistSources ?? [];
            const pushSources = allSources.filter((s) => s.type === "rekordbox" || s.type === "serato");
            if (!pushSources.length && !blockedPushSources.length) return null;

            const knownSourceIds = new Set(pushSources.map((s) => s.id));
            const orphanBlocked = blockedPushSources.filter((id) => !knownSourceIds.has(id));

            const sourceRows = [
              ...pushSources.map((source) => {
                const isBlocked = blockedPushSources.includes(source.id);
                const matchState = eventData?.autoMatchState?.[source.id];
                const slot = nowPlayingSlots.find((s) => s.id === `src-${source.id}` && s.active && s.songTitle);
                const lastPushAt = matchState?.lastMatchedAt;
                const ageMs = lastPushAt ? Date.now() - new Date(lastPushAt).getTime() : null;
                const status = isBlocked ? "blocked" as const
                  : slot ? "active" as const
                  : lastPushAt ? "stale" as const
                  : "offline" as const;
                return { id: source.id, name: source.djName || source.name, status, ageMs, lastPushAt, track: slot?.songTitle };
              }),
              ...orphanBlocked.map((id) => ({
                id, name: id, status: "blocked" as const, ageMs: null, lastPushAt: undefined as string | undefined, track: undefined as string | undefined,
              })),
            ];

            return (
              <div className="mt-3 rounded-lg border border-slate-700 bg-slate-950/50 p-3">
                <p className="text-xs font-semibold text-slate-300">DJ Bridge Sources</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {sourceRows.map((src) => {
                    const statusColors = {
                      active: "border-emerald-500/40 bg-emerald-950/20",
                      stale: "border-amber-500/30 bg-amber-950/10",
                      blocked: "border-rose-500/30 bg-rose-950/20",
                      offline: "border-slate-700 bg-slate-900",
                    };
                    const badgeColors = {
                      active: "bg-emerald-400/20 text-emerald-300",
                      stale: "bg-amber-400/20 text-amber-300",
                      blocked: "bg-rose-400/20 text-rose-300",
                      offline: "bg-slate-700 text-slate-400",
                    };
                    const ageLabel = src.ageMs != null
                      ? src.ageMs < 60_000 ? "just now"
                        : src.ageMs < 3600_000 ? `${Math.floor(src.ageMs / 60_000)}m ago`
                        : `${Math.floor(src.ageMs / 3600_000)}h ago`
                      : null;

                    return (
                      <div key={src.id} className={`rounded-lg border p-2.5 ${statusColors[src.status]}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-100 truncate">{src.name}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${badgeColors[src.status]}`}>
                                {src.status}
                              </span>
                              {ageLabel ? <span className="text-xs text-slate-500">{ageLabel}</span> : null}
                            </div>
                            {src.track ? <p className="mt-1 text-xs text-slate-300 truncate">{src.track}</p> : null}
                          </div>
                          <div className="flex-shrink-0">
                            {src.status === "blocked" ? (
                              <button
                                className="rounded bg-emerald-500/20 px-2 py-1 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/40"
                                onClick={() => void unblockDjSource(src.id)}
                              >
                                Reconnect
                              </button>
                            ) : src.status === "active" ? (
                              <button
                                className="rounded bg-rose-500/20 px-2 py-1 text-xs font-semibold text-rose-300 hover:bg-rose-500/40"
                                onClick={() => void disconnectDjSource(`src-${src.id}`)}
                              >
                                Disconnect
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
          {showNowPlaying ? (
            nowPlayingAutoEnabled ? (
              <>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  {nowPlayingSlots.filter((s) => s.active && s.songTitle).length ? (
                    nowPlayingSlots
                      .filter((s) => s.active && s.songTitle)
                      .map((slot) => {
                        const ageMs = slot.updatedAt ? Date.now() - new Date(slot.updatedAt).getTime() : Infinity;
                        const isStale = ageMs > 3 * 60 * 1000;
                        const ageLabel = ageMs < 60_000
                          ? "just now"
                          : ageMs < 3600_000
                            ? `${Math.floor(ageMs / 60_000)}m ago`
                            : `${Math.floor(ageMs / 3600_000)}h ago`;
                        return (
                          <div
                            key={slot.id}
                            className={`rounded-lg border bg-slate-950 p-3 ${isStale ? "border-amber-500/30 opacity-60" : "border-emerald-500/30"}`}
                          >
                            <div className="flex items-start justify-between">
                              <p className={`text-xs font-semibold uppercase tracking-wide ${isStale ? "text-amber-300" : "text-emerald-300"}`}>{slot.djName}</p>
                              <button
                                className="rounded bg-rose-500/20 px-2 py-0.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/40"
                                onClick={() => void disconnectDjSource(slot.id)}
                                title={slot.id.startsWith("src-") ? "Remove from ticker and block future pushes" : "Clear this slot"}
                              >
                                {slot.id.startsWith("src-") ? "Disconnect" : "Clear"}
                              </button>
                            </div>
                            <p className="mt-1 text-sm font-semibold text-slate-100">{slot.songTitle}</p>
                            {slot.artistName ? <p className="text-xs text-slate-400">{slot.artistName}</p> : null}
                            {isStale ? (
                              <span className="mt-2 inline-block rounded bg-amber-400/20 px-2 py-0.5 text-xs text-amber-300">
                                Stale · {ageLabel}
                              </span>
                            ) : (
                              <span className="mt-2 inline-block rounded bg-emerald-400/20 px-2 py-0.5 text-xs text-emerald-300">
                                Live · {ageLabel}
                              </span>
                            )}
                          </div>
                        );
                      })
                  ) : (
                    <p className="col-span-3 text-sm text-slate-400">
                      Auto is on — waiting for live sources to report tracks. Turn on Auto-Match below to start polling.
                    </p>
                  )}
                </div>
                {nowPlayingSlots.some((s) => s.active && s.songTitle && s.updatedAt && Date.now() - new Date(s.updatedAt).getTime() > 3 * 60 * 1000) ? (
                  <div className="mt-2 flex justify-end">
                    <button
                      className="rounded bg-amber-500/20 px-3 py-1 text-xs font-semibold text-amber-300 hover:bg-amber-500/40"
                      onClick={() => {
                        const staleThreshold = Date.now() - 3 * 60 * 1000;
                        const cleaned = nowPlayingSlots.map((s) =>
                          s.active && s.updatedAt && new Date(s.updatedAt).getTime() < staleThreshold
                            ? { ...s, songTitle: "", artistName: "", active: false, updatedAt: new Date().toISOString() }
                            : s,
                        );
                        setNowPlayingSlots(cleaned);
                        void saveNowPlayingSlots(cleaned);
                      }}
                    >
                      Clear All Stale
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <div className="mb-3 mt-3 flex items-center justify-end">
                  <button
                    className="rounded bg-sky-400 px-3 py-1 text-xs font-semibold text-sky-950 disabled:opacity-60"
                    disabled={savingNowPlaying}
                    onClick={() => void saveNowPlayingSlots(nowPlayingSlots)}
                  >
                    {savingNowPlaying ? "Saving..." : "Save All"}
                  </button>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  {nowPlayingSlots.map((slot) => (
                    <div key={slot.id} className="rounded-lg border border-slate-700 bg-slate-950 p-3">
                      <input
                        className="mb-2 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm font-semibold"
                        value={slot.djName}
                        onChange={(e) => updateSlotField(slot.id, { djName: e.target.value })}
                        placeholder="DJ name"
                      />
                      <input
                        className="mb-2 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                        value={slot.songTitle}
                        onChange={(e) => updateSlotField(slot.id, { songTitle: e.target.value })}
                        placeholder="Song title"
                      />
                      <input
                        className="mb-2 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
                        value={slot.artistName ?? ""}
                        onChange={(e) => updateSlotField(slot.id, { artistName: e.target.value })}
                        placeholder="Artist"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          className="rounded bg-emerald-400 px-2 py-1 text-xs font-semibold text-emerald-950"
                          onClick={() => void markSlotActive(slot.id)}
                        >
                          Set Playing
                        </button>
                        <button
                          className="rounded bg-slate-500 px-2 py-1 text-xs font-semibold text-slate-950"
                          onClick={() => void clearSlot(slot.id)}
                        >
                          Clear
                        </button>
                        <span
                          className={`ml-auto rounded px-2 py-0.5 text-xs ${
                            slot.active ? "bg-emerald-400/20 text-emerald-300" : "bg-slate-700 text-slate-300"
                          }`}
                        >
                          {slot.active ? "Live" : "Idle"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )
          ) : null}
        </section>

        <section className="mb-5 rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-3 text-lg font-semibold">Ticker Promotions + Fire Sale</h2>
          <div className="flex flex-wrap gap-2">
            <input
              className="min-w-[280px] flex-1 rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              placeholder="Add promo message to scroll before requests"
              value={promotionInput}
              onChange={(e) => setPromotionInput(e.target.value)}
            />
            <button
              className="rounded bg-sky-400 px-3 py-2 text-sm font-semibold text-sky-950"
              onClick={() => void addPromotion()}
            >
              Add Promo
            </button>
          </div>
          {tickerPromotions.length ? (
            <div className="mt-3 grid gap-2">
              {tickerPromotions.map((promotion, idx) => (
                <div key={`${promotion}-${idx}`} className="flex items-center gap-2 rounded border border-slate-700 bg-slate-950 p-2">
                  <p className="flex-1 text-sm text-slate-200">{promotion}</p>
                  <button
                    className="rounded bg-rose-400 px-2 py-1 text-xs font-semibold text-rose-950"
                    onClick={() => void removePromotion(idx)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-400">No promotions configured.</p>
          )}

          <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-950/20 p-3">
            <p className="text-sm font-semibold text-amber-300">Fire Sale</p>
            <p className="mt-1 text-xs text-amber-100/90">{FIRE_SALE_MESSAGE}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                className="rounded bg-amber-400 px-3 py-1.5 text-sm font-semibold text-amber-950"
                onClick={() => void triggerFireSale()}
              >
                Activate Fire Sale
              </button>
              <button
                className="rounded bg-slate-700 px-3 py-1.5 text-sm font-semibold text-slate-100"
                onClick={() => void turnOffFireSale()}
              >
                Turn Off Fire Sale
              </button>
              <span
                className={`rounded px-2 py-0.5 text-xs ${
                  fireSaleActive ? "bg-emerald-400/20 text-emerald-300" : "bg-slate-700 text-slate-300"
                }`}
              >
                {fireSaleActive ? "Active" : "Off"}
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-300">
              Auto turns off when live playlist auto-match marks the next played song.
            </p>
          </div>
          {tickerMessage ? <p className="mt-3 text-sm text-slate-300">{tickerMessage}</p> : null}
        </section>

        <section className="mb-5 rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-3 text-lg font-semibold">Genre Vote Poll</h2>
          {(() => {
            const { votes, total } = normalizeGenreVotes(eventData);
            return (
              <>
                <p className="text-sm text-slate-300">
                  Live after {GENRE_VOTE_THRESHOLD} votes. Total votes: {total}
                </p>
                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  {ALL_GENRES.map((genre) => {
                    const percentage = total ? Math.round((votes[genre] / total) * 100) : 0;
                    return (
                      <div key={genre} className="rounded border border-slate-700 bg-slate-950 p-3">
                        <p className="text-xs uppercase text-slate-300">{GENRE_LABELS[genre]}</p>
                        <p className="mt-1 text-lg font-semibold text-slate-100">{percentage}%</p>
                        <p className="text-xs text-slate-400">{votes[genre]} votes</p>
                      </div>
                    );
                  })}
                </div>
                <button
                  className="mt-3 rounded bg-rose-400 px-3 py-1.5 text-sm font-semibold text-rose-950"
                  onClick={() => void resetGenreVotes()}
                >
                  Clear Votes (End of Night)
                </button>
                <button
                  className="ml-2 mt-3 rounded bg-amber-400 px-3 py-1.5 text-sm font-semibold text-amber-950"
                  onClick={() => void clearRequestQueue()}
                >
                  Clear Request Queue
                </button>
              </>
            );
          })()}
        </section>

        <section className="mb-5 rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-3 text-lg font-semibold">Register Played Song (all 3 playlists)</h2>
          <div className="grid gap-2 md:grid-cols-4">
            <select
              className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              value={selectedSourceId}
              onChange={(e) => setSelectedSourceId(e.target.value)}
            >
              {(eventData?.livePlaylistSources?.length ? eventData.livePlaylistSources : defaultLiveSources(eventData)).map(
                (source) => (
                  <option key={source.id} value={source.id}>
                    {source.name}
                  </option>
                ),
              )}
            </select>
            <input
              className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm md:col-span-2"
              placeholder="Played song title (include remix if needed)"
              value={playedTitle}
              onChange={(e) => setPlayedTitle(e.target.value)}
            />
            <input
              className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              placeholder="Artist (optional)"
              value={playedArtist}
              onChange={(e) => setPlayedArtist(e.target.value)}
            />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              className="rounded bg-emerald-400 px-3 py-1.5 text-sm font-semibold text-emerald-950 disabled:opacity-60"
              onClick={() => void detectPlayedTrack()}
              disabled={detecting || !playedTitle.trim()}
            >
              {detecting ? "Matching..." : "Match + Mark Played"}
            </button>
            {detectMessage ? <p className="text-sm text-slate-300">{detectMessage}</p> : null}
          </div>
          <div className="mt-4 rounded-lg border border-slate-700 bg-slate-950/50 p-3">
            <p className="text-sm font-semibold">Auto-match from live playlist URLs</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                className="rounded bg-sky-400 px-3 py-1.5 text-sm font-semibold text-sky-950 disabled:opacity-60"
                onClick={() => void runAutoDetectPlayed()}
                disabled={autoMatchingBusy}
              >
                {autoMatchingBusy ? "Checking..." : "Check Live Playlists Now"}
              </button>
              <button
                className={`rounded px-3 py-1.5 text-sm font-semibold ${
                  autoMatchingEnabled ? "bg-emerald-400 text-emerald-950" : "bg-slate-700 text-slate-100"
                }`}
                onClick={() => setAutoMatchingEnabled((prev) => !prev)}
              >
                {autoMatchingEnabled ? "Auto-Match: ON (15s)" : "Auto-Match: OFF"}
              </button>
              {autoMatchingMessage ? <p className="text-sm text-slate-300">{autoMatchingMessage}</p> : null}
            </div>
            {(() => {
              const shownSourceIds = new Set(sourceHealth.map((s) => `src-${s.sourceId}`));
              const bridgeSlots = (nowPlayingSlots ?? []).filter(
                (s) => s.active && s.songTitle && !shownSourceIds.has(s.id),
              );
              const allCards: Array<{
                key: string;
                name: string;
                badge: string;
                badgeClass: string;
                track?: string;
                detail?: string;
                source: "url" | "bridge";
                updatedAt?: string;
              }> = [];

              for (const source of sourceHealth) {
                const slot = nowPlayingSlots.find((s) => s.id === `src-${source.sourceId}` && s.active && s.songTitle);
                const bridgeTrack = slot?.songTitle;
                const hasLiveTrack = source.health === "live" && source.currentTrack;
                const badge = hasLiveTrack ? "live" : bridgeTrack ? "bridge" : source.health;
                const badgeClass = hasLiveTrack
                  ? "bg-emerald-400/20 text-emerald-300"
                  : bridgeTrack
                    ? "bg-indigo-400/20 text-indigo-300"
                    : source.health === "private"
                      ? "bg-rose-400/20 text-rose-300"
                      : source.health === "no_track_data"
                        ? "bg-amber-400/20 text-amber-300"
                        : "bg-slate-700 text-slate-300";
                allCards.push({
                  key: source.sourceId,
                  name: source.sourceName,
                  badge,
                  badgeClass,
                  track: hasLiveTrack ? source.currentTrack : bridgeTrack || undefined,
                  detail: source.detail,
                  source: bridgeTrack && !hasLiveTrack ? "bridge" : "url",
                  updatedAt: slot?.updatedAt,
                });
              }

              for (const slot of bridgeSlots) {
                const ageMs = slot.updatedAt ? Date.now() - new Date(slot.updatedAt).getTime() : Infinity;
                const stale = ageMs > 3 * 60 * 1000;
                allCards.push({
                  key: slot.id,
                  name: slot.djName || "DJ Bridge",
                  badge: stale ? "stale" : "bridge",
                  badgeClass: stale ? "bg-amber-400/20 text-amber-300" : "bg-indigo-400/20 text-indigo-300",
                  track: slot.songTitle,
                  source: "bridge",
                  updatedAt: slot.updatedAt,
                });
              }

              if (!allCards.length) return null;
              return (
                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  {allCards.map((card) => {
                    const agoMs = card.updatedAt ? Date.now() - new Date(card.updatedAt).getTime() : null;
                    const agoLabel = agoMs != null
                      ? agoMs < 60_000 ? `${Math.round(agoMs / 1000)}s ago` : `${Math.round(agoMs / 60_000)}m ago`
                      : null;
                    return (
                      <div
                        key={card.key}
                        className={`rounded border p-2 text-xs ${
                          card.source === "bridge" ? "border-indigo-500/40 bg-indigo-950/20" : "border-slate-700 bg-slate-900"
                        }`}
                      >
                        <p className="font-semibold text-slate-100">{card.name}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <span className={`inline-flex rounded px-2 py-0.5 ${card.badgeClass}`}>{card.badge}</span>
                          {card.source === "bridge" ? (
                            <span className="inline-flex rounded bg-indigo-500/20 px-1.5 py-0.5 text-indigo-300">via Bridge</span>
                          ) : null}
                          {agoLabel ? <span className="text-slate-500">{agoLabel}</span> : null}
                        </div>
                        {card.track ? <p className="mt-1 text-slate-300">{card.track}</p> : null}
                        {card.detail ? <p className="mt-1 text-slate-400">{card.detail}</p> : null}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </section>

        {pendingShoutouts.length > 0 ? (
          <section className="mb-5 rounded-xl border border-violet-500/30 bg-violet-950/20 p-4">
            <h2 className="mb-3 text-lg font-semibold text-violet-200">
              Shoutouts <span className="text-sm font-normal text-violet-400">({pendingShoutouts.length} pending)</span>
            </h2>
            <div className="grid gap-2">
              {pendingShoutouts.map((req) => (
                <div
                  key={req.requestId}
                  className="flex items-center gap-3 rounded-lg border border-violet-500/20 bg-slate-900/70 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-violet-200">"{req.shoutout}"</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {req.requesterName?.trim() || "Guest"} · {new Date(req.submittedAt).toLocaleTimeString()}
                    </p>
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      className="rounded-md bg-violet-500 px-3 py-1.5 text-xs font-semibold text-white"
                      onClick={() => void updateShoutout(req.requestId, true, true)}
                    >
                      Approve
                    </button>
                    <button
                      className="rounded-md bg-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200"
                      onClick={() => void updateShoutout(req.requestId, false, true)}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <div className="mb-4 flex flex-wrap gap-2">
          {(["pending", "approved", "played", "vetoed"] as Tab[]).map((tabItem) => (
            <button
              key={tabItem}
              className={`rounded-md px-3 py-1.5 text-sm ${
                tab === tabItem ? "bg-orange-400 text-orange-950" : "bg-slate-800 text-slate-200"
              }`}
              onClick={() => setTab(tabItem)}
            >
              {tabItem} ({filteredGrouped[tabItem].length})
            </button>
          ))}
        </div>

        {loading ? <p>Loading requests...</p> : null}

        <div className="mb-2 flex items-center gap-3 text-xs text-slate-500">
          <span>Shortcuts:</span>
          <kbd className="rounded bg-slate-800 px-1.5 py-0.5 font-mono">↑↓</kbd> navigate
          {tab === "pending" ? (
            <>
              <kbd className="rounded bg-slate-800 px-1.5 py-0.5 font-mono">A</kbd> approve
              <kbd className="rounded bg-slate-800 px-1.5 py-0.5 font-mono">V</kbd> veto
            </>
          ) : null}
          {tab === "approved" ? (
            <>
              <kbd className="rounded bg-slate-800 px-1.5 py-0.5 font-mono">P</kbd> played
              <kbd className="rounded bg-slate-800 px-1.5 py-0.5 font-mono">V</kbd> veto
            </>
          ) : null}
        </div>
        <div className="grid gap-3">
          {visible.map((request, index) => (
            <div
              key={request.requestId}
              ref={index === selectedIndex ? selectedRef : undefined}
              className={`space-y-2 rounded-lg transition-all ${index === selectedIndex ? "ring-2 ring-orange-400/80 ring-offset-1 ring-offset-slate-950" : ""}`}
            >
              <RequestCard
                request={request}
                libraryMatch={findLibraryMatch(request.songTitle, request.artistName)}
                onApprove={tab === "pending" ? (id) => void updateStatus(id, "approved") : undefined}
                onVeto={tab === "pending" || tab === "approved" ? (id) => void updateStatus(id, "vetoed") : undefined}
                onPlayed={tab === "approved" ? (id) => void updateStatus(id, "played") : undefined}
                onVerifyTip={
                  (request.paymentStatus ?? "unpaid") === "pending_verification"
                    ? (id) => void updatePayment(id, "verified")
                    : undefined
                }
                onRejectTip={
                  (request.paymentStatus ?? "unpaid") === "pending_verification" ||
                  (request.paymentStatus ?? "unpaid") === "verified"
                    ? (id) => void updatePayment(id, "rejected")
                    : undefined
                }
                onApproveShoutout={
                  request.shoutout && request.shoutoutApproved == null
                    ? (id) => void updateShoutout(id, true)
                    : undefined
                }
                onRejectShoutout={
                  request.shoutout && request.shoutoutApproved == null
                    ? (id) => void updateShoutout(id, false)
                    : undefined
                }
              />
              {tab === "approved" ? (
                <div className="flex gap-2">
                  <button
                    className="rounded bg-slate-800 px-2 py-1 text-xs"
                    onClick={() => void moveApproved(request.requestId, "up")}
                    disabled={index === 0}
                  >
                    Move Up
                  </button>
                  <button
                    className="rounded bg-slate-800 px-2 py-1 text-xs"
                    onClick={() => void moveApproved(request.requestId, "down")}
                    disabled={index === visible.length - 1}
                  >
                    Move Down
                  </button>
                </div>
              ) : null}
            </div>
          ))}
          {!visible.length ? <p className="text-sm text-slate-400">No requests in this list.</p> : null}
        </div>
      </div>
    </div>
  );
}
