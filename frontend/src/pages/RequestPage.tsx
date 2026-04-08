import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useParams } from "react-router-dom";
import { BrandedLayout } from "../components/BrandedLayout";
import { api } from "../services/api";
import type { EventRecord, GenreName, RequestRecord } from "../types";
import { GENRE_LABELS, GENRE_VOTE_THRESHOLD, normalizeGenreVotes } from "../utils/genreVotes";

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
  const [submitting, setSubmitting] = useState(false);
  const [voteBusy, setVoteBusy] = useState(false);
  const [trackedRequest, setTrackedRequest] = useState<RequestRecord | null>(null);
  const [songsAway, setSongsAway] = useState<number | null>(null);
  const [votedGenre, setVotedGenre] = useState<GenreName | null>(null);
  const handlingPaypalReturnRef = useRef(false);

  function buildVenmoParams() {
    if (!eventData?.venmoHandle) {
      return null;
    }

    const params = new URLSearchParams({
      txn: "pay",
      recipients: eventData.venmoHandle,
    });
    if (tipAmount) {
      params.set("amount", tipAmount);
    }
    if (songTitle) {
      params.set("note", `Song request: ${songTitle}`);
    }
    return params;
  }

  async function createGuestRequest(preferPendingVerification: boolean) {
    if (!eventId || !eventData) {
      throw new Error("Event is still loading. Please try again.");
    }
    const created = await api.createRequest(eventId, {
      songTitle,
      artistName,
      requesterName,
      message,
      tipAmount: tipAmount ? Number(tipAmount) : undefined,
      venmoHandle: eventData.venmoHandle,
      paymentReference: paymentReference || undefined,
      paymentStatus:
        tipAmount && (preferPendingVerification || confirmPaid) ? "pending_verification" : "unpaid",
    });

    localStorage.setItem(trackedRequestKey, created.requestId);
    setTrackedRequest(created);
    setSongsAway(null);
    localStorage.setItem(lockKey, String(Date.now() + 2 * 60 * 1000));
    return created;
  }

  async function openVenmo() {
    const params = buildVenmoParams();
    if (!params) {
      return;
    }

    if (!eventId || !eventData) {
      setFeedback("Event is still loading. Please try again.");
      return;
    }
    if (!songTitle.trim() || !artistName.trim()) {
      setFeedback("Enter song title and artist before opening Venmo.");
      return;
    }

    const lockedUntil = Number(localStorage.getItem(lockKey) ?? "0");
    if (Date.now() >= lockedUntil) {
      setSubmitting(true);
      try {
        await createGuestRequest(true);
        setFeedback("Request saved. Complete Venmo payment, then return to this page.");
      } catch (err) {
        setFeedback(`Could not save request before opening Venmo: ${(err as Error).message}`);
        setSubmitting(false);
        return;
      } finally {
        setSubmitting(false);
      }
    }

    const appUrl = `venmo://paycharge?${params.toString()}`;
    const webUrl = `https://account.venmo.com/pay?${params.toString()}`;
    const fallbackTimer = window.setTimeout(() => {
      window.location.href = webUrl;
    }, 900);

    const cancelFallback = () => {
      window.clearTimeout(fallbackTimer);
      document.removeEventListener("visibilitychange", cancelFallback);
      window.removeEventListener("pagehide", cancelFallback);
    };

    document.addEventListener("visibilitychange", cancelFallback);
    window.addEventListener("pagehide", cancelFallback);
    window.location.href = appUrl;
  }

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

  const lockKey = useMemo(() => `request-lock-${eventId}`, [eventId]);
  const trackedRequestKey = useMemo(() => `guest-request-${eventId}`, [eventId]);
  const voteKey = useMemo(() => `genre-vote-${eventId}`, [eventId]);

  useEffect(() => {
    const existingVote = localStorage.getItem(voteKey);
    if (!existingVote) {
      setVotedGenre(null);
      return;
    }
    if (existingVote === "hip_hop" || existingVote === "country" || existingVote === "edm") {
      setVotedGenre(existingVote);
      return;
    }
    setVotedGenre(null);
  }, [voteKey]);

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

  useEffect(() => {
    if (!eventId || handlingPaypalReturnRef.current) {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const paypalState = params.get("paypal");
    const orderId = params.get("token");
    const requestId = params.get("requestId");
    if (!paypalState) {
      return;
    }

    handlingPaypalReturnRef.current = true;
    const clearQuery = () => {
      const cleanUrl = `${window.location.origin}/event/${eventId}`;
      window.history.replaceState(null, "", cleanUrl);
    };

    if (paypalState === "cancel") {
      setFeedback("Payment canceled. Your request is still in queue and can be paid later.");
      clearQuery();
      return;
    }
    if (paypalState !== "return" || !orderId || !requestId) {
      setFeedback("Could not verify payment return details. Please try again.");
      clearQuery();
      return;
    }

    void (async () => {
      try {
        const result = await api.capturePaypalOrder(eventId, requestId, orderId);
        if (result.request) {
          setTrackedRequest(result.request);
        }
        setFeedback("Payment received and auto-verified. DJs will see this as paid.");
      } catch (err) {
        setFeedback(`Payment return detected, but verification failed: ${(err as Error).message}`);
      } finally {
        clearQuery();
      }
    })();
  }, [eventId]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!eventId || !eventData) {
      return;
    }
    const lockedUntil = Number(localStorage.getItem(lockKey) ?? "0");
    if (Date.now() < lockedUntil) {
      if (
        trackedRequest &&
        trackedRequest.songTitle.trim().toLowerCase() === songTitle.trim().toLowerCase() &&
        trackedRequest.artistName.trim().toLowerCase() === artistName.trim().toLowerCase()
      ) {
        setFeedback("This request is already submitted and waiting for DJ review.");
      } else {
        setFeedback("Please wait before sending another request.");
      }
      return;
    }

    setSubmitting(true);
    try {
      await createGuestRequest(false);
      setSongTitle("");
      setArtistName("");
      setRequesterName("");
      setMessage("");
      setTipAmount("");
      setPaymentReference("");
      setConfirmPaid(false);
      setFeedback("Request submitted. The DJs will review it shortly.");
    } catch (err) {
      setFeedback(`Request failed: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function onVoteGenre(genre: GenreName) {
    if (!eventId || voteBusy || votedGenre) {
      return;
    }
    setVoteBusy(true);
    try {
      const updatedEvent = await api.submitGenreVote(eventId, genre);
      setEventData(updatedEvent);
      setVotedGenre(genre);
      localStorage.setItem(voteKey, genre);
    } catch (err) {
      setFeedback(`Vote failed: ${(err as Error).message}`);
    } finally {
      setVoteBusy(false);
    }
  }

  if (!eventData) {
    return <div className="p-6 text-slate-200">Loading event...</div>;
  }

  const { votes: genreVotes, total: genreVoteTotal } = normalizeGenreVotes(eventData);

  return (
    <BrandedLayout event={eventData} title="Request a Song" subtitle="Your request goes to the DJ team for approval">
      <section className="mt-3 rounded-2xl border border-white/20 bg-black/30 p-5">
        <h2 className="text-lg font-semibold">Vote on Tonight&apos;s Style</h2>
        <p className="mt-1 text-sm text-slate-300">
          Help guide the vibe. Results appear on the ticker after {GENRE_VOTE_THRESHOLD} votes.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(["hip_hop", "country", "edm"] as GenreName[]).map((genre) => (
            <button
              key={genre}
              type="button"
              disabled={voteBusy || Boolean(votedGenre)}
              onClick={() => void onVoteGenre(genre)}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
                votedGenre === genre
                  ? "bg-emerald-400 text-emerald-950"
                  : "bg-slate-800 text-slate-100 disabled:opacity-60"
              }`}
            >
              {GENRE_LABELS[genre]}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-300">
          {votedGenre ? `Thanks for voting: ${GENRE_LABELS[votedGenre]}.` : "You can vote once per device for this event."}
        </p>
        <p className="mt-2 text-xs text-slate-300">
          Votes: {genreVoteTotal} | Hip Hop {genreVoteTotal ? Math.round((genreVotes.hip_hop / genreVoteTotal) * 100) : 0}% |
          Country {genreVoteTotal ? Math.round((genreVotes.country / genreVoteTotal) * 100) : 0}% | EDM{" "}
          {genreVoteTotal ? Math.round((genreVotes.edm / genreVoteTotal) * 100) : 0}%
        </p>
      </section>
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
              <button
                type="button"
                className="inline-flex rounded-md bg-emerald-400 px-3 py-1.5 text-xs font-semibold text-emerald-950"
                onClick={() => void openVenmo()}
                disabled={submitting}
              >
                Open Venmo App (saves request first)
              </button>
            </div>
            <div className="mt-2">
              <button
                type="button"
                className="inline-flex rounded-md bg-indigo-400 px-3 py-1.5 text-xs font-semibold text-indigo-950 disabled:opacity-60"
                disabled={submitting || !tipAmount || Number(tipAmount) <= 0}
                onClick={() => {
                  void (async () => {
                    if (!eventId || !eventData) {
                      setFeedback("Event is still loading. Please try again.");
                      return;
                    }
                    if (!songTitle.trim() || !artistName.trim()) {
                      setFeedback("Enter song title and artist before checkout.");
                      return;
                    }
                    if (!tipAmount || Number(tipAmount) <= 0) {
                      setFeedback("Enter a tip amount before checkout.");
                      return;
                    }
                    const lockedUntil = Number(localStorage.getItem(lockKey) ?? "0");
                    if (Date.now() < lockedUntil) {
                      setFeedback("Please wait before sending another request.");
                      return;
                    }

                    setSubmitting(true);
                    try {
                      const created = await createGuestRequest(true);
                      const order = await api.createPaypalOrder(
                        eventId,
                        created.requestId,
                        Number(tipAmount),
                      );
                      if (order.alreadyPaid) {
                        setFeedback("This request is already marked paid.");
                        setSubmitting(false);
                        return;
                      }
                      if (!order.approveUrl) {
                        throw new Error("Could not start checkout session.");
                      }
                      window.location.href = order.approveUrl;
                    } catch (err) {
                      setFeedback(`Checkout failed: ${(err as Error).message}`);
                      setSubmitting(false);
                    }
                  })();
                }}
              >
                Pay with Venmo (auto-verify)
              </button>
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
          disabled={submitting}
          className="w-full rounded-lg px-4 py-2 font-semibold text-slate-900"
          style={{ backgroundColor: eventData.accentColor }}
        >
          {submitting ? "Sending..." : "Send Request"}
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
          <h2 className="text-lg font-semibold">Now Playing</h2>
          <div className="mt-2 grid gap-2 md:grid-cols-3">
            {eventData.nowPlayingSlots
              .filter((slot) => slot.active && slot.songTitle)
              .map((slot) => (
                <div key={slot.id} className="rounded-lg border border-slate-700 bg-slate-950/40 p-3">
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
