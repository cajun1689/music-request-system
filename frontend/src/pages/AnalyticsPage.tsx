import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api } from "../services/api";
import type { EventRecord, RequestRecord } from "../types";
import { toDisplayTitleCase } from "../utils/formatting";
import { ALL_GENRES, GENRE_LABELS, normalizeGenreVotes } from "../utils/genreVotes";

type TimeRange = "day" | "week" | "month" | "all";

const RANGE_LABELS: Record<TimeRange, string> = {
  day: "Today",
  week: "This Week",
  month: "This Month",
  all: "All Time",
};

function getRangeCutoff(range: TimeRange): Date | null {
  if (range === "all") return null;
  const now = new Date();
  if (range === "day") {
    now.setHours(0, 0, 0, 0);
    return now;
  }
  if (range === "week") {
    const day = now.getDay();
    now.setDate(now.getDate() - day);
    now.setHours(0, 0, 0, 0);
    return now;
  }
  now.setDate(1);
  now.setHours(0, 0, 0, 0);
  return now;
}

function formatBucketLabel(d: Date, range: TimeRange): string {
  if (range === "day") {
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  }
  if (range === "week") {
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
  }
  if (range === "month") {
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
  const span = Date.now() - d.getTime();
  if (span < 90 * 24 * 60 * 60 * 1000) {
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
  return `${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`;
}

function getBucketMs(range: TimeRange, spanMs: number): number {
  if (range === "day") return 15 * 60 * 1000;
  if (range === "week") return 24 * 60 * 60 * 1000;
  if (range === "month") return 24 * 60 * 60 * 1000;
  if (spanMs < 90 * 24 * 60 * 60 * 1000) return 7 * 24 * 60 * 60 * 1000;
  return 30 * 24 * 60 * 60 * 1000;
}

function bucketByRange(requests: RequestRecord[], range: TimeRange) {
  if (!requests.length) return [];
  const sorted = [...requests].sort((a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime());
  const start = new Date(sorted[0].submittedAt).getTime();
  const end = new Date(sorted[sorted.length - 1].submittedAt).getTime();
  const spanMs = end - start;
  const bucketMs = getBucketMs(range, spanMs);
  const buckets: { label: string; count: number }[] = [];

  for (let t = start; t <= end + bucketMs; t += bucketMs) {
    const bucketEnd = t + bucketMs;
    const count = sorted.filter((r) => {
      const ts = new Date(r.submittedAt).getTime();
      return ts >= t && ts < bucketEnd;
    }).length;
    buckets.push({ label: formatBucketLabel(new Date(t), range), count });
  }
  return buckets;
}

function getTimelineTitle(range: TimeRange): string {
  if (range === "day") return "Request Timeline (15-min buckets)";
  if (range === "week") return "Requests by Day";
  if (range === "month") return "Requests by Day";
  return "Request Timeline";
}

export function AnalyticsPage() {
  const { eventId } = useParams();
  useAuth();
  const [eventData, setEventData] = useState<EventRecord | null>(null);
  const [allRequests, setAllRequests] = useState<RequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<TimeRange>("all");

  useEffect(() => {
    if (!eventId) return;
    setLoading(true);
    Promise.all([api.getEvent(eventId), api.getRequests(eventId)])
      .then(([event, reqs]) => {
        setEventData(event);
        setAllRequests(reqs);
      })
      .finally(() => setLoading(false));
  }, [eventId]);

  const requests = useMemo(() => {
    const cutoff = getRangeCutoff(range);
    if (!cutoff) return allRequests;
    const cutoffMs = cutoff.getTime();
    return allRequests.filter((r) => new Date(r.submittedAt).getTime() >= cutoffMs);
  }, [allRequests, range]);

  const stats = useMemo(() => {
    const total = requests.length;
    const approved = requests.filter((r) => r.status === "approved" || r.status === "played").length;
    const vetoed = requests.filter((r) => r.status === "vetoed").length;
    const played = requests.filter((r) => r.status === "played").length;
    const pending = requests.filter((r) => r.status === "pending").length;

    const tips = requests.filter((r) => r.tipAmount && r.tipAmount > 0);
    const totalTips = tips.reduce((sum, r) => sum + (r.tipAmount ?? 0), 0);
    const avgTip = tips.length ? totalTips / tips.length : 0;
    const maxTip = tips.length ? Math.max(...tips.map((r) => r.tipAmount ?? 0)) : 0;

    const songCounts: Record<string, { title: string; artist: string; count: number }> = {};
    for (const req of requests) {
      const key = `${req.songTitle.toLowerCase()}|${req.artistName.toLowerCase()}`;
      if (!songCounts[key]) {
        songCounts[key] = { title: req.songTitle, artist: req.artistName, count: 0 };
      }
      songCounts[key].count++;
    }
    const topSongs = Object.values(songCounts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const artistCounts: Record<string, { artist: string; count: number }> = {};
    for (const req of requests) {
      const key = req.artistName.toLowerCase();
      if (!artistCounts[key]) {
        artistCounts[key] = { artist: req.artistName, count: 0 };
      }
      artistCounts[key].count++;
    }
    const topArtists = Object.values(artistCounts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const totalUpvotes = requests.reduce((sum, r) => sum + (r.upvotes ?? 0), 0);

    return {
      total,
      approved,
      vetoed,
      played,
      pending,
      approvalRate: total ? Math.round((approved / total) * 100) : 0,
      vetoRate: total ? Math.round((vetoed / total) * 100) : 0,
      totalTips,
      avgTip,
      maxTip,
      tipCount: tips.length,
      topSongs,
      topArtists,
      totalUpvotes,
    };
  }, [requests]);

  const timeline = useMemo(() => bucketByRange(requests, range), [requests, range]);
  const maxBucket = Math.max(...timeline.map((b) => b.count), 1);

  if (loading) {
    return <div className="min-h-screen bg-slate-950 p-6 text-slate-100">Loading analytics...</div>;
  }

  const genreData = eventData ? normalizeGenreVotes(eventData) : null;

  return (
    <div className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <title>{eventData ? `Analytics — ${eventData.name}` : "Analytics — Casper Requests"}</title>
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Set Analytics</h1>
              <p className="text-sm text-slate-400">{eventData?.name} — {eventData?.venueName} — {eventData?.date}</p>
            </div>
            <div className="flex gap-2">
              {eventId ? (
                <Link className="rounded-md border border-slate-600 px-3 py-1.5 text-sm" to={`/dashboard/${eventId}`}>
                  Dashboard
                </Link>
              ) : null}
            </div>
          </div>
          <div className="mt-3 flex gap-1 rounded-lg bg-slate-950 p-1">
            {(["day", "week", "month", "all"] as TimeRange[]).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  range === r
                    ? "bg-orange-500 text-white shadow"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {RANGE_LABELS[r]}
              </button>
            ))}
          </div>
        </header>

        {requests.length === 0 && (
          <div className="mb-6 rounded-xl border border-slate-800 bg-slate-900 p-8 text-center">
            <p className="text-lg font-medium text-slate-400">No requests {range === "all" ? "yet" : `for ${RANGE_LABELS[range].toLowerCase()}`}.</p>
            {range !== "all" && (
              <button onClick={() => setRange("all")} className="mt-2 text-sm text-orange-400 hover:text-orange-300">
                View all time instead
              </button>
            )}
          </div>
        )}

        {/* Summary Cards */}
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Total Requests", value: stats.total, color: "text-slate-100" },
            { label: "Played", value: stats.played, color: "text-sky-300" },
            { label: "Approval Rate", value: `${stats.approvalRate}%`, color: "text-emerald-300" },
            { label: "Veto Rate", value: `${stats.vetoRate}%`, color: "text-rose-300" },
            { label: "Total Tips", value: `$${stats.totalTips.toFixed(2)}`, color: "text-emerald-300" },
            { label: "Average Tip", value: `$${stats.avgTip.toFixed(2)}`, color: "text-emerald-200" },
            { label: "Highest Tip", value: `$${stats.maxTip.toFixed(2)}`, color: "text-amber-300" },
            { label: "Total Upvotes", value: stats.totalUpvotes, color: "text-amber-200" },
          ].map((card) => (
            <div key={card.label} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-400">{card.label}</p>
              <p className={`mt-1 text-2xl font-bold ${card.color}`}>{card.value}</p>
            </div>
          ))}
        </div>

        {/* Request Timeline */}
        {timeline.length > 1 ? (
          <section className="mb-6 rounded-xl border border-slate-800 bg-slate-900 p-4">
            <h2 className="mb-3 text-lg font-semibold">{getTimelineTitle(range)}</h2>
            <div className="flex items-end gap-1" style={{ height: 120 }}>
              {timeline.map((bucket) => (
                <div key={bucket.label} className="flex flex-1 flex-col items-center gap-1">
                  <div
                    className="w-full rounded-t bg-orange-400/80"
                    style={{ height: `${(bucket.count / maxBucket) * 100}px` }}
                  />
                  <span className="text-[9px] text-slate-500">{bucket.label}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <div className="mb-6 grid gap-6 lg:grid-cols-2">
          {/* Top Songs */}
          <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <h2 className="mb-3 text-lg font-semibold">Most Requested Songs</h2>
            <div className="space-y-2">
              {stats.topSongs.map((song, idx) => (
                <div key={`${song.title}-${song.artist}`} className="flex items-center gap-3">
                  <span className="w-6 text-right text-sm font-bold text-slate-500">{idx + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{toDisplayTitleCase(song.title)}</p>
                    <p className="truncate text-xs text-slate-400">{toDisplayTitleCase(song.artist)}</p>
                  </div>
                  <span className="text-sm font-bold text-orange-300">{song.count}x</span>
                </div>
              ))}
              {stats.topSongs.length === 0 ? <p className="text-sm text-slate-500">No requests yet.</p> : null}
            </div>
          </section>

          {/* Top Artists */}
          <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <h2 className="mb-3 text-lg font-semibold">Most Requested Artists</h2>
            <div className="space-y-2">
              {stats.topArtists.map((entry, idx) => (
                <div key={entry.artist} className="flex items-center gap-3">
                  <span className="w-6 text-right text-sm font-bold text-slate-500">{idx + 1}</span>
                  <p className="min-w-0 flex-1 truncate text-sm font-semibold">{toDisplayTitleCase(entry.artist)}</p>
                  <span className="text-sm font-bold text-sky-300">{entry.count}x</span>
                </div>
              ))}
              {stats.topArtists.length === 0 ? <p className="text-sm text-slate-500">No requests yet.</p> : null}
            </div>
          </section>
        </div>

        {/* Genre Vote Results */}
        {genreData && genreData.total > 0 ? (
          <section className="mb-6 rounded-xl border border-slate-800 bg-slate-900 p-4">
            <h2 className="mb-3 text-lg font-semibold">Genre Vote Results</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {ALL_GENRES.map((genre) => {
                const pct = genreData.total ? Math.round((genreData.votes[genre] / genreData.total) * 100) : 0;
                return (
                  <div key={genre} className="rounded-lg border border-slate-700 bg-slate-950 p-3">
                    <p className="text-xs uppercase text-slate-400">{GENRE_LABELS[genre]}</p>
                    <p className="mt-1 text-xl font-bold">{pct}%</p>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
                      <div className="h-full rounded-full bg-orange-400" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{genreData.votes[genre]} votes</p>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
