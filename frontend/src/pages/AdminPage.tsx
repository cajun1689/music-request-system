import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { QRGenerator } from "../components/QRGenerator";
import { useAuth } from "../context/AuthContext";
import { api } from "../services/api";
import type { EventRecord, GenreName, LivePlaylistSource } from "../types";
import {
  ALL_GENRES,
  GENRE_LABELS,
  GENRE_VOTE_THRESHOLD,
  buildGenreTickerItem,
  normalizeGenreVotes,
} from "../utils/genreVotes";

const GASLIGHT_SLUG = "gaslight-residency";
const BDL_SLUG = "bdl-residency";
const defaultLiveSources = (seratoUrl = "", rekordboxUrl = ""): LivePlaylistSource[] => [
  { id: "serato-a", name: "Serato A", type: "serato", url: seratoUrl, active: Boolean(seratoUrl) },
  { id: "serato-b", name: "Serato B", type: "serato", url: "", active: false },
  { id: "rekordbox", name: "Rekordbox", type: "rekordbox", url: rekordboxUrl, active: Boolean(rekordboxUrl) },
];

const emptyForm = {
  name: "",
  date: "",
  venueName: "",
  djBrandName: "",
  seratoLiveUrl: "",
  seratoLiveUrl2: "",
  rekordboxLiveUrl: "",
  primaryColor: "#0f172a",
  secondaryColor: "#1e293b",
  accentColor: "#f97316",
};

const emptyEventDetails = {
  name: "",
  date: "",
  venueName: "",
  djBrandName: "",
  primaryColor: "#0f172a",
  secondaryColor: "#1e293b",
  accentColor: "#f97316",
};

interface EventSummary {
  eventId: string;
  name: string;
  date: string;
  venueName: string;
  djBrandName: string;
  isActive: boolean;
  slug?: string;
}

