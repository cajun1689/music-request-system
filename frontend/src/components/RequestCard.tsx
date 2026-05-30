import type { RequestRecord } from "../types";
import { toDisplayTitleCase } from "../utils/formatting";
import { GENRE_LABELS } from "../utils/genreVotes";

export interface LibraryMatchInfo {
  found: boolean;
  bestTrack?: {
    title: string;
    artist: string;
    playCount: number;
  };
}

function genrePillClass(label: string, supportedGenre?: string): string {
  const key = `${supportedGenre ?? ""} ${label}`
    .toLowerCase()
    .replace(/&/g, "and");

  if (key.includes("country")) return "bg-amber-400/15 border-amber-400/30 text-amber-200";
  if (key.includes("hip") || key.includes("rap")) return "bg-red-400/15 border-red-400/30 text-red-200";
  if (key.includes("edm") || key.includes("electronic") || key.includes("dance")) return "bg-cyan-400/15 border-cyan-400/30 text-cyan-200";
  if (key.includes("alternative") || key.includes("rock") || key.includes("metal")) return "bg-violet-400/15 border-violet-400/30 text-violet-200";
  if (key.includes("pop")) return "bg-pink-400/15 border-pink-400/30 text-pink-200";
  if (key.includes("r and b") || key.includes("rnb") || key.includes("soul")) return "bg-purple-400/15 border-purple-400/30 text-purple-200";
  if (key.includes("latin") || key.includes("reggaeton")) return "bg-rose-400/15 border-rose-400/30 text-rose-200";
  if (key.includes("afro")) return "bg-yellow-400/15 border-yellow-400/30 text-yellow-200";
  if (key.includes("funk")) return "bg-lime-400/15 border-lime-400/30 text-lime-200";
  return "bg-slate-500/15 border-slate-400/20 text-slate-400";
}

