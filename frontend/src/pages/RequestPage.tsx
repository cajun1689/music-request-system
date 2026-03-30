import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useParams } from "react-router-dom";
import { BrandedLayout } from "../components/BrandedLayout";
import { api } from "../services/api";
import type { EventRecord, RequestRecord } from "../types";

export function RequestPage() {
  const { eventId } = useParams();
  const [eventData, setEventData] = useState<EventRecord | null>(null);
  const [songTitle, setSongTitle] = useState("");
  const [artistName, setArtistName] = useState("");
  const [requesterName, setRequesterName] = useState("");
  const [message, setMessage] = useState("");
  const [tipAmount, setTipAmount] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [confirmPaid, setConfirmPaid] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [trackedRequest, setTrackedRequest] = useState<RequestRecord | null>(null);
  const [songsAway, setSongsAway] = useState<number | null>(null);

  useEffect(() => {
    if (!eventId) {
      return;
    }
    void api.getEvent(eventId).then(setEventData);
  }, [eventId]);

  const lockKey = useMemo(() => `request-lock-${eventId}`, [eventId]);
  const trackedRequestKey = useMemo(() => `guest-request-${eventId}`, [eventId]);

  useEffect(() => {
    if (!eventId) {
      return;
    }
    const trackedId = localStorage.getItem(trackedRequestKey);
    if (!trackedId) {
      return;
    }

    const refreshStatus = async () => {
      const all = await api.getRequests(eventId);
      const mine = all.find((item) => item.requestId === trackedId) ?? null;
      setTrackedRequest(mine);
      if (!mine || mine.status !== "approved") {
        setSongsAway(null);
        return;
      }
      const approved = all
        .filter((item) => item.status === "approved")
        .sort((a, b) => Number(a.position ?? Number.MAX_SAFE_INTEGER) - Number(b.position ?? Number.MAX_SAFE_INTEGER));
      const idx = approved.findIndex((item) => item.requestId === trackedId);
      setSongsAway(idx >= 0 ? idx + 1 : null);
    };

    void refreshStatus();
    const interval = window.setInterval(() => void refreshStatus(), 7000);
    return () => window.clearInterval(interval);
  }, [eventId, trackedRequestKey]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!eventId || !eventData) {
      return;
    }
    const lockedUntil = Number(localStorage.getItem(lockKey) ?? "0");
    if (Date.now() < lockedUntil) {
      setFeedback("Please wait before sending another request.");
      return;
    }

    const created = await api.createRequest(eventId, {
      songTitle,
      artistName,
      requesterName,
      message,
      tipAmount: tipAmount ? Number(tipAmount) : undefined,
      venmoHandle: eventData.venmoHandle,
      paymentReference: paymentReference || undefined,
      paymentStatus: tipAmount ? (confirmPaid ? "pending_verification" : "unpaid") : "unpaid",
    });
    localStorage.setItem(trackedRequestKey, created.requestId);
    setTrackedRequest(created);
    setSongsAway(null);
    localStorage.setItem(lockKey, String(Date.now() + 2 * 60 * 1000));
    setSongTitle("");
    setArtistName("");
    setRequesterName("");
    setMessage("");
    setTipAmount("");
    setPaymentReference("");
    setConfirmPaid(false);
    setFeedback("Request submitted. The DJs will review it shortly.");
  }

  if (!eventData) {
    return <div className="p-6 text-slate-200">Loading event...</div>;
  }

  return (
    <BrandedLayout event={eventData} title="Request a Song" subtitle="Your request goes to the DJ team for approval">
      <form onSubmit={onSubmit} className="space-y-3 rounded-2xl border border-white/20 bg-black/30 p-5">
        <label className="block text-sm">
          Song Title
          <input
            className="mt-1 w-full rounded-md border border-white/25 bg-slate-950/50 px-3 py-2"
            value={songTitle}
            onChange={(e) => setSongTitle(e.target.value)}
            required
          />
        </label>
        <label className="block text-sm">
          Artist
          <input
            className="mt-1 w-full rounded-md border border-white/25 bg-slate-950/50 px-3 py-2"
            value={artistName}
            onChange={(e) => setArtistName(e.target.value)}
            required
          />
        </label>
        <label className="block text-sm">
          Your Name (optional)
          <input
            className="mt-1 w-full rounded-md border border-white/25 bg-slate-950/50 px-3 py-2"
            value={requesterName}
            onChange={(e) => setRequesterName(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          Message (optional)
          <textarea
            className="mt-1 w-full rounded-md border border-white/25 bg-slate-950/50 px-3 py-2"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
          />
        </label>
        {eventData.venmoHandle ? (
          <div className="rounded-lg border border-emerald-400/40 bg-emerald-900/20 p-3">
            <p className="text-sm font-semibold text-emerald-300">Tip to prioritize your request (optional)</p>
            <p className="mt-1 text-xs text-emerald-100/90">
              Send a Venmo tip to @{eventData.venmoHandle}. DJs can verify paid requests in their queue.
            </p>
            <label className="mt-2 block text-sm">
              Tip amount (USD)
              <input
                className="mt-1 w-full rounded-md border border-white/25 bg-slate-950/50 px-3 py-2"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={tipAmount}
                onChange={(e) => setTipAmount(e.target.value)}
              />
            </label>
            <div className="mt-2">
              <a
                className="inline-flex rounded-md bg-emerald-400 px-3 py-1.5 text-xs font-semibold text-emerald-950"
                href={`https://account.venmo.com/pay?txn=pay&recipients=${encodeURIComponent(
                  eventData.venmoHandle,
                )}${tipAmount ? `&amount=${encodeURIComponent(tipAmount)}` : ""}${
                  songTitle ? `&note=${encodeURIComponent(`Song request: ${songTitle}`)}` : ""
                }`}
                target="_blank"
                rel="noreferrer"
              >
                Open Venmo
              </a>
            </div>
            <label className="mt-3 block text-sm">
              Venmo payment reference (optional)
              <input
                className="mt-1 w-full rounded-md border border-white/25 bg-slate-950/50 px-3 py-2"
                placeholder="Last 4 chars, note, or @username"
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
              />
            </label>
            <label className="mt-2 flex items-center gap-2 text-xs text-emerald-100/90">
              <input
                type="checkbox"
                checked={confirmPaid}
                onChange={(e) => setConfirmPaid(e.target.checked)}
                disabled={!tipAmount}
              />
              I sent this payment already
            </label>
          </div>
        ) : null}
        <button
          type="submit"
          className="w-full rounded-lg px-4 py-2 font-semibold text-slate-900"
          style={{ backgroundColor: eventData.accentColor }}
        >
          Send Request
        </button>
        {feedback ? <p className="text-sm text-slate-200">{feedback}</p> : null}
      </form>
      {trackedRequest ? (
        <section className="mt-3 rounded-2xl border border-white/20 bg-black/30 p-5">
          <h2 className="text-lg font-semibold">Your Latest Request Status</h2>
          <p className="mt-1 text-sm text-slate-200">
            {trackedRequest.songTitle} - {trackedRequest.artistName}
          </p>
          {trackedRequest.status === "pending" ? (
            <p className="mt-2 text-sm text-amber-300">Pending DJ approval.</p>
          ) : null}
          {trackedRequest.status === "approved" ? (
            <p className="mt-2 text-sm text-emerald-300">
              Approved. You are about {songsAway ?? "?"} song{songsAway === 1 ? "" : "s"} away.
            </p>
          ) : null}
          {trackedRequest.status === "played" ? (
            <p className="mt-2 text-sm text-sky-300">Played. Thanks for the request!</p>
          ) : null}
          {trackedRequest.status === "vetoed" ? (
            <p className="mt-2 text-sm text-rose-300">Not accepted this round. Try another track.</p>
          ) : null}
          {trackedRequest.paymentStatus === "verified" ? (
            <p className="mt-2 text-xs text-emerald-300">Tip verified by DJ team.</p>
          ) : trackedRequest.paymentStatus === "pending_verification" ? (
            <p className="mt-2 text-xs text-amber-300">Tip submitted and pending verification.</p>
          ) : null}
        </section>
      ) : null}
      {eventData.seratoLiveUrl ? (
        <p className="mt-3 text-center text-xs text-slate-300/90">
          Live crate link:{" "}
          <a className="text-sky-300 underline" href={eventData.seratoLiveUrl} target="_blank" rel="noreferrer">
            open Serato Live
          </a>
        </p>
      ) : null}
      {eventData.rekordboxLiveUrl ? (
        <p className="mt-1 text-center text-xs text-slate-300/90">
          Rekordbox playlist:{" "}
          <a className="text-indigo-300 underline" href={eventData.rekordboxLiveUrl} target="_blank" rel="noreferrer">
            open link
          </a>
        </p>
      ) : null}
      {eventData.nowPlayingSlots?.some((slot) => slot.active && slot.songTitle) ? (
        <section className="mt-3 rounded-2xl border border-white/20 bg-black/30 p-5">
          <h2 className="text-lg font-semibold">Now Playing Across DJs</h2>
          <div className="mt-2 grid gap-2 md:grid-cols-3">
            {eventData.nowPlayingSlots
              .filter((slot) => slot.active && slot.songTitle)
              .map((slot) => (
                <div key={slot.id} className="rounded-lg border border-slate-700 bg-slate-950/40 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-300">{slot.djName}</p>
                  <p className="mt-1 text-sm font-semibold">{slot.songTitle}</p>
                  <p className="text-xs text-slate-300">{slot.artistName || "Unknown artist"}</p>
                </div>
              ))}
          </div>
        </section>
      ) : null}
    </BrandedLayout>
  );
}
