import type { ReactNode } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function PlatformAdminRoute({ children }: { children: ReactNode }) {
  const {
    session,
    isPlatformAdmin,
    loadingOrganizations,
    loadingPlatformAccess,
    hasLegacyPlatformEligibility,
  } = useAuth();
  const location = useLocation();

  if (!session) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  if (loadingOrganizations || loadingPlatformAccess) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-950 text-slate-300">
        <p role="status">Verifying platform access...</p>
      </div>
    );
  }

  if (!isPlatformAdmin) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-950 px-4 text-slate-100">
        <div className="max-w-md rounded-2xl border border-rose-400/30 bg-slate-900 p-6">
          <h1 className="text-xl font-semibold">Platform access required</h1>
          <p className="mt-2 text-sm text-slate-400">
            {hasLegacyPlatformEligibility
              ? "Your MAPL membership is eligible, but the platform authorization service denied access."
              : "This area is restricted to authorized MAPL platform operators."}
          </p>
          <div className="mt-5 flex gap-2">
            {hasLegacyPlatformEligibility ? (
              <Link to="/admin" className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-950">
                Legacy admin
              </Link>
            ) : null}
            <Link to="/console" className="rounded-lg border border-slate-700 px-3 py-2 text-sm">
              Customer console
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
