import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { QRGenerator } from "../components/QRGenerator";
import { useAuth } from "../context/AuthContext";
import { api } from "../services/api";
import type { EventRecord } from "../types";

const GASLIGHT_SLUG = "gaslight-residency";

const emptyForm = {
  name: "",
  date: "",
  venueName: "",
  djBrandName: "",
  seratoLiveUrl: "",
  rekordboxLiveUrl: "",
  venmoHandle: "",
  primaryColor: "#0f172a",
  secondaryColor: "#1e293b",
  accentColor: "#f97316",
};

export function AdminPage() {
  const { session, logout } = useAuth();
  const [form, setForm] = useState(emptyForm);
  const [eventData, setEventData] = useState<EventRecord | null>(null);
  const [djLogoFile, setDjLogoFile] = useState<File | null>(null);
  const [venueLogoFile, setVenueLogoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [lookupEventId, setLookupEventId] = useState<string>(localStorage.getItem("activeEventId") ?? "");
  const [seratoLiveUrlEdit, setSeratoLiveUrlEdit] = useState<string>("");
  const [rekordboxLiveUrlEdit, setRekordboxLiveUrlEdit] = useState<string>("");

  const requestUrl = useMemo(() => {
    if (!eventData) {
      return "";
    }
    return `${window.location.origin}/event/${eventData.eventId}`;
  }, [eventData]);

  useEffect(() => {
    setSeratoLiveUrlEdit(eventData?.seratoLiveUrl ?? "");
    setRekordboxLiveUrlEdit(eventData?.rekordboxLiveUrl ?? "");
  }, [eventData]);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (!session) {
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      const created = await api.createEvent(form, session.idToken);
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
      return;
    }
    setSaving(true);
    try {
      const logoUrl = await api.uploadBrandAsset(eventData.eventId, file, session.idToken);
      const updated = await api.updateEvent(
        eventData.eventId,
        type === "dj" ? { djLogoUrl: logoUrl } : { venueLogoUrl: logoUrl },
        session.idToken,
      );
      setEventData(updated);
      setMessage(`${type === "dj" ? "DJ" : "Venue"} logo uploaded.`);
    } finally {
      setSaving(false);
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
          venmoHandle: form.venmoHandle,
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

  async function onResetWeeklyQueue() {
    if (!session || !eventData) {
      return;
    }
    setSaving(true);
    try {
      const response = await api.resetRequests(eventData.eventId, session.idToken);
      setMessage(`Queue reset complete. Deleted ${response.deletedCount} requests.`);
    } finally {
      setSaving(false);
    }
  }

  async function onLoadEventById() {
    if (!session || !lookupEventId.trim()) {
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const loaded = await api.getEvent(lookupEventId.trim());
      setEventData(loaded);
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
          rekordboxLiveUrl: rekordboxLiveUrlEdit || undefined,
        },
        session.idToken,
      );
      setEventData(updated);
      setMessage("Live playlist links updated.");
    } catch (err) {
      setMessage(`Failed to update live links: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 p-6 text-slate-100">
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
            placeholder="Venmo Handle (without @)"
            value={form.venmoHandle}
            onChange={(e) =>
              setForm((prev) => ({
                ...prev,
                venmoHandle: e.target.value.replace("@", "").trim(),
              }))
            }
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
            <p className="text-sm text-emerald-300">
              Venmo: {eventData.venmoHandle ? `@${eventData.venmoHandle}` : "not set"}
            </p>
            <p className="text-sm text-sky-300">
              Serato Live: {eventData.seratoLiveUrl ? "configured" : "not set"}
            </p>
            <p className="text-sm text-indigo-300">
              Rekordbox Link: {eventData.rekordboxLiveUrl ? "configured" : "not set"}
            </p>
            <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-950/50 p-3">
              <h3 className="text-sm font-semibold">Update Live Playlist Links (post-creation)</h3>
              <input
                className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                placeholder="Serato Live URL"
                value={seratoLiveUrlEdit}
                onChange={(e) => setSeratoLiveUrlEdit(e.target.value)}
              />
              <input
                className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                placeholder="Rekordbox playlist URL"
                value={rekordboxLiveUrlEdit}
                onChange={(e) => setRekordboxLiveUrlEdit(e.target.value)}
              />
              <button
                type="button"
                onClick={() => void onSaveLivePlaylistLinks()}
                disabled={saving}
                className="rounded-md bg-sky-400 px-3 py-1.5 text-sm font-semibold text-sky-950 disabled:opacity-60"
              >
                Save Live Links
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
                <button
                  onClick={() => void onUploadLogo("dj")}
                  disabled={!djLogoFile || saving}
                  className="rounded-md bg-sky-400 px-3 py-1.5 text-sm font-semibold text-sky-950 disabled:opacity-60"
                >
                  Upload DJ Logo
                </button>
                <label className="mt-2 block text-sm text-slate-300">Venue Logo</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setVenueLogoFile(e.target.files?.[0] ?? null)}
                />
                <button
                  onClick={() => void onUploadLogo("venue")}
                  disabled={!venueLogoFile || saving}
                  className="rounded-md bg-indigo-400 px-3 py-1.5 text-sm font-semibold text-indigo-950 disabled:opacity-60"
                >
                  Upload Venue Logo
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
