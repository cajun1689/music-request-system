import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { RequestCard } from "../components/RequestCard";
import { useAuth } from "../context/AuthContext";
import { useRequests } from "../hooks/useRequests";
import { api } from "../services/api";
import type { EventRecord, NowPlayingSlot } from "../types";

type Tab = "pending" | "approved" | "played" | "vetoed";

function defaultNowPlayingSlots(): NowPlayingSlot[] {
  return [
    { id: "dj-1", djName: "DJ 1", songTitle: "", artistName: "", active: false },
    { id: "dj-2", djName: "DJ 2", songTitle: "", artistName: "", active: false },
    { id: "dj-3", djName: "DJ 3", songTitle: "", artistName: "", active: false },
  ];
}

export function DashboardPage() {
  const { eventId: routeEventId } = useParams();
  const { session, logout } = useAuth();
  const [eventId, setEventId] = useState(routeEventId ?? localStorage.getItem("activeEventId") ?? "");
  const [eventData, setEventData] = useState<EventRecord | null>(null);
  const [nowPlayingSlots, setNowPlayingSlots] = useState<NowPlayingSlot[]>(defaultNowPlayingSlots());
  const [savingNowPlaying, setSavingNowPlaying] = useState(false);
  const [tab, setTab] = useState<Tab>("pending");
  const { grouped, loading, applyLocalStatus, refresh } = useRequests(eventId || undefined, "dj");

  const visible = useMemo(() => grouped[tab], [grouped, tab]);

  useEffect(() => {
    if (!eventId) {
      return;
    }
    void api
      .getEvent(eventId)
      .then((evt) => {
        setEventData(evt);
        setNowPlayingSlots(evt.nowPlayingSlots?.length ? evt.nowPlayingSlots : defaultNowPlayingSlots());
      })
      .catch(() => {
        setEventData(null);
        setNowPlayingSlots(defaultNowPlayingSlots());
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
    const list = [...grouped.approved].sort(
      (a, b) => Number(a.position ?? Number.MAX_SAFE_INTEGER) - Number(b.position ?? Number.MAX_SAFE_INTEGER),
    );
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
    const currentPos = current.position ?? idx;
    const targetPos = target.position ?? swapIdx;

    await Promise.all([
      api.updateRequest(
        eventId,
        current.requestId,
        { position: targetPos, reviewedBy: session.email },
        session.idToken,
      ),
      api.updateRequest(
        eventId,
        target.requestId,
        { position: currentPos, reviewedBy: session.email },
        session.idToken,
      ),
    ]);

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
      <div className="mx-auto max-w-6xl">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div>
            <h1 className="text-2xl font-bold">DJ Dashboard</h1>
            <p className="text-sm text-slate-300">Event: {eventId}</p>
          </div>
          <div className="flex gap-2">
            {eventData?.seratoLiveUrl ? (
              <a
                className="rounded-md border border-sky-500/60 px-3 py-1.5 text-sm text-sky-300"
                href={eventData.seratoLiveUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open Serato Live
              </a>
            ) : null}
            {eventData?.rekordboxLiveUrl ? (
              <a
                className="rounded-md border border-indigo-500/60 px-3 py-1.5 text-sm text-indigo-300"
                href={eventData.rekordboxLiveUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open Rekordbox Link
              </a>
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
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Now Playing (Multi-DJ)</h2>
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
        </section>

        <div className="mb-4 flex flex-wrap gap-2">
          {(["pending", "approved", "played", "vetoed"] as Tab[]).map((tabItem) => (
            <button
              key={tabItem}
              className={`rounded-md px-3 py-1.5 text-sm ${
                tab === tabItem ? "bg-orange-400 text-orange-950" : "bg-slate-800 text-slate-200"
              }`}
              onClick={() => setTab(tabItem)}
            >
              {tabItem} ({grouped[tabItem].length})
            </button>
          ))}
        </div>

        {loading ? <p>Loading requests...</p> : null}

        <div className="grid gap-3">
          {visible.map((request, index) => (
            <div key={request.requestId} className="space-y-2">
              <RequestCard
                request={request}
                onApprove={tab === "pending" ? (id) => void updateStatus(id, "approved") : undefined}
                onVeto={tab === "pending" ? (id) => void updateStatus(id, "vetoed") : undefined}
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
