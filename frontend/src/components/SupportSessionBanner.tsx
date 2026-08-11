import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

function remainingLabel(expiresAt: string | number, now: number) {
  if (!now) return "--:--";
  const expiry = typeof expiresAt === "number"
    ? expiresAt < 10_000_000_000 ? expiresAt * 1000 : expiresAt
    : Date.parse(expiresAt);
  const seconds = Math.max(0, Math.ceil((expiry - now) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function SupportSessionBanner() {
  const { supportSession, endSupportSession } = useAuth();
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (!supportSession) return;
    const timeout = window.setTimeout(() => setNow(Date.now()), 0);
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, [supportSession]);

  if (!supportSession) return null;

  return (
    <aside
      className="sticky top-0 z-40 border-b-4 border-slate-950 bg-amber-300 px-4 py-2 text-amber-950 shadow-xl"
      aria-live="polite"
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-black">
          CUSTOMER SUPPORT MODE · {supportSession.mode.replace("_", " ").toUpperCase()} ·{" "}
          {supportSession.organizationName ?? supportSession.organizationId} ·{" "}
          <span className="font-mono">{remainingLabel(supportSession.expiresAt, now)}</span> remaining
        </p>
        <div className="flex items-center gap-2">
          <Link
            to="/platform-admin?tab=support"
            className="rounded border-2 border-amber-950 px-2 py-1 text-xs font-bold"
          >
            Support view
          </Link>
          <button
            type="button"
            onClick={() => void endSupportSession().catch(() => undefined)}
            className="rounded bg-amber-950 px-3 py-1.5 text-xs font-black text-amber-100"
          >
            End now
          </button>
        </div>
      </div>
    </aside>
  );
}
