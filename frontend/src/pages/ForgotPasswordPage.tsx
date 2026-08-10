import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { SaasAuthShell } from "../components/SaasAuthShell";
import { useAuth } from "../context/AuthContext";

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const { requestPasswordReset, confirmPasswordReset } = useAuth();
  const [step, setStep] = useState<"request" | "confirm">("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function requestReset(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await requestPasswordReset(email);
      setStep("confirm");
      toast.success("Check your email for a reset code.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function confirmReset(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await confirmPasswordReset(email, code, password);
      toast.success("Password updated. Sign in with your new password.");
      navigate("/login", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <SaasAuthShell
      title={step === "request" ? "Reset your password" : "Choose a new password"}
      subtitle={
        step === "request"
          ? "We’ll send a verification code to your account email."
          : `Enter the code sent to ${email}.`
      }
    >
      <title>Reset Password — Casper Requests</title>
      {step === "request" ? (
        <form onSubmit={requestReset} className="space-y-4">
          <label className="block text-sm font-medium text-slate-200">
            Email
            <input
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2.5 outline-none focus:border-orange-400"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          {error ? <p className="text-sm text-rose-300">{error}</p> : null}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-orange-400 px-4 py-2.5 font-semibold text-orange-950 hover:bg-orange-300 disabled:opacity-60"
          >
            {loading ? "Sending..." : "Send reset code"}
          </button>
        </form>
      ) : (
        <form onSubmit={confirmReset} className="space-y-4">
          <label className="block text-sm font-medium text-slate-200">
            Verification code
            <input
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2.5 font-mono tracking-[0.2em] outline-none focus:border-orange-400"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              required
            />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            New password
            <input
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2.5 outline-none focus:border-orange-400"
              type="password"
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {error ? <p className="text-sm text-rose-300">{error}</p> : null}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-orange-400 px-4 py-2.5 font-semibold text-orange-950 hover:bg-orange-300 disabled:opacity-60"
          >
            {loading ? "Updating..." : "Update password"}
          </button>
          <button type="button" onClick={() => setStep("request")} className="w-full text-sm text-slate-400">
            Use a different email
          </button>
        </form>
      )}
      <p className="mt-5 text-center text-sm text-slate-400">
        <Link to="/login" className="font-semibold text-orange-300">Back to sign in</Link>
      </p>
    </SaasAuthShell>
  );
}
