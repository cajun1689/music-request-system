import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { BrandedLayout } from "../components/BrandedLayout";
import { useWebSocket } from "../hooks/useWebSocket";
import { api } from "../services/api";
import type { EventRecord, GenreName, RequestRecord } from "../types";
import { toDisplayTitleCase } from "../utils/formatting";
import { GENRE_LABELS, GENRE_VOTE_THRESHOLD, getAvailableGenres, normalizeGenreVotes } from "../utils/genreVotes";
import { comparePriority } from "../utils/priority";

const STRIPE_ENABLED = import.meta.env.VITE_STRIPE_ENABLED === "true";

interface LibraryTrack {
  title: string;
  artist: string;
  titleNorm: string;
  artistNorm: string;
  playCount: number;
}

function computeEnergy(requests: RequestRecord[]): number {
  const now = Date.now();
  const tenMinAgo = now - 10 * 60 * 1000;
  const recent = requests.filter((r) => new Date(r.submittedAt).getTime() > tenMinAgo);
  const velocity = Math.min(recent.length / 20, 1);
  const tipVolume = requests.reduce(
    (sum, r) => sum + (r.paymentStatus === "verified" ? (r.tipAmount ?? 0) : 0),
    0,
  );
  const tipScore = Math.min(tipVolume / 50, 1);
  const upvoteScore = Math.min(
    requests.reduce((sum, r) => sum + (r.upvotes ?? 0), 0) / 30,
    1,
  );
  return Math.round(((velocity * 0.5 + tipScore * 0.25 + upvoteScore * 0.25) * 100));
}

