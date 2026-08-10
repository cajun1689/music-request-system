import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { SaasAuthShell } from "../components/SaasAuthShell";
import { useAuth } from "../context/AuthContext";

export function SignupPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signUp } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestedFrom = (location.state as { from?: string } | null)?.from;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await signUp(email, password);
      toast.success(result.userConfirmed ? "Account created." : "Check your email for a confirmation code.");
      if (result.userConfirmed) {
        navigate("/login", { state: { from: requestedFrom ?? "/console" } });
      } else {
        navigate(`/confirm?email=${encodeURIComponent(email)}`, {
          state: { from: requestedFrom },
        });
      }
    } catch (err) {
      const message = (err as Error).message;
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <SaasAuthShell
      title="Start taking requests"
      subtitle="Create your workspace, launch an event, and accept secure guest tips in minutes."
    >
      <title>Sign Up — Casper Requests</title>
      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block text-sm font-medium text-slate-200">
          Work email
          <input
            className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2.5 outline-none focus:border-orange-400"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label className="block text-sm font-medium text-slate-200">
          Password
          <input
            className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2.5 outline-none focus:border-orange-400"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <span className="mt-1 block text-xs text-slate-500">Use at least 8 characters.</span>
        </label>
        <label className="block text-sm font-medium text-slate-200">
          Confirm password
          <input
            className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2.5 outline-none focus:border-orange-400"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
          />
        </label>
        <label className="flex items-start gap-3 text-xs leading-5 text-slate-400">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 rounded border-slate-600 bg-slate-900"
            checked={accepted}
            onChange={(event) => setAccepted(event.target.checked)}
            required
          />
          <span>
            I agree to the <Link to="/terms" className="text-orange-300">Terms</Link>,{" "}
            <Link to="/privacy" className="text-orange-300">Privacy Policy</Link>, and{" "}
            <Link to="/acceptable-use" className="text-orange-300">Acceptable Use Policy</Link>.
          </span>
        </label>
        {error ? <p className="text-sm text-rose-300">{error}</p> : null}
        <button
          type="submit"
          disabled={loading || !accepted}
          className="w-full rounded-xl bg-orange-400 px-4 py-2.5 font-semibold text-orange-950 hover:bg-orange-300 disabled:opacity-60"
        >
          {loading ? "Creating account..." : "Create account"}
        </button>
        <p className="text-center text-sm text-slate-400">
          Already have an account?{" "}
          <Link
            to="/login"
            state={{ from: requestedFrom }}
            className="font-semibold text-orange-300"
          >
            Sign in
          </Link>
        </p>
      </form>
    </SaasAuthShell>
  );
}
