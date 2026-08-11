import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { SaasAuthShell } from "../components/SaasAuthShell";
import { useAuth } from "../context/AuthContext";
import { api } from "../services/api";

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestedFrom = (location.state as { from?: string } | null)?.from;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const nextSession = await login(email, password);
      let from = requestedFrom;
      if (!from) {
        const [result, platformResult] = await Promise.all([
          api.getOrganizations(nextSession.idToken).catch(() => null),
          api.getPlatformMe(nextSession.idToken).catch(() => null),
        ]);
        if (!result && !platformResult?.access.isPlatformAdmin) {
          throw new Error("Signed in, but account services are temporarily unavailable.");
        }
        from = platformResult?.access.isPlatformAdmin
          ? "/platform-admin"
          : result?.organizations.some((organization) => organization.accountMode === "legacy")
            ? "/admin"
            : "/console";
      }
      navigate(from, { replace: true });
    } catch (err) {
      setError((err as Error).message);
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <SaasAuthShell title="Welcome back" subtitle="Sign in to manage your events, team, requests, and payouts.">
      <title>Sign In — Casper Requests</title>
      <form onSubmit={onSubmit}>
        <label className="block text-sm font-medium text-slate-200">
          Email
          <input
            className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2.5 text-slate-100 outline-none transition focus:border-orange-400"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </label>
        <label className="mt-4 block text-sm font-medium text-slate-200">
          <span className="flex items-center justify-between">
            Password
            <Link to="/forgot-password" className="text-xs text-orange-300 hover:text-orange-200">
              Forgot password?
            </Link>
          </span>
          <input
            className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2.5 text-slate-100 outline-none transition focus:border-orange-400"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}
        <button
          type="submit"
          disabled={loading}
          className="mt-6 w-full rounded-xl bg-orange-400 px-4 py-2.5 font-semibold text-orange-950 transition hover:bg-orange-300 disabled:opacity-60"
        >
          {loading ? "Signing in..." : "Sign In"}
        </button>
        <p className="mt-5 text-center text-sm text-slate-400">
          New to Casper Requests?{" "}
          <Link
            to="/signup"
            state={{ from: requestedFrom }}
            className="font-semibold text-orange-300 hover:text-orange-200"
          >
            Create an account
          </Link>
        </p>
      </form>
    </SaasAuthShell>
  );
}
