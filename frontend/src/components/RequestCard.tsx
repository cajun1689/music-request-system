import type { RequestRecord } from "../types";

export function RequestCard({
  request,
  onApprove,
  onVeto,
  onPlayed,
  onVerifyTip,
  onRejectTip,
}: {
  request: RequestRecord;
  onApprove?: (id: string) => void;
  onVeto?: (id: string) => void;
  onPlayed?: (id: string) => void;
  onVerifyTip?: (id: string) => void;
  onRejectTip?: (id: string) => void;
}) {
  const paymentStatus = request.paymentStatus ?? "unpaid";
  const paymentClass =
    paymentStatus === "verified"
      ? "bg-emerald-400/20 text-emerald-300 border-emerald-300/40"
      : paymentStatus === "pending_verification"
        ? "bg-amber-400/20 text-amber-300 border-amber-300/40"
        : paymentStatus === "rejected"
          ? "bg-rose-400/20 text-rose-300 border-rose-300/40"
          : "bg-slate-500/20 text-slate-300 border-slate-300/40";

  return (
    <article className="rounded-xl border border-white/20 bg-slate-900/70 p-4">
      <h3 className="text-lg font-semibold text-white">
        {request.songTitle} <span className="text-slate-400">-</span> {request.artistName}
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
      </div>
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