export function AdminPage() {
  const { session, logout } = useAuth();
  const [form, setForm] = useState(emptyForm);
  const [eventData, setEventData] = useState<EventRecord | null>(null);
  const [djLogoFile, setDjLogoFile] = useState<File | null>(null);
  const [venueLogoFile, setVenueLogoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingLogoType, setUploadingLogoType] = useState<"dj" | "venue" | null>(null);
  const [message, setMessage] = useState<string>("");
  const [eventDetails, setEventDetails] = useState(emptyEventDetails);
  const [lookupEventId, setLookupEventId] = useState<string>(localStorage.getItem("activeEventId") ?? "");
  const [seratoLiveUrlEdit, setSeratoLiveUrlEdit] = useState<string>("");
  const [seratoLiveUrl2Edit, setSeratoLiveUrl2Edit] = useState<string>("");
  const [rekordboxLiveUrlEdit, setRekordboxLiveUrlEdit] = useState<string>("");
  const [seratoDjName, setSeratoDjName] = useState<string>("");
  const [serato2DjName, setSerato2DjName] = useState<string>("");
  const [rekordboxDjName, setRekordboxDjName] = useState<string>("");
  const [autoApproveInput, setAutoApproveInput] = useState("");
  const [blockListInput, setBlockListInput] = useState("");
  const [libraryOnlyMode, setLibraryOnlyMode] = useState(false);
  const [allEvents, setAllEvents] = useState<EventSummary[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function loadAllEvents() {
    setLoadingEvents(true);
    try {
      const { events } = await api.listEvents();
      setAllEvents(events);
    } catch {
      setAllEvents([]);
    } finally {
      setLoadingEvents(false);
    }
  }

  async function onDeleteEvent(eventId: string, eventName: string) {
    if (!session) return;
    if (!window.confirm(`Delete "${eventName}"? This will also remove all its requests.`)) return;
    setDeletingId(eventId);
    try {
      const result = await api.deleteEvent(eventId, session.idToken);
      setMessage(`Deleted "${eventName}" and ${result.deletedRequests} requests.`);
      if (eventData?.eventId === eventId) {
        setEventData(null);
        localStorage.removeItem("activeEventId");
      }
      void loadAllEvents();
    } catch (err) {
      setMessage(`Delete failed: ${(err as Error).message}`);
    } finally {
      setDeletingId(null);
    }
  }

  useEffect(() => {
    void loadAllEvents();
  }, []);

  const requestUrl = useMemo(() => {
    if (!eventData) {
      return "";
    }
    return `${window.location.origin}/event/${eventData.eventId}`;
  }, [eventData]);

  useEffect(() => {
    if (eventData) {
      setEventDetails({
        name: eventData.name ?? "",
        date: eventData.date ?? "",
        venueName: eventData.venueName ?? "",
        djBrandName: eventData.djBrandName ?? "",
        primaryColor: eventData.primaryColor ?? "#0f172a",
        secondaryColor: eventData.secondaryColor ?? "#1e293b",
        accentColor: eventData.accentColor ?? "#f97316",
      });
      setAutoApproveInput((eventData.autoApproveList ?? []).join(", "));
      setBlockListInput((eventData.blockList ?? []).join(", "));
      setLibraryOnlyMode(Boolean(eventData.libraryOnlyMode));
    } else {
      setEventDetails(emptyEventDetails);
      setAutoApproveInput("");
      setBlockListInput("");
      setLibraryOnlyMode(false);
    }

    const sources =
      eventData?.livePlaylistSources?.length
        ? eventData.livePlaylistSources
        : defaultLiveSources(eventData?.seratoLiveUrl ?? "", eventData?.rekordboxLiveUrl ?? "");
    setSeratoLiveUrlEdit(sources.find((source) => source.id === "serato-a")?.url ?? "");
    setSeratoLiveUrl2Edit(sources.find((source) => source.id === "serato-b")?.url ?? "");
    setRekordboxLiveUrlEdit(sources.find((source) => source.id === "rekordbox")?.url ?? "");
    setSeratoDjName(sources.find((source) => source.id === "serato-a")?.djName ?? "");
    setSerato2DjName(sources.find((source) => source.id === "serato-b")?.djName ?? "");
    setRekordboxDjName(sources.find((source) => source.id === "rekordbox")?.djName ?? "");
  }, [eventData]);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (!session) {
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      const created = await api.createEvent(
        {
          ...form,
          livePlaylistSources: [
            { id: "serato-a", name: "Serato A", type: "serato", url: form.seratoLiveUrl, active: Boolean(form.seratoLiveUrl) },
            { id: "serato-b", name: "Serato B", type: "serato", url: form.seratoLiveUrl2, active: Boolean(form.seratoLiveUrl2) },
            {
              id: "rekordbox",
              name: "Rekordbox",
              type: "rekordbox",
              url: form.rekordboxLiveUrl,
              active: Boolean(form.rekordboxLiveUrl),
            },
          ],
        },
        session.idToken,
      );
      setEventData(created);
      localStorage.setItem("activeEventId", created.eventId);
      setMessage("Event created.");
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function onUploadLogo(type: "dj" | "venue") {
    if (!session || !eventData) {
      return;
    }
    const file = type === "dj" ? djLogoFile : venueLogoFile;
    if (!file) {
      setMessage(`Choose a ${type === "dj" ? "DJ" : "Venue"} logo file first.`);
      return;
    }
    setUploadingLogoType(type);
    setMessage("");
    try {
      const logoUrl = await api.uploadBrandAsset(eventData.eventId, file, session.idToken);
      const updated = await api.updateEvent(
        eventData.eventId,
        type === "dj" ? { djLogoUrl: logoUrl } : { venueLogoUrl: logoUrl },
        session.idToken,
      );
      setEventData(updated);
      if (type === "dj") {
        setDjLogoFile(null);
      } else {
        setVenueLogoFile(null);
      }
      setMessage(`${type === "dj" ? "DJ" : "Venue"} logo uploaded.`);
    } catch (err) {
      setMessage(`Logo upload failed: ${(err as Error).message}`);
    } finally {
      setUploadingLogoType(null);
    }
  }

  async function onLoadGaslightResidency() {
    if (!session) {
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const existing = await api.getEventBySlug(GASLIGHT_SLUG, session.idToken);
      setEventData(existing);
      localStorage.setItem("activeEventId", existing.eventId);
      setMessage("Loaded Gaslight residency event.");
    } catch {
      const created = await api.createEvent(
        {
          eventId: "gaslight-residency",
          slug: GASLIGHT_SLUG,
          isRecurring: true,
          name: "Gaslight Residency",
          date: new Date().toISOString().slice(0, 10),
          venueName: "Gaslight",
          djBrandName: form.djBrandName || "MAPL",
          seratoLiveUrl: form.seratoLiveUrl || "https://serato.com/playlists/cajun1689me_com/live",
          rekordboxLiveUrl: form.rekordboxLiveUrl,
          livePlaylistSources: [
            {
              id: "serato-a",
              name: "Serato A",
              type: "serato",
              url: form.seratoLiveUrl || "https://serato.com/playlists/cajun1689me_com/live",
              active: true,
            },
            { id: "serato-b", name: "Serato B", type: "serato", url: form.seratoLiveUrl2, active: Boolean(form.seratoLiveUrl2) },
            {
              id: "rekordbox",
              name: "Rekordbox",
              type: "rekordbox",
              url: form.rekordboxLiveUrl,
              active: Boolean(form.rekordboxLiveUrl),
            },
          ],
          primaryColor: form.primaryColor,
          secondaryColor: form.secondaryColor,
          accentColor: form.accentColor,
        },
        session.idToken,
      );
      setEventData(created);
      localStorage.setItem("activeEventId", created.eventId);
      setMessage("Created Gaslight residency event. Reuse this QR every week.");
    } finally {
      setSaving(false);
    }
  }

  async function onLoadBdlResidency() {
    if (!session) {
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const existing = await api.getEventBySlug(BDL_SLUG, session.idToken);
      setEventData(existing);
      localStorage.setItem("activeEventId", existing.eventId);
      setMessage("Loaded BDL residency event.");
    } catch {
      const created = await api.createEvent(
        {
          eventId: "bdl-residency",
          slug: BDL_SLUG,
          isRecurring: true,
          name: "BDL Residency",
          date: new Date().toISOString().slice(0, 10),
          venueName: "BDL",
          djBrandName: form.djBrandName || "Slim Timmy & Friends",
          seratoLiveUrl: form.seratoLiveUrl,
          rekordboxLiveUrl: form.rekordboxLiveUrl,
          livePlaylistSources: [
            {
              id: "serato-a",
              name: "Serato A",
              type: "serato",
              url: form.seratoLiveUrl || "",
              active: Boolean(form.seratoLiveUrl),
            },
            { id: "serato-b", name: "Serato B", type: "serato", url: form.seratoLiveUrl2, active: Boolean(form.seratoLiveUrl2) },
            {
              id: "rekordbox",
              name: "Rekordbox",
              type: "rekordbox",
              url: form.rekordboxLiveUrl,
              active: Boolean(form.rekordboxLiveUrl),
            },
          ],
          primaryColor: form.primaryColor,
          secondaryColor: form.secondaryColor,
          accentColor: form.accentColor,
        },
        session.idToken,
      );
      setEventData(created);
      localStorage.setItem("activeEventId", created.eventId);
      setMessage("Created BDL residency event. Reuse this QR every week.");
    } finally {
      setSaving(false);
    }
  }

  async function onResetWeeklyQueue() {
    if (!session || !eventData) {
      return;
    }
    setSaving(true);
    try {
      const response = await api.resetRequests(eventData.eventId, session.idToken);
      setMessage(`Queue reset complete. Archived ${response.archivedCount} requests (analytics preserved).`);
    } finally {
      setSaving(false);
    }
  }

  const genreState = useMemo(() => normalizeGenreVotes(eventData), [eventData]);
  const genreTickerPreview = useMemo(() => buildGenreTickerItem(eventData), [eventData]);

  async function onAdjustGenreVotes(adjustments: Partial<Record<GenreName, number>>) {
    if (!session || !eventData) return;
    setSaving(true);
    setMessage("");
    try {
      const updated = await api.adminAdjustGenreVotes(eventData.eventId, { adjustments }, session.idToken);
      setEventData(updated);
      setMessage("Genre votes updated.");
    } catch (err) {
      setMessage(`Failed to update votes: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function onResetGenreVotes() {
    if (!session || !eventData) return;
    if (!window.confirm("Reset all genre votes to zero?")) return;
    setSaving(true);
    setMessage("");
    try {
      const updated = await api.resetGenreVotes(eventData.eventId, session.idToken);
      setEventData(updated);
      setMessage("Genre votes reset.");
    } catch (err) {
      setMessage(`Failed to reset votes: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function onLoadEventById(overrideId?: string) {
    const id = overrideId ?? lookupEventId.trim();
    if (!session || !id) {
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const loaded = await api.getEvent(id);
      setEventData(loaded);
      setLookupEventId(id);
      localStorage.setItem("activeEventId", loaded.eventId);
      setMessage("Loaded existing event.");
    } catch (err) {
      setMessage(`Unable to load event: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function onSaveLivePlaylistLinks() {
    if (!session || !eventData) {
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const updated = await api.updateEvent(
        eventData.eventId,
        {
          seratoLiveUrl: seratoLiveUrlEdit || undefined,
          livePlaylistSources: [
            { id: "serato-a", name: "Serato A", djName: seratoDjName || undefined, type: "serato", url: seratoLiveUrlEdit, active: Boolean(seratoLiveUrlEdit) },
            { id: "serato-b", name: "Serato B", djName: serato2DjName || undefined, type: "serato", url: seratoLiveUrl2Edit, active: Boolean(seratoLiveUrl2Edit) },
            { id: "rekordbox", name: "Rekordbox", djName: rekordboxDjName || undefined, type: "rekordbox", url: rekordboxLiveUrlEdit, active: Boolean(rekordboxLiveUrlEdit || rekordboxDjName) },
          ],
          rekordboxLiveUrl: rekordboxLiveUrlEdit || undefined,
        },
        session.idToken,
      );
      setEventData(updated);
      setMessage("Live playlist links & DJ names updated.");
    } catch (err) {
      setMessage(`Failed to update live links: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function onSaveEventDetails() {
    if (!session || !eventData) {
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const updated = await api.updateEvent(
        eventData.eventId,
        {
          name: eventDetails.name,
          date: eventDetails.date,
          venueName: eventDetails.venueName,
          djBrandName: eventDetails.djBrandName,
          seratoLiveUrl: seratoLiveUrlEdit || undefined,
          rekordboxLiveUrl: rekordboxLiveUrlEdit || undefined,
          livePlaylistSources: [
            { id: "serato-a", name: "Serato A", djName: seratoDjName || undefined, type: "serato", url: seratoLiveUrlEdit, active: Boolean(seratoLiveUrlEdit) },
            { id: "serato-b", name: "Serato B", djName: serato2DjName || undefined, type: "serato", url: seratoLiveUrl2Edit, active: Boolean(seratoLiveUrl2Edit) },
            { id: "rekordbox", name: "Rekordbox", djName: rekordboxDjName || undefined, type: "rekordbox", url: rekordboxLiveUrlEdit, active: Boolean(rekordboxLiveUrlEdit || rekordboxDjName) },
          ],
          primaryColor: eventDetails.primaryColor,
          secondaryColor: eventDetails.secondaryColor,
          accentColor: eventDetails.accentColor,
        },
        session.idToken,
      );
      setEventData(updated);
      setMessage("Event details updated.");
    } catch (err) {
      setMessage(`Failed to update event details: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <title>Admin — Casper Requests</title>
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div>
            <h1 className="text-2xl font-bold">Admin</h1>
            <p className="text-sm text-slate-300">Create event branding and guest request QR code.</p>
          </div>
          <div className="flex gap-2">
            {eventData ? (
              <Link className="rounded-md border border-slate-700 px-3 py-1.5 text-sm" to={`/dashboard/${eventData.eventId}`}>
                Dashboard
              </Link>
            ) : null}
            <button className="rounded-md bg-slate-700 px-3 py-1.5 text-sm" onClick={logout}>
              Sign Out
            </button>
          </div>
        </header>
        <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">All Events</h2>
            <button
              type="button"
              onClick={() => void loadAllEvents()}
              disabled={loadingEvents}
              className="rounded-md bg-slate-700 px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
            >
              {loadingEvents ? "Loading…" : "Refresh"}
            </button>
          </div>
          {allEvents.length === 0 && !loadingEvents ? (
            <p className="mt-2 text-sm text-slate-400">No events found.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {allEvents.map((evt) => (
                <div
                  key={evt.eventId}
                  className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-950/50 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {evt.name}
                      {evt.slug ? (
                        <span className="ml-2 rounded bg-emerald-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                          recurring
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-slate-400">
                      {evt.venueName} &middot; {evt.date || "no date"} &middot;{" "}
                      <span className="font-mono text-[10px] text-slate-500">{evt.eventId}</span>
                    </p>
                  </div>
                  <div className="ml-3 flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => void onLoadEventById(evt.eventId)}
                      className="rounded bg-slate-700 px-2.5 py-1 text-xs font-semibold"
                    >
                      Load
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDeleteEvent(evt.eventId, evt.name)}
                      disabled={deletingId === evt.eventId}
                      className="rounded bg-red-500/20 px-2.5 py-1 text-xs font-semibold text-red-300 hover:bg-red-500/30 disabled:opacity-60"
                    >
                      {deletingId === evt.eventId ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-lg font-semibold">Load Existing Event</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              className="w-full max-w-md rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              placeholder="Event ID (e.g. gaslight-residency)"
              value={lookupEventId}
              onChange={(e) => setLookupEventId(e.target.value)}
            />
            <button
              type="button"
              onClick={() => void onLoadEventById()}
              disabled={saving}
              className="rounded-md bg-slate-700 px-3 py-2 text-sm font-semibold disabled:opacity-60"
            >
              Load Event
            </button>
          </div>
        </section>

        <form onSubmit={onCreate} className="space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-lg font-semibold">Create Event</h2>
          <button
            type="button"
            disabled={saving}
            onClick={() => void onLoadGaslightResidency()}
            className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-emerald-950 disabled:opacity-70"
          >
            Use Gaslight Residency (sticky weekly event)
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void onLoadBdlResidency()}
            className="rounded-lg bg-sky-400 px-4 py-2 text-sm font-semibold text-sky-950 disabled:opacity-70"
          >
            Use BDL Residency (sticky weekly event)
          </button>
          <input
            className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
            placeholder="Event Name"
            value={form.name}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            required
          />
          <input
            className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
            type="date"
            value={form.date}
            onChange={(e) => setForm((prev) => ({ ...prev, date: e.target.value }))}
            required
          />
          <input
            className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
            placeholder="Venue Name"
            value={form.venueName}
            onChange={(e) => setForm((prev) => ({ ...prev, venueName: e.target.value }))}
            required
          />
          <input
            className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
            placeholder="DJ Brand Name"
            value={form.djBrandName}
            onChange={(e) => setForm((prev) => ({ ...prev, djBrandName: e.target.value }))}
            required
          />
          <input
            className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
            placeholder="Serato Live URL (optional)"
            value={form.seratoLiveUrl}
            onChange={(e) => setForm((prev) => ({ ...prev, seratoLiveUrl: e.target.value.trim() }))}
          />
          <input
            className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
            placeholder="Rekordbox playlist URL (optional)"
            value={form.rekordboxLiveUrl}
            onChange={(e) => setForm((prev) => ({ ...prev, rekordboxLiveUrl: e.target.value.trim() }))}
          />
          <input
            className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
            placeholder="Serato Live URL #2 (optional)"
            value={form.seratoLiveUrl2}
            onChange={(e) => setForm((prev) => ({ ...prev, seratoLiveUrl2: e.target.value.trim() }))}
          />
          <div className="grid grid-cols-3 gap-2">
            <label className="text-xs">
              Primary
              <input
                className="mt-1 h-10 w-full rounded border border-slate-700 bg-slate-950 px-2"
                type="color"
                value={form.primaryColor}
                onChange={(e) => setForm((prev) => ({ ...prev, primaryColor: e.target.value }))}
              />
            </label>
            <label className="text-xs">
              Secondary
              <input
                className="mt-1 h-10 w-full rounded border border-slate-700 bg-slate-950 px-2"
                type="color"
                value={form.secondaryColor}
                onChange={(e) => setForm((prev) => ({ ...prev, secondaryColor: e.target.value }))}
              />
            </label>
            <label className="text-xs">
              Accent
              <input
                className="mt-1 h-10 w-full rounded border border-slate-700 bg-slate-950 px-2"
                type="color"
                value={form.accentColor}
                onChange={(e) => setForm((prev) => ({ ...prev, accentColor: e.target.value }))}
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-orange-400 px-4 py-2 font-semibold text-orange-950 disabled:opacity-70"
          >
            {saving ? "Saving..." : "Create Event"}
          </button>
        </form>

        {eventData ? (
          <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-4">
            <h2 className="text-lg font-semibold">Brand Assets + QR</h2>
            <p className="text-sm text-slate-300">Event ID: {eventData.eventId}</p>
            {eventData.slug === GASLIGHT_SLUG || eventData.isRecurring ? (
              <p className="text-sm font-semibold text-emerald-300">
                Recurring residency enabled. Keep this same QR each week.
              </p>
            ) : null}
            <p className="text-sm text-sky-300">
              Serato Live: {eventData.seratoLiveUrl ? "configured" : "not set"}
            </p>
            <p className="text-sm text-indigo-300">
              Rekordbox Link: {eventData.rekordboxLiveUrl ? "configured" : "not set"}
            </p>
            <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-950/50 p-3">
              <h3 className="text-sm font-semibold">Playlist Source URLs (2 Serato + 1 Rekordbox)</h3>
              {(eventData.livePlaylistSources ?? []).map((source) => (
                <div key={source.id} className="rounded border border-slate-700 bg-slate-900 p-2">
                  <p className="mb-1 text-xs uppercase text-slate-300">
                    {source.name} ({source.type})
                  </p>
                  <p className="break-all text-xs text-slate-200">{source.url || "not set"}</p>
                </div>
              ))}
            </div>
            <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-950/50 p-3">
              <h3 className="text-sm font-semibold">DJ Bridge Token (Rekordbox &amp; Serato)</h3>
              <p className="text-xs text-slate-400">
                Paste this token into the DJ Bridge Mac app to auto-push now-playing tracks. All DJs at this event share the same token.
              </p>
              {eventData.pushToken ? (
                <div className="flex items-center gap-2">
                  <code className="flex-1 break-all rounded border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-emerald-300">
                    {eventData.pushToken}
                  </code>
                  <button
                    type="button"
                    className="shrink-0 rounded bg-slate-700 px-3 py-1.5 text-xs font-semibold"
                    onClick={() => {
                      void navigator.clipboard.writeText(eventData.pushToken ?? "");
                      setMessage("Push token copied to clipboard.");
                    }}
                  >
                    Copy
                  </button>
                  <button
                    type="button"
                    className="shrink-0 rounded bg-amber-400 px-3 py-1.5 text-xs font-semibold text-amber-950 disabled:opacity-60"
                    disabled={saving}
                    onClick={() => {
                      if (!session) return;
                      setSaving(true);
                      const newToken = crypto.randomUUID();
                      api
                        .updateEvent(eventData.eventId, { pushToken: newToken } as Partial<EventRecord>, session.idToken)
                        .then((updated) => {
                          setEventData(updated);
                          setMessage("Push token rotated. Update all DJ Bridge apps with the new token.");
                        })
                        .catch((err) => setMessage(`Failed: ${(err as Error).message}`))
                        .finally(() => setSaving(false));
                    }}
                  >
                    Rotate
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="rounded bg-emerald-400 px-3 py-1.5 text-xs font-semibold text-emerald-950 disabled:opacity-60"
                  disabled={saving}
                  onClick={() => {
                    if (!session) return;
                    setSaving(true);
                    const newToken = crypto.randomUUID();
                    api
                      .updateEvent(eventData.eventId, { pushToken: newToken } as Partial<EventRecord>, session.idToken)
                      .then((updated) => {
                        setEventData(updated);
                        setMessage("Push token generated.");
                      })
                      .catch((err) => setMessage(`Failed: ${(err as Error).message}`))
                      .finally(() => setSaving(false));
                  }}
                >
                  Generate Token
                </button>
              )}
            </div>
            <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-950/50 p-3">
              <h3 className="text-sm font-semibold">Update Weekly Event Details</h3>
              <input
                className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                placeholder="Event Name"
                value={eventDetails.name}
                onChange={(e) => setEventDetails((prev) => ({ ...prev, name: e.target.value }))}
              />
              <input
                className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                type="date"
                value={eventDetails.date}
                onChange={(e) => setEventDetails((prev) => ({ ...prev, date: e.target.value }))}
              />
              <input
                className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                placeholder="Venue Name"
                value={eventDetails.venueName}
                onChange={(e) => setEventDetails((prev) => ({ ...prev, venueName: e.target.value }))}
              />
              <input
                className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                placeholder="DJ Brand Name"
                value={eventDetails.djBrandName}
                onChange={(e) => setEventDetails((prev) => ({ ...prev, djBrandName: e.target.value }))}
              />
              <div className="grid grid-cols-3 gap-2">
                <label className="text-xs">
                  Primary
                  <input
                    className="mt-1 h-9 w-full rounded border border-slate-700 bg-slate-900 px-2"
                    type="color"
                    value={eventDetails.primaryColor}
                    onChange={(e) => setEventDetails((prev) => ({ ...prev, primaryColor: e.target.value }))}
                  />
                </label>
                <label className="text-xs">
                  Secondary
                  <input
                    className="mt-1 h-9 w-full rounded border border-slate-700 bg-slate-900 px-2"
                    type="color"
                    value={eventDetails.secondaryColor}
                    onChange={(e) => setEventDetails((prev) => ({ ...prev, secondaryColor: e.target.value }))}
                  />
                </label>
                <label className="text-xs">
                  Accent
                  <input
                    className="mt-1 h-9 w-full rounded border border-slate-700 bg-slate-900 px-2"
                    type="color"
                    value={eventDetails.accentColor}
                    onChange={(e) => setEventDetails((prev) => ({ ...prev, accentColor: e.target.value }))}
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={() => void onSaveEventDetails()}
                disabled={saving}
                className="rounded-md bg-emerald-400 px-3 py-1.5 text-sm font-semibold text-emerald-950 disabled:opacity-60"
              >
                Save Event Details
              </button>
            </div>
            <div className="space-y-3 rounded-lg border border-slate-700 bg-slate-950/50 p-3">
              <h3 className="text-sm font-semibold">DJ Sources & Live Links</h3>
              <p className="text-xs text-slate-400">Name each source so you know which DJ/machine auto-matched a request.</p>
              {[
                { label: "Serato A", sourceId: "serato-a", nameSt: seratoDjName, setName: setSeratoDjName, urlSt: seratoLiveUrlEdit, setUrl: setSeratoLiveUrlEdit, namePh: "DJ name (e.g. Slim Timmy)", urlPh: "Serato Live URL" },
                { label: "Serato B", sourceId: "serato-b", nameSt: serato2DjName, setName: setSerato2DjName, urlSt: seratoLiveUrl2Edit, setUrl: setSeratoLiveUrl2Edit, namePh: "DJ name (e.g. Turner02)", urlPh: "Serato Live URL #2" },
                { label: "DJ Bridge (Rekordbox / Serato)", sourceId: "rekordbox", nameSt: rekordboxDjName, setName: setRekordboxDjName, urlSt: rekordboxLiveUrlEdit, setUrl: setRekordboxLiveUrlEdit, namePh: "DJ name", urlPh: "Playlist URL (leave blank for Bridge)" },
              ].map((src) => (
                <div key={src.sourceId} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-medium text-slate-400">{src.label}</label>
                    <button
                      type="button"
                      className="rounded bg-slate-700/60 px-1.5 py-0.5 font-mono text-[10px] text-slate-400 hover:bg-slate-600/60 hover:text-slate-200"
                      title="Click to copy Source ID"
                      onClick={() => {
                        void navigator.clipboard.writeText(src.sourceId);
                        setMessage(`Copied source ID "${src.sourceId}" to clipboard.`);
                      }}
                    >
                      id: {src.sourceId}
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <input
                      className="w-1/3 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                      placeholder={src.namePh}
                      value={src.nameSt}
                      onChange={(e) => src.setName(e.target.value)}
                    />
                    <input
                      className="flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                      placeholder={src.urlPh}
                      value={src.urlSt}
                      onChange={(e) => src.setUrl(e.target.value)}
                    />
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() => void onSaveLivePlaylistLinks()}
                disabled={saving}
                className="rounded-md bg-sky-400 px-3 py-1.5 text-sm font-semibold text-sky-950 disabled:opacity-60"
              >
                Save Sources & Links
              </button>
            </div>
            {/* Auto-Rules Section */}
            <div className="space-y-3 rounded-lg border border-slate-700 bg-slate-950/50 p-3">
              <h3 className="text-sm font-semibold">Auto-Approve / Auto-Veto Rules</h3>
              <label className="block text-xs text-slate-400">
                Auto-Approve (comma-separated songs/artists that always get approved)
                <textarea
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                  rows={2}
                  placeholder="Sweet Caroline, Mr. Brightside, Don't Stop Believin"
                  value={autoApproveInput}
                  onChange={(e) => setAutoApproveInput(e.target.value)}
                />
              </label>
              <label className="block text-xs text-slate-400">
                Blocklist (comma-separated songs/artists that auto-veto)
                <textarea
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                  rows={2}
                  placeholder="Freebird, Baby Shark"
                  value={blockListInput}
                  onChange={(e) => setBlockListInput(e.target.value)}
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={libraryOnlyMode}
                  onChange={(e) => setLibraryOnlyMode(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-600 bg-slate-900"
                />
                Library-only mode (auto-veto anything not in synced library)
              </label>
              <button
                type="button"
                disabled={saving}
                className="rounded-md bg-violet-400 px-3 py-1.5 text-sm font-semibold text-violet-950 disabled:opacity-60"
                onClick={() => {
                  if (!session || !eventData) return;
                  setSaving(true);
                  const autoApproveList = autoApproveInput
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean);
                  const blockList = blockListInput
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean);
                  api
                    .updateEvent(
                      eventData.eventId,
                      { autoApproveList, blockList, libraryOnlyMode } as Partial<EventRecord>,
                      session.idToken,
                    )
                    .then((updated) => {
                      setEventData(updated);
                      setMessage("Auto-rules saved.");
                    })
                    .catch((err) => setMessage(`Failed: ${(err as Error).message}`))
                    .finally(() => setSaving(false));
                }}
              >
                Save Auto-Rules
              </button>
            </div>

            {/* Genre Vote Testing Section */}
            <div className="space-y-3 rounded-lg border border-slate-700 bg-slate-950/50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Genre Vote Testing</h3>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-400">Total:</span>
                  <span
                    className={`rounded px-2 py-0.5 font-mono font-semibold ${
                      genreState.total >= GENRE_VOTE_THRESHOLD
                        ? "bg-emerald-500/20 text-emerald-300"
                        : "bg-slate-700 text-slate-300"
                    }`}
                  >
                    {genreState.total} / {GENRE_VOTE_THRESHOLD}
                  </span>
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                      genreState.total >= GENRE_VOTE_THRESHOLD
                        ? "bg-emerald-500/15 text-emerald-300 border border-emerald-400/40"
                        : "bg-slate-700/40 text-slate-400 border border-slate-600/40"
                    }`}
                  >
                    {genreState.total >= GENRE_VOTE_THRESHOLD ? "On ticker" : "Below threshold"}
                  </span>
                </div>
              </div>
              <p className="text-xs text-slate-400">
                Manually adjust votes to test the threshold-driven ticker scroll. The overlay starts
                showing genre percentages on the ticker once total votes reach{" "}
                <span className="font-mono">{GENRE_VOTE_THRESHOLD}</span>.
              </p>
              <div className="grid gap-2">
                {ALL_GENRES.map((genre) => {
                  const count = genreState.votes[genre] ?? 0;
                  return (
                    <div
                      key={genre}
                      className="flex flex-wrap items-center gap-2 rounded border border-slate-700 bg-slate-900 p-2"
                    >
                      <div className="min-w-[140px] flex-1">
                        <p className="text-sm font-semibold">{GENRE_LABELS[genre]}</p>
                        <p className="font-mono text-xs text-slate-400">{count} vote{count === 1 ? "" : "s"}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={saving || count === 0}
                          onClick={() => void onAdjustGenreVotes({ [genre]: -5 })}
                          className="rounded bg-slate-700 px-2 py-1 text-xs font-mono font-semibold text-slate-200 disabled:opacity-40"
                        >
                          -5
                        </button>
                        <button
                          type="button"
                          disabled={saving || count === 0}
                          onClick={() => void onAdjustGenreVotes({ [genre]: -1 })}
                          className="rounded bg-slate-700 px-2 py-1 text-xs font-mono font-semibold text-slate-200 disabled:opacity-40"
                        >
                          -1
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void onAdjustGenreVotes({ [genre]: 1 })}
                          className="rounded bg-emerald-500/30 px-2 py-1 text-xs font-mono font-semibold text-emerald-200 disabled:opacity-40"
                        >
                          +1
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void onAdjustGenreVotes({ [genre]: 5 })}
                          className="rounded bg-emerald-500/40 px-2 py-1 text-xs font-mono font-semibold text-emerald-100 disabled:opacity-40"
                        >
                          +5
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void onAdjustGenreVotes({ [genre]: 10 })}
                          className="rounded bg-emerald-500/60 px-2 py-1 text-xs font-mono font-semibold text-emerald-50 disabled:opacity-40"
                        >
                          +10
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {genreTickerPreview ? (
                <div className="rounded border border-emerald-500/40 bg-emerald-500/10 p-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
                    Ticker preview (live on overlay)
                  </p>
                  <p className="mt-1 break-words text-xs font-mono text-emerald-100">{genreTickerPreview}</p>
                </div>
              ) : (
                <p className="rounded border border-slate-700 bg-slate-900 p-2 text-xs text-slate-400">
                  Not yet on the ticker — add{" "}
                  <span className="font-mono">{GENRE_VOTE_THRESHOLD - genreState.total}</span> more
                  vote{GENRE_VOTE_THRESHOLD - genreState.total === 1 ? "" : "s"} to push it over the
                  threshold.
                </p>
              )}
              <button
                type="button"
                disabled={saving || genreState.total === 0}
                onClick={() => void onResetGenreVotes()}
                className="rounded-md bg-rose-500/30 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/40 disabled:opacity-40"
              >
                Reset all to 0
              </button>
            </div>

            <button
              type="button"
              onClick={() => void onResetWeeklyQueue()}
              disabled={saving}
              className="rounded-md bg-amber-400 px-3 py-1.5 text-sm font-semibold text-amber-950 disabled:opacity-60"
            >
              Reset Weekly Queue (keep same link/QR)
            </button>
            <div className="flex flex-wrap items-start gap-4">
              <div className="space-y-2">
                <label className="block text-sm text-slate-300">DJ Logo</label>
                <input type="file" accept="image/*" onChange={(e) => setDjLogoFile(e.target.files?.[0] ?? null)} />
                {djLogoFile ? <p className="text-xs text-slate-300">Selected: {djLogoFile.name}</p> : null}
                <button
                  type="button"
                  onClick={() => void onUploadLogo("dj")}
                  disabled={uploadingLogoType === "dj"}
                  className="cursor-pointer rounded-md bg-sky-400 px-3 py-1.5 text-sm font-semibold text-sky-950 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {uploadingLogoType === "dj" ? "Uploading DJ Logo..." : "Upload DJ Logo"}
                </button>
                <label className="mt-2 block text-sm text-slate-300">Venue Logo</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setVenueLogoFile(e.target.files?.[0] ?? null)}
                />
                {venueLogoFile ? <p className="text-xs text-slate-300">Selected: {venueLogoFile.name}</p> : null}
                <button
                  type="button"
                  onClick={() => void onUploadLogo("venue")}
                  disabled={uploadingLogoType === "venue"}
                  className="cursor-pointer rounded-md bg-indigo-400 px-3 py-1.5 text-sm font-semibold text-indigo-950 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {uploadingLogoType === "venue" ? "Uploading Venue Logo..." : "Upload Venue Logo"}
                </button>
              </div>
              {requestUrl ? <QRGenerator value={requestUrl} /> : null}
            </div>
          </section>
        ) : null}

        {message ? <p className="text-sm text-slate-200">{message}</p> : null}
      </div>
    </div>
  );
}
