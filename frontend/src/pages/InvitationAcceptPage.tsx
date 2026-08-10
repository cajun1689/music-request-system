import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api } from "../services/api";

export function InvitationAcceptPage() {
  const { token } = useParams();
  const { session, reloadOrganizations, setActiveOrganization } = useAuth();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [accepted, setAccepted] = useState(false);

  async function accept() {
    if (!session || !token) return;
    setLoading(true);
    setMessage("");
    try {
      const result = await api.acceptInvitation(token, session.idToken);
      await reloadOrganizations();
      const organizationId = result.organization?.organizationId ?? result.membership?.organizationId;
      if (organizationId) setActiveOrganization(organizationId);
      setAccepted(true);
      setMessage("Invitation accepted. You now have access to the organization.");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-100">
      <title>Accept Invitation — Casper Requests</title>
      <main className="w-full max-w-lg rounded-3xl border border-white/10 bg-slate-900 p-7 text-center shadow-2xl">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-orange-400 text-xl font-bold text-orange-950">C</span>
        <h1 className="mt-5 text-2xl font-bold">Join this organization</h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Signed in as {session?.email}. Accepting gives you the role selected by the organization owner.
        </p>
        {message ? <p className={`mt-5 text-sm ${accepted ? "text-emerald-300" : "text-rose-300"}`}>{message}</p> : null}
        {accepted ? (
          <Link to="/console" className="mt-6 inline-block w-full rounded-xl bg-orange-400 px-4 py-2.5 font-semibold text-orange-950">
            Open organization console
          </Link>
        ) : (
          <button
            onClick={() => void accept()}
            disabled={loading || !token}
            className="mt-6 w-full rounded-xl bg-orange-400 px-4 py-2.5 font-semibold text-orange-950 disabled:opacity-60"
          >
            {loading ? "Accepting..." : "Accept invitation"}
          </button>
        )}
        <Link to="/console" className="mt-4 block text-sm text-slate-400">Not now</Link>
      </main>
    </div>
  );
}
