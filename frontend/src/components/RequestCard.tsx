import type { RequestRecord } from "../types";
import { toDisplayTitleCase } from "../utils/formatting";

export interface LibraryMatchInfo {
  found: boolean;
  bestTrack?: {
    title: string;
    artist: string;
    playCount: number;
  };
}

export function RequestCard({
  request,
  libraryMatch,
  onApprove,
  onVeto,
  onPlayed,
  onVerifyTip,
  onRejectTip,
}: {
  request: RequestRecord;
  libraryMatch?: LibraryMatchInfo;
  onApprove?: (id: string) => void;
  onVeto?: (id: string) => void;
  onPlayed?: (id: string) => void;
  onVerifyTip?: (id: string) => void;
  onRejectTip?: (id: string) => void;
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

  return (
    <article className="rounded-xl border border-white/20 bg-slate-900/70 p-4">
      <h3 className="text-lg font-semibold text-white">
        {toDisplayTitleCase(request.songTitle)} <span className="text-slate-400">-</span> {toDisplayTitleCase(request.artistName)}
      </h3>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${paymentClass}`}>
          {paymentStatus.replace("_", " ")}
        </span>
        {typeof request.tipAmount === "number" ? (
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-200">
            Tip ${request.tipAmount.toFixed(2)}
          </span>
        ) : null}
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
