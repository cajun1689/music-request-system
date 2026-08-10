import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { SaasAuthShell } from "../components/SaasAuthShell";
import { useAuth } from "../context/AuthContext";

export function ConfirmSignupPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { confirmSignUp, resendConfirmationCode } = useAuth();
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState("");
  const requestedFrom = (location.state as { from?: string } | null)?.from;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await confirmSignUp(email, code);
      toast.success("Email confirmed. You can sign in now.");
      navigate("/login", {
        replace: true,
        state: { from: requestedFrom ?? "/console" },
      });
    } catch (err) {
      const message = (err as Error).message;
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    setResending(true);
    setError("");
    try {
      await resendConfirmationCode(email);
      toast.success("A new code is on its way.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setResending(false);
    }
  }

  return (
    <SaasAuthShell title="Confirm your email" subtitle="Enter the verification code Cognito sent to your inbox.">
      <title>Confirm Account — Casper Requests</title>
      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block text-sm font-medium text-slate-200">
          Email
          <input
            className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2.5 outline-none focus:border-orange-400"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label className="block text-sm font-medium text-slate-200">
          Confirmation code
          <input
            className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2.5 font-mono tracking-[0.25em] outline-none focus:border-orange-400"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            required
          />
        </label>
        {error ? <p className="text-sm text-rose-300">{error}</p> : null}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-orange-400 px-4 py-2.5 font-semibold text-orange-950 hover:bg-orange-300 disabled:opacity-60"
        >
          {loading ? "Confirming..." : "Confirm account"}
        </button>
        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={() => void resend()}
            disabled={resending || !email}
            className="text-orange-300 disabled:opacity-50"
          >
            {resending ? "Sending..." : "Resend code"}
          </button>
          <Link
            to="/login"
            state={{ from: requestedFrom }}
            className="text-slate-400 hover:text-slate-200"
          >
            Back to sign in
          </Link>
        </div>
      </form>
    </SaasAuthShell>
  );
}