export function RequestPage() {
  const { eventId } = useParams();
  const [eventData, setEventData] = useState<EventRecord | null>(null);
  const [songTitle, setSongTitle] = useState("");
  const [artistName, setArtistName] = useState("");
  const [requesterName, setRequesterName] = useState("");
  const [message, setMessage] = useState("");
  const [shoutout, setShoutout] = useState("");
  const [shoutoutName, setShoutoutName] = useState("");
  const [shoutoutSubmitting, setShoutoutSubmitting] = useState(false);
  const [shoutoutFeedback, setShoutoutFeedback] = useState<string | null>(null);
  const [tipAmount, setTipAmount] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resumingStripe, setResumingStripe] = useState(false);
  const [voteBusy, setVoteBusy] = useState(false);
  const [trackedRequest, setTrackedRequest] = useState<RequestRecord | null>(null);
  const [songsAway, setSongsAway] = useState<number | null>(null);
  const [votedGenre, setVotedGenre] = useState<GenreName | null>(null);
  const [requestGenre, setRequestGenre] = useState<GenreName | "">("");
  const [liveQueue, setLiveQueue] = useState<RequestRecord[]>([]);
  const [allRequests, setAllRequests] = useState<RequestRecord[]>([]);
  const [libraryTracks, setLibraryTracks] = useState<LibraryTrack[] | null>(null);
  const handlingPaypalReturnRef = useRef(false);
  async function createGuestRequest(pendingPayment = false) {
    if (!eventId || !eventData) {
      throw new Error("Event is still loading. Please try again.");
    }
    const includeTip = Boolean(tipAmount) && (pendingPayment || eventData.accountMode !== "saas");
    const created = await api.createRequest(eventId, {
      songTitle,
      artistName,
      requesterName,
      message,
      genre: requestGenre || votedGenre || undefined,
      tipAmount: includeTip ? Number(tipAmount) : undefined,
      paymentStatus: includeTip && pendingPayment ? "pending_verification" : "unpaid",
    } as Partial<RequestRecord>);

    localStorage.setItem(trackedRequestKey, created.requestId);
    setTrackedRequest(created);
    setSongsAway(null);
    localStorage.setItem(lockKey, String(Date.now() + 2 * 60 * 1000));
    return created;
  }

  async function resumeStripeCheckout() {
    if (!STRIPE_ENABLED || !eventId || !trackedRequest?.tipAmount) return;
    setResumingStripe(true);
    setFeedback(null);
    try {
      const checkout = await api.createStripeCheckout(
        eventId,
        trackedRequest.requestId,
        trackedRequest.tipAmount,
      );
      if (checkout.alreadyPaid) {
        setFeedback("Your tip is already paid and is being verified.");
      } else if (checkout.checkoutUrl) {
        window.location.assign(checkout.checkoutUrl);
      } else {
        throw new Error("Could not resume Stripe checkout.");
      }
    } catch (error) {
      setFeedback(`Checkout failed: ${(error as Error).message}`);
    } finally {
      setResumingStripe(false);
    }
  }

  async function onSubmitShoutout() {
    if (!eventId || !eventData || !shoutout.trim()) return;
    setShoutoutSubmitting(true);
    setShoutoutFeedback(null);
    try {
      await api.createRequest(eventId, {
        songTitle: "",
        artistName: "",
        requesterName: shoutoutName || undefined,
        shoutout: shoutout.trim(),
      } as Partial<RequestRecord>);
      setShoutout("");
      setShoutoutName("");
      setShoutoutFeedback("Shoutout submitted! DJs will review it shortly.");
      toast.success("Shoutout sent!");
    } catch (err) {
      setShoutoutFeedback(`Failed: ${(err as Error).message}`);
      toast.error("Shoutout failed");
    } finally {
      setShoutoutSubmitting(false);
    }
  }

  const refreshRequests = useCallback(async () => {
    if (!eventId) return;
    const all = await api.getRequests(eventId);
    setAllRequests(all);
    setLiveQueue(
      all
        .filter((r) => r.status === "approved")
        .sort(comparePriority),
    );
  }, [eventId]);

  useEffect(() => {
    if (!eventId) {
      return;
    }
    const loadEvent = async () => {
      const event = await api.getEvent(eventId);
      setEventData(event);
    };
    void loadEvent();
    void refreshRequests();
    const interval = window.setInterval(() => {
      void loadEvent();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [eventId, refreshRequests]);

  useEffect(() => {
    if (!eventId) return;
    api.getLibrary(eventId).then((lib) => setLibraryTracks(lib.tracks)).catch(() => setLibraryTracks(null));
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
    if (existingVote === "hip_hop" || existingVote === "country" || existingVote === "edm" || existingVote === "alternative_rock") {
      setVotedGenre(existingVote);
      setRequestGenre((prev) => prev || existingVote);
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
        .sort(comparePriority);
      const idx = approved.findIndex((item) => item.requestId === trackedId);
      setSongsAway(idx >= 0 ? idx + 1 : null);
    };

    void refreshStatus();
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

  useWebSocket(eventId, "guest", (payload) => {
    const parsed = payload as { type?: string; data?: RequestRecord };
    if (parsed.type !== "request_updated" || !parsed.data) return;
    const updated = parsed.data;

    setAllRequests((prev) => {
      const exists = prev.find((r) => r.requestId === updated.requestId);
      if (!exists) return [updated, ...prev];
      return prev.map((r) => (r.requestId === updated.requestId ? updated : r));
    });

    setLiveQueue((prev) => {
      if (updated.status === "approved") {
        const exists = prev.find((r) => r.requestId === updated.requestId);
        const next = exists
          ? prev.map((r) => (r.requestId === updated.requestId ? updated : r))
          : [...prev, updated];
        return next.sort(comparePriority);
      }
      return prev.filter((r) => r.requestId !== updated.requestId);
    });

    const trackedId = localStorage.getItem(trackedRequestKey);
    if (!trackedId) return;

    if (updated.requestId === trackedId) {
      setTrackedRequest(updated);
      if (updated.status === "approved") {
        toast.success("Your request was approved!");
      } else if (updated.status === "played") {
        toast.success("Your song is playing!");
      } else if (updated.status === "vetoed") {
        toast("Request not accepted this round. Try another track.");
      }
    }

    if (updated.status === "approved") {
      void (async () => {
        const all = await api.getRequests(eventId!);
        const approved = all
          .filter((item) => item.status === "approved")
          .sort(comparePriority);
        const idx = approved.findIndex((item) => item.requestId === trackedId);
        setSongsAway(idx >= 0 ? idx + 1 : null);
      })();
    }
  });


  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!eventId || !eventData) {
      return;
    }

    if (!songTitle.trim() || !artistName.trim()) {
      setFeedback("Enter a song title and artist.");
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
      await createGuestRequest();
      setSongTitle("");
      setArtistName("");
      setRequesterName("");
      setMessage("");
      setTipAmount("");
      setFeedback("Request submitted. The DJs will review it shortly.");
      toast.success("Request submitted!");
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("already been requested")) {
        try {
          const parsed = JSON.parse(msg);
          setFeedback(`"${parsed.existingRequest?.songTitle}" by ${parsed.existingRequest?.artistName} is already in the queue (${parsed.existingRequest?.status}).`);
        } catch {
          setFeedback("This song has already been requested.");
        }
        toast("This song has already been requested!");
      } else {
        setFeedback(`Request failed: ${msg}`);
        toast.error(msg);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function onVoteGenre(genre: GenreName) {
    if (!eventId || voteBusy || genre === votedGenre) {
      return;
    }
    setVoteBusy(true);
    try {
      const updatedEvent = await api.submitGenreVote(eventId, genre, votedGenre ?? undefined);
      setEventData(updatedEvent);
      setVotedGenre(genre);
      setRequestGenre((prev) => prev || genre);
      localStorage.setItem(voteKey, genre);
    } catch (err) {
      setFeedback(`Vote failed: ${(err as Error).message}`);
    } finally {
      setVoteBusy(false);
    }
  }

  const upvoteKey = useMemo(() => `upvoted-${eventId}`, [eventId]);

  const upvotedSet = useMemo(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(upvoteKey) ?? "[]") as string[]);
    } catch {
      return new Set<string>();
    }
  }, [upvoteKey]);

  async function onUpvote(requestId: string) {
    if (!eventId || upvotedSet.has(requestId)) return;
    try {
      const updated = await api.upvoteRequest(eventId, requestId);
      upvotedSet.add(requestId);
      localStorage.setItem(upvoteKey, JSON.stringify([...upvotedSet]));
      setAllRequests((prev) => prev.map((r) => (r.requestId === requestId ? updated : r)));
      setLiveQueue((prev) => prev.map((r) => (r.requestId === requestId ? updated : r)));
      toast.success("Vote counted!");
    } catch {
      toast.error("Could not upvote");
    }
  }

  const suggestions = useMemo(() => {
    if (!libraryTracks?.length) return [];
    const sorted = [...libraryTracks].sort((a, b) => b.playCount - a.playCount);
    return sorted.slice(0, 8);
  }, [libraryTracks]);

  const energy = useMemo(() => computeEnergy(allRequests), [allRequests]);

  const votableRequests = useMemo(
    () =>
      allRequests
        .filter((r) => r.status === "pending" || r.status === "approved")
        .sort((a, b) => (b.upvotes ?? 0) - (a.upvotes ?? 0)),
    [allRequests],
  );

  if (!eventData) {
    return <div className="p-6 text-slate-200">Loading event...</div>;
  }

  const { total: genreVoteTotal } = normalizeGenreVotes(eventData);
  const isSaasEvent = eventData.accountMode === "saas";

  const energyColor =
    energy < 30 ? "from-blue-500 to-cyan-400" : energy < 60 ? "from-yellow-400 to-orange-400" : "from-orange-500 to-red-500";

  return (
    <BrandedLayout event={eventData} title="Request a Song" subtitle="Your request goes to the DJ team for approval">
      <title>{`Request a Song — ${eventData.djBrandName} at ${eventData.venueName}`}</title>

      {/* Energy Meter */}
      <section className="mt-3 rounded-2xl border border-white/20 bg-black/30 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200">Crowd Energy</h2>
          <span className="text-xs font-bold text-slate-300">{energy}%</span>
        </div>
        <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-800">
          <div
            className={`h-full rounded-full bg-gradient-to-r ${energyColor} transition-all duration-700`}
            style={{ width: `${energy}%` }}
          />
        </div>
      </section>

      {/* Shoutout Section */}
      <section className="mt-3 rounded-2xl border border-violet-400/30 bg-violet-950/20 p-5">
        <h2 className="text-lg font-semibold text-violet-200">Send a Shoutout</h2>
        <p className="mt-1 text-xs text-violet-300/70">
          Appears on the big screen for 5 minutes after DJ approval
        </p>
        <label className="mt-3 block text-sm text-violet-200">
          Your shoutout
          <input
            className="mt-1 w-full rounded-md border border-violet-400/30 bg-slate-950/50 px-3 py-2 text-white placeholder:text-slate-500"
            placeholder="Happy Birthday Sarah! 🎂"
            value={shoutout}
            onChange={(e) => setShoutout(e.target.value)}
          />
        </label>
        <label className="mt-2 block text-sm text-violet-200">
          Your name <span className="text-violet-400/60">(optional)</span>
          <input
            className="mt-1 w-full rounded-md border border-violet-400/30 bg-slate-950/50 px-3 py-2 text-white placeholder:text-slate-500"
            placeholder="Your name"
            value={shoutoutName}
            onChange={(e) => setShoutoutName(e.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={shoutoutSubmitting || !shoutout.trim()}
          onClick={() => void onSubmitShoutout()}
          className="mt-3 w-full rounded-lg bg-violet-600 px-4 py-2 font-semibold text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
        >
          {shoutoutSubmitting ? "Sending..." : "Send Shoutout"}
        </button>
        {shoutoutFeedback ? <p className="mt-2 text-sm text-violet-200">{shoutoutFeedback}</p> : null}
      </section>

      <section className="mt-3 rounded-2xl border border-white/20 bg-black/30 p-5">
        <h2 className="text-lg font-semibold">Vote on Tonight&apos;s Style</h2>
        <p className="mt-1 text-sm text-slate-300">
          Help guide the vibe. Results appear on the ticker after {GENRE_VOTE_THRESHOLD} votes.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {getAvailableGenres().map((genre) => (
            <button
              key={genre}
              type="button"
              disabled={voteBusy || genre === votedGenre}
              onClick={() => void onVoteGenre(genre)}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
                votedGenre === genre
                  ? "bg-emerald-400 text-emerald-950"
                  : votedGenre
                    ? "bg-slate-700 text-slate-200 hover:bg-slate-600"
                    : "bg-slate-800 text-slate-100"
              } disabled:opacity-60`}
            >
              {GENRE_LABELS[genre]}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-300">
          {votedGenre ? `Your vote: ${GENRE_LABELS[votedGenre]}. Tap another to change it.` : "Tap a genre to vote. You can change your mind anytime."}
        </p>
        {genreVoteTotal > 0 ? (
          <p className="mt-2 text-xs text-slate-500">{genreVoteTotal} vote{genreVoteTotal === 1 ? "" : "s"} so far</p>
        ) : null}
      </section>

      {/* Smart Suggestions */}
      {suggestions.length > 0 ? (
        <section className="mt-3 rounded-2xl border border-white/20 bg-black/30 p-5">
          <h2 className="text-lg font-semibold">DJ Recommends</h2>
          <p className="mt-1 text-xs text-slate-400">Tap to auto-fill the request form</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {suggestions.map((track) => (
              <button
                key={`${track.titleNorm}-${track.artistNorm}`}
                type="button"
                className="rounded-lg border border-white/15 bg-slate-900/60 px-3 py-2 text-left text-sm transition-colors hover:bg-slate-800/80"
                onClick={() => {
                  setSongTitle(track.title);
                  setArtistName(track.artist);
                }}
              >
                <span className="font-semibold text-slate-100">{track.title}</span>
                <span className="ml-1.5 text-slate-400">— {track.artist}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

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
          Request genre
          <select
            className="mt-1 w-full rounded-md border border-white/25 bg-slate-950/50 px-3 py-2"
            value={requestGenre}
            onChange={(e) => setRequestGenre(e.target.value as GenreName | "")}
          >
            <option value="">Auto-detect if unsure</option>
            {getAvailableGenres().map((genre) => (
              <option key={genre} value={genre}>
                {GENRE_LABELS[genre]}
              </option>
            ))}
          </select>
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
            rows={2}
          />
        </label>

        <div className="rounded-lg border border-indigo-400/40 bg-indigo-900/20 p-3">
          <p className="text-sm font-semibold text-indigo-300">Tip to prioritize your request (optional)</p>
          <p className="mt-1 text-xs text-indigo-100/90">
            {isSaasEvent
              ? STRIPE_ENABLED
                ? "Pay securely with Stripe. Successful tips are verified automatically."
                : "Tips are temporarily unavailable. You can still send your song request for free."
              : "Send a tip to bump your request to the top. DJs verify paid requests in their queue."}
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
              disabled={isSaasEvent && !STRIPE_ENABLED}
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            {isSaasEvent ? (
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-md bg-violet-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-violet-400 disabled:opacity-60"
                disabled={!STRIPE_ENABLED || submitting || !tipAmount || Number(tipAmount) <= 0}
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
                      const checkout = await api.createStripeCheckout(
                        eventId,
                        created.requestId,
                        Number(tipAmount),
                      );
                      if (checkout.alreadyPaid) {
                        setFeedback("This request is already marked paid.");
                        setSubmitting(false);
                        return;
                      }
                      if (!checkout.checkoutUrl) {
                        throw new Error("Could not start Stripe checkout.");
                      }
                      window.location.assign(checkout.checkoutUrl);
                    } catch (err) {
                      setFeedback(`Checkout failed: ${(err as Error).message}`);
                      setSubmitting(false);
                    }
                  })();
                }}
              >
                {STRIPE_ENABLED ? "Pay securely with Stripe" : "Tips coming soon"}
              </button>
            ) : (
              <>
              {eventData.venmoHandle ? (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md bg-[#008CFF] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
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
                      await createGuestRequest(true);
                      const handle = eventData.venmoHandle!.replace(/^@/, "");
                      const amount = Number(tipAmount).toFixed(2);
                      const note = encodeURIComponent(`Song request: ${songTitle} - ${artistName}`);
                      const webUrl = `https://account.venmo.com/pay?txn=pay&recipients=${handle}&amount=${amount}&note=${note}`;
                      const isMobile = /android|iphone|ipad|ipod/i.test(navigator.userAgent);
                      if (isMobile) {
                        // Open the Venmo app directly with prefilled payment; fall
                        // back to the web checkout if the app isn't installed.
                        const deepLink = `venmo://paycharge?txn=pay&recipients=${handle}&amount=${amount}&note=${note}`;
                        const fallback = window.setTimeout(() => {
                          window.location.href = webUrl;
                        }, 1200);
                        const onHide = () => {
                          if (document.hidden) window.clearTimeout(fallback);
                        };
                        document.addEventListener("visibilitychange", onHide, { once: true });
                        window.location.href = deepLink;
                      } else {
                        window.open(webUrl, "_blank");
                      }
                      setFeedback("Request submitted. Complete your tip in the Venmo window. DJs will verify the payment.");
                    } catch (err) {
                      setFeedback(`Request failed: ${(err as Error).message}`);
                    } finally {
                      setSubmitting(false);
                    }
                  })();
                }}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4"><path d="M20.396 3.128c.71 1.169 1.029 2.373 1.029 3.898 0 4.862-4.152 11.18-7.518 15.612H6.631L3.575 1.362l6.57-.606 1.69 13.552c1.57-2.556 3.512-6.584 3.512-9.348 0-1.457-.249-2.453-.673-3.27l5.722-1.562z"/></svg>
                Venmo
              </button>
            ) : null}
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md bg-[#FFC439] px-3 py-1.5 text-xs font-semibold text-[#003087] disabled:opacity-60"
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
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4"><path d="M7.076 21.337H2.47a.641.641 0 0 1-.633-.74L4.944.901C5.026.382 5.474 0 5.998 0h7.46c2.57 0 4.578.543 5.69 1.81 1.01 1.15 1.304 2.42 1.012 4.287-.023.143-.047.288-.077.437-.983 5.05-4.349 6.797-8.647 6.797h-2.19c-.524 0-.968.382-1.05.9l-1.12 7.106zm14.146-14.42a3.35 3.35 0 0 0-.607-.541c-.013.076-.026.175-.041.254-.93 4.778-4.005 7.201-9.138 7.201h-2.19a.563.563 0 0 0-.556.479l-1.187 7.527h-.506l-.24 1.516a.56.56 0 0 0 .554.647h3.882c.46 0 .85-.334.922-.788.06-.26.76-4.852.816-5.09a.932.932 0 0 1 .923-.788h.58c3.76 0 6.705-1.528 7.565-5.946.36-1.847.174-3.388-.777-4.471z"/></svg>
              PayPal / Card
            </button>
              </>
            )}
          </div>
          <p className="mt-2 text-[11px] text-indigo-100/70">
            {isSaasEvent
              ? STRIPE_ENABLED
                ? "Checkout opens on Stripe. Your request is saved before you leave this page."
                : "Stripe checkout will be enabled soon."
              : "Venmo opens the app to send a manual tip (DJs verify it). PayPal / Card checks out instantly and auto-verifies your request."}
          </p>
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg px-4 py-2 font-semibold text-slate-900"
          style={{ backgroundColor: eventData.accentColor }}
        >
          {submitting ? "Sending..." : "Send Request (no tip)"}
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
            <p className="mt-2 text-xs text-amber-300">
              {isSaasEvent ? "Stripe checkout is pending." : "Tip submitted and pending verification."}
            </p>
          ) : trackedRequest.paymentStatus === "rejected" ? (
            <p className="mt-2 text-xs text-rose-300">The tip was not completed. Your song request is still saved.</p>
          ) : null}
          {STRIPE_ENABLED
          && isSaasEvent
          && trackedRequest.tipAmount
          && ["pending_verification", "rejected"].includes(trackedRequest.paymentStatus ?? "") ? (
            <button
              type="button"
              disabled={resumingStripe}
              onClick={() => void resumeStripeCheckout()}
              className="mt-3 rounded-md bg-violet-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
            >
              {resumingStripe ? "Opening Stripe…" : "Resume secure tip checkout"}
            </button>
          ) : null}
        </section>
      ) : null}

      {/* Live Queue View */}
      {liveQueue.length > 0 ? (
        <section className="mt-3 rounded-2xl border border-white/20 bg-black/30 p-5">
          <h2 className="text-lg font-semibold">Coming Up</h2>
          <p className="mt-1 text-xs text-slate-400">Approved queue &mdash; updated live</p>
          <div className="mt-3 space-y-2">
            {liveQueue.map((req, idx) => (
              <div key={req.requestId} className="flex items-center gap-3 rounded-lg border border-white/10 bg-slate-900/50 px-3 py-2">
                <span className="w-6 shrink-0 text-center text-xs font-bold text-slate-500">{idx + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-100">
                    {toDisplayTitleCase(req.songTitle)}
                  </p>
                  <p className="truncate text-xs text-slate-400">{toDisplayTitleCase(req.artistName)}</p>
                </div>
                {(req.upvotes ?? 0) > 0 ? (
                  <span className="text-xs font-semibold text-amber-300">{req.upvotes}</span>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Upvoting Section */}
      {votableRequests.length > 0 ? (
        <section className="mt-3 rounded-2xl border border-white/20 bg-black/30 p-5">
          <h2 className="text-lg font-semibold">Upvote Requests</h2>
          <p className="mt-1 text-xs text-slate-400">Boost songs you want to hear &mdash; DJs see the count</p>
          <div className="mt-3 space-y-2">
            {votableRequests.map((req) => (
              <div key={req.requestId} className="flex items-center gap-3 rounded-lg border border-white/10 bg-slate-900/50 px-3 py-2">
                <button
                  type="button"
                  disabled={upvotedSet.has(req.requestId)}
                  onClick={() => void onUpvote(req.requestId)}
                  className={`flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-lg text-xs font-bold transition-colors ${
                    upvotedSet.has(req.requestId)
                      ? "bg-amber-400/20 text-amber-300"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  <span className="text-[10px] leading-none">{upvotedSet.has(req.requestId) ? "\u2713" : "\u25B2"}</span>
                  <span>{req.upvotes ?? 0}</span>
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-100">
                    {toDisplayTitleCase(req.songTitle)}
                  </p>
                  <p className="truncate text-xs text-slate-400">{toDisplayTitleCase(req.artistName)}</p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  req.status === "approved" ? "bg-emerald-400/20 text-emerald-300" : "bg-amber-400/20 text-amber-300"
                }`}>
                  {req.status}
                </span>
              </div>
            ))}
          </div>
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
