import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { QRGenerator } from "../components/QRGenerator";
import { useAuth } from "../context/AuthContext";
import { api } from "../services/api";
import type { EventRecord, LivePlaylistSource } from "../types";

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
  venmoHandle: "",
  primaryColor: "#0f172a",
  secondaryColor: "#1e293b",
  accentColor: "#f97316",
};

const emptyEventDetails = {
  name: "",
  date: "",
  venueName: "",
  djBrandName: "",
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
  const [uploadingLogoType, setUploadingLogoType] = useState<"dj" | "venue" | null>(null);
  const [message, setMessage] = useState<string>("");
  const [eventDetails, setEventDetails] = useState(emptyEventDetails);
  const [lookupEventId, setLookupEventId] = useState<string>(localStorage.getItem("activeEventId") ?? "");
  const [seratoLiveUrlEdit, setSeratoLiveUrlEdit] = useState<string>("");
  const [seratoLiveUrl2Edit, setSeratoLiveUrl2Edit] = useState<string>("");
  const [rekordboxLiveUrlEdit, setRekordboxLiveUrlEdit] = useState<string>("");

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
        venmoHandle: eventData.venmoHandle ?? "",
        primaryColor: eventData.primaryColor ?? "#0f172a",
        secondaryColor: eventData.secondaryColor ?? "#1e293b",
        accentColor: eventData.accentColor ?? "#f97316",
      });
    } else {
      setEventDetails(emptyEventDetails);
    }

    const sources =
      eventData?.livePlaylistSources?.length
        ? eventData.livePlaylistSources
        : defaultLiveSources(eventData?.seratoLiveUrl ?? "", eventData?.rekordboxLiveUrl ?? "");
    setSeratoLiveUrlEdit(sources.find((source) => source.id === "serato-a")?.url ?? "");
    setSeratoLiveUrl2Edit(sources.find((source) => source.id === "serato-b")?.url ?? "");
    setRekordboxLiveUrlEdit(sources.find((source) => source.id === "rekordbox")?.url ?? "");
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
          venmoHandle: form.venmoHandle,
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
          livePlaylistSources: [
            { id: "serato-a", name: "Serato A", type: "serato", url: seratoLiveUrlEdit, active: Boolean(seratoLiveUrlEdit) },
            { id: "serato-b", name: "Serato B", type: "serato", url: seratoLiveUrl2Edit, active: Boolean(seratoLiveUrl2Edit) },
            { id: "rekordbox", name: "Rekordbox", type: "rekordbox", url: rekordboxLiveUrlEdit, active: Boolean(rekordboxLiveUrlEdit) },
          ],
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
            { id: "serato-a", name: "Serato A", type: "serato", url: seratoLiveUrlEdit, active: Boolean(seratoLiveUrlEdit) },
            { id: "serato-b", name: "Serato B", type: "serato", url: seratoLiveUrl2Edit, active: Boolean(seratoLiveUrl2Edit) },
            { id: "rekordbox", name: "Rekordbox", type: "rekordbox", url: rekordboxLiveUrlEdit, active: Boolean(rekordboxLiveUrlEdit) },
          ],
          venmoHandle: eventDetails.venmoHandle.replace("@", "").trim(),
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
              <h3 className="text-sm font-semibold">Rekordbox Bridge Token</h3>
              <p className="text-xs text-slate-400">
                Paste this token into the Rekordbox Bridge Mac app to auto-push now-playing tracks.
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
                          setMessage("Push token rotated. Update the bridge app with the new token.");
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
              <input
                className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                placeholder="Venmo Handle (without @)"
                value={eventDetails.venmoHandle}
                onChange={(e) =>
                  setEventDetails((prev) => ({
                    ...prev,
                    venmoHandle: e.target.value.replace("@", ""),
                  }))
                }
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
              <input
                className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                placeholder="Serato Live URL #2"
                value={seratoLiveUrl2Edit}
                onChange={(e) => setSeratoLiveUrl2Edit(e.target.value)}
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