export function RequestCard({
  request,
  libraryMatch,
  onApprove,
  onVeto,
  onPlayed,
  onVerifyTip,
  onRejectTip,
  onApproveShoutout,
  onRejectShoutout,
}: {
  request: RequestRecord;
  libraryMatch?: LibraryMatchInfo;
  onApprove?: (id: string) => void;
  onVeto?: (id: string) => void;
  onPlayed?: (id: string) => void;
  onVerifyTip?: (id: string) => void;
  onRejectTip?: (id: string) => void;
  onApproveShoutout?: (id: string) => void;
  onRejectShoutout?: (id: string) => void;
}) {
  const isAutoMatched = request.reviewedBy?.startsWith("auto:");
  const autoSourceLabel = isAutoMatched
    ? request.reviewedBy!.split(":").slice(2).join(":") || request.reviewedBy!.split(":")[1] || "Auto"
    : null;

  const paymentStatus = request.paymentStatus ?? "unpaid";
  const paymentClass =
    paymentStatus === "verified"
      ? "bg-emerald-400/20 text-emerald-300 border-emerald-300/40"
      : paymentStatus === "pending_verification"
        ? "bg-amber-400/20 text-amber-300 border-amber-300/40"
        : paymentStatus === "rejected"
          ? "bg-rose-400/20 text-rose-300 border-rose-300/40"
          : "bg-slate-500/20 text-slate-300 border-slate-300/40";

  const inLibrary = libraryMatch?.found;
  const bestTrack = libraryMatch?.bestTrack;

  const isShoutoutOnly = !request.songTitle?.trim() && !!request.shoutout;
  const genreLabel = request.genre ? GENRE_LABELS[request.genre] : request.genreLabel || "No genre";
  const genreClass = genrePillClass(genreLabel, request.genre);

  return (
    <article className="rounded-xl border border-white/20 bg-slate-900/70 p-4">
      {isShoutoutOnly ? (
        <h3 className="text-lg font-semibold text-violet-300">
          Shoutout
        </h3>
      ) : (
        <h3 className="text-lg font-semibold text-white">
          {toDisplayTitleCase(request.songTitle)} <span className="text-slate-400">-</span> {toDisplayTitleCase(request.artistName)}
        </h3>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${paymentClass}`}>
          {paymentStatus.replace("_", " ")}
        </span>
        {(request.upvotes ?? 0) > 0 ? (
          <span className="rounded-full bg-amber-400/15 border border-amber-400/30 px-2 py-0.5 text-xs font-semibold text-amber-200">
            {request.upvotes} upvote{request.upvotes === 1 ? "" : "s"}
          </span>
        ) : null}
        {typeof request.tipAmount === "number" ? (
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-200">
            Tip ${request.tipAmount.toFixed(2)}
          </span>
        ) : null}
        <span
          className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${genreClass}`}
        >
          {genreLabel}
        </span>
        {inLibrary === true ? (
          <span className="rounded-full bg-blue-400/20 border border-blue-400/40 px-2 py-0.5 text-xs font-semibold text-blue-300">
            ✓ In Library
          </span>
        ) : inLibrary === false ? (
          <span className="rounded-full bg-orange-400/20 border border-orange-400/40 px-2 py-0.5 text-xs font-semibold text-orange-300">
            Not in Library
          </span>
        ) : null}
      </div>
      {bestTrack ? (
        <div className="mt-2 rounded-lg bg-blue-950/40 border border-blue-400/20 px-3 py-2">
          <p className="text-xs font-semibold text-blue-300">
            Best match: {bestTrack.title} — {bestTrack.artist}
          </p>
          <p className="text-xs text-blue-400/70 mt-0.5">
            {bestTrack.playCount > 0 ? `Played ${bestTrack.playCount} time${bestTrack.playCount !== 1 ? "s" : ""}` : "Never played"}
          </p>
        </div>
      ) : null}
      {autoSourceLabel ? (
        <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-violet-400/20 border border-violet-400/40 px-2 py-0.5 text-xs font-semibold text-violet-300">
          Matched by {autoSourceLabel}
        </span>
      ) : null}
      <p className="mt-1 text-sm text-slate-300">
        Requested by {request.requesterName?.trim() ? request.requesterName : "Guest"}
      </p>
      {request.message ? <p className="mt-2 text-sm italic text-slate-300/90">"{request.message}"</p> : null}
      {request.shoutout ? (
        <div className="mt-2 rounded-lg border px-3 py-2 flex items-center justify-between gap-2"
          style={{
            background: request.shoutoutFlagSeverity === "block"
              ? "rgba(239,68,68,0.15)"
              : request.shoutoutFlagSeverity === "warn"
                ? "rgba(245,158,11,0.10)"
                : request.shoutoutApproved === true
                  ? "rgba(139,92,246,0.12)"
                  : request.shoutoutApproved === false
                    ? "rgba(239,68,68,0.08)"
                    : "rgba(139,92,246,0.08)",
            borderColor: request.shoutoutFlagSeverity === "block"
              ? "rgba(239,68,68,0.5)"
              : request.shoutoutFlagSeverity === "warn"
                ? "rgba(245,158,11,0.4)"
                : request.shoutoutApproved === true
                  ? "rgba(139,92,246,0.35)"
                  : request.shoutoutApproved === false
                    ? "rgba(239,68,68,0.25)"
                    : "rgba(139,92,246,0.2)",
          }}
        >
          <div className="min-w-0">
            <p className="text-sm text-violet-300/90 truncate">
              Shoutout: &ldquo;{request.shoutout}&rdquo;
            </p>
            {request.shoutoutFlagSeverity === "block" ? (
              <span className="text-xs text-rose-300 font-semibold">
                AI: Blocked — {request.shoutoutFlagReason || "policy violation"}
                {request.shoutoutFlagCategories?.length ? ` (${request.shoutoutFlagCategories.join(", ")})` : ""}
              </span>
            ) : request.shoutoutFlagSeverity === "warn" ? (
              <span className="text-xs text-amber-300 font-semibold">
                AI flag: {request.shoutoutFlagReason || "review before approving"}
                {request.shoutoutFlagCategories?.length ? ` (${request.shoutoutFlagCategories.join(", ")})` : ""}
              </span>
            ) : request.shoutoutApproved === true ? (
              <span className="text-xs text-emerald-400 font-semibold">Approved — on ticker</span>
            ) : request.shoutoutApproved === false ? (
              <span className="text-xs text-rose-400 font-semibold">Rejected</span>
            ) : (
              <span className="text-xs text-amber-300 font-semibold">Pending review</span>
            )}
          </div>
          {request.shoutoutApproved == null && (onApproveShoutout || onRejectShoutout) ? (
            <div className="flex gap-1.5 flex-shrink-0">
              {onApproveShoutout ? (
                <button
                  className="rounded-md bg-violet-500 px-2 py-1 text-xs font-semibold text-white"
                  onClick={() => onApproveShoutout(request.requestId)}
                >
                  ✓
                </button>
              ) : null}
              {onRejectShoutout ? (
                <button
                  className="rounded-md bg-slate-600 px-2 py-1 text-xs font-semibold text-slate-200"
                  onClick={() => onRejectShoutout(request.requestId)}
                >
                  ✗
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {request.paymentReference ? (
        <p className="mt-1 text-xs text-slate-400">Payment reference: {request.paymentReference}</p>
      ) : null}
      {request.paymentVerifiedBy ? (
        <p className="mt-1 text-xs text-slate-400">Verified by: {request.paymentVerifiedBy}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {onApprove ? (
          <button
            className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-emerald-950"
            onClick={() => onApprove(request.requestId)}
          >
            Approve
          </button>
        ) : null}
        {onVeto ? (
          <button
            className="rounded-md bg-rose-500 px-3 py-1.5 text-xs font-semibold text-rose-950"
            onClick={() => onVeto(request.requestId)}
          >
            Veto
          </button>
        ) : null}
        {onPlayed ? (
          <button
            className="rounded-md bg-sky-400 px-3 py-1.5 text-xs font-semibold text-sky-950"
            onClick={() => onPlayed(request.requestId)}
          >
            Mark Played
          </button>
        ) : null}
        {onVerifyTip ? (
          <button
            className="rounded-md bg-amber-400 px-3 py-1.5 text-xs font-semibold text-amber-950"
            onClick={() => onVerifyTip(request.requestId)}
          >
            Verify Tip
          </button>
        ) : null}
        {onRejectTip ? (
          <button
            className="rounded-md bg-slate-500 px-3 py-1.5 text-xs font-semibold text-slate-950"
            onClick={() => onRejectTip(request.requestId)}
          >
            Mark Unpaid
          </button>
        ) : null}
      </div>
    </article>
  );
}
