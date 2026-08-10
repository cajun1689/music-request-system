import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api";

export type InfoPageKind = "terms" | "privacy" | "acceptable-use" | "support" | "status";

const pages: Record<InfoPageKind, { title: string; intro: string; sections: Array<{ title: string; body: string }> }> = {
  terms: {
    title: "Terms of Service",
    intro: "These terms govern use of Casper Requests by account owners, team members, and event guests.",
    sections: [
      { title: "Your account", body: "Keep credentials secure, provide accurate account information, and use the service only for lawful events you are authorized to manage." },
      { title: "Subscriptions and payments", body: "Paid features renew according to the checkout terms shown at purchase. Guest tips are processed by third-party payment providers and may be subject to their fees and policies." },
      { title: "Service availability", body: "We work to keep Casper Requests reliable, but do not guarantee uninterrupted availability. Features may change as the service improves." },
      { title: "Ending service", body: "You may stop using the service at any time. We may suspend accounts that violate these terms or create risk for guests, partners, or the platform." },
    ],
  },
  privacy: {
    title: "Privacy Policy",
    intro: "Casper Requests collects only the information needed to operate accounts, events, requests, and payments.",
    sections: [
      { title: "Information we process", body: "Account email, organization and event details, guest request content, usage records, and payment status may be processed to provide the service." },
      { title: "How information is used", body: "We use information to authenticate users, deliver event features, prevent abuse, provide support, and improve reliability." },
      { title: "Service providers", body: "Cloud hosting, authentication, and payment providers process limited information on our behalf under their own security and privacy commitments." },
      { title: "Your choices", body: "Organization owners can export data and schedule deletion in the organization console. A 30-day recovery window applies; limited billing-event and provider records may remain for up to 90 days or longer when legally required." },
    ],
  },
  "acceptable-use": {
    title: "Acceptable Use Policy",
    intro: "Use Casper Requests in a way that is safe for guests, performers, venues, and the service.",
    sections: [
      { title: "Prohibited activity", body: "Do not use the service for illegal activity, fraud, harassment, threats, hate, exploitation, malware, unauthorized access, or payment manipulation." },
      { title: "Event content", body: "Account owners are responsible for moderating event names, branding, shoutouts, messages, and other content shown to guests or on displays." },
      { title: "Platform integrity", body: "Do not probe, overload, scrape, reverse engineer, or bypass security and usage controls without written authorization." },
      { title: "Enforcement", body: "We may remove content or suspend access when needed to protect users, payment partners, or platform integrity." },
    ],
  },
  support: {
    title: "Support",
    intro: "Need help with onboarding, billing, payouts, or a live event?",
    sections: [
      { title: "Account and event help", body: "Include your account email, organization name, event ID, and a short description of the issue so it can be investigated quickly." },
      { title: "Payment support", body: "Never send full card or bank details. Include only the event ID, request ID, approximate time, and payment provider when reporting an issue." },
      { title: "Contact", body: "Email support@casperrequests.com. For an active event, note “Live event” in the subject line." },
    ],
  },
  status: {
    title: "Service Status",
    intro: "Operational updates for the Casper Requests web app, API, authentication, and payment integrations.",
    sections: [
      { title: "Current status", body: "This page performs a live API health check when opened. Payment-provider availability is reported independently by Stripe or PayPal." },
      { title: "Live-event troubleshooting", body: "Check your internet connection, refresh the page, and verify that the event link is correct. Payment provider interruptions may affect checkout independently." },
    ],
  },
};

export function InfoPage({ kind }: { kind: InfoPageKind }) {
  const page = pages[kind];
  const [health, setHealth] = useState<"checking" | "operational" | "degraded">("checking");
  useEffect(() => {
    if (kind !== "status") return;
    let cancelled = false;
    api.listEvents()
      .then(() => {
        if (!cancelled) setHealth("operational");
      })
      .catch(() => {
        if (!cancelled) setHealth("degraded");
      });
    return () => {
      cancelled = true;
    };
  }, [kind]);
  return (
    <div className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100">
      <title>{page.title} — Casper Requests</title>
      <div className="mx-auto max-w-3xl">
        <Link to="/" className="text-sm font-semibold text-orange-300">← Casper Requests</Link>
        <header className="mt-6 rounded-3xl border border-white/10 bg-slate-900 p-6 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-300">Casper Requests</p>
          <h1 className="mt-3 text-3xl font-bold">{page.title}</h1>
          <p className="mt-3 max-w-2xl leading-7 text-slate-400">{page.intro}</p>
          {kind !== "support" && kind !== "status" ? (
            <p className="mt-3 text-xs text-slate-500">Effective August 10, 2026</p>
          ) : null}
        </header>
        <main className="mt-4 space-y-4">
          {kind === "status" ? (
            <section className={`rounded-2xl border p-5 ${
              health === "operational"
                ? "border-emerald-400/30 bg-emerald-400/10"
                : health === "degraded"
                  ? "border-red-400/30 bg-red-400/10"
                  : "border-sky-400/30 bg-sky-400/10"
            }`}>
              <p className="font-semibold">
                {health === "operational"
                  ? "Web API operational"
                  : health === "degraded"
                    ? "Web API health check failed"
                    : "Checking live service health…"}
              </p>
              <p className="mt-1 text-xs text-slate-400">Checked {new Date().toLocaleString()}</p>
            </section>
          ) : null}
          {page.sections.map((section) => (
            <section key={section.title} className="rounded-2xl border border-white/10 bg-slate-900/70 p-6">
              <h2 className="text-lg font-semibold">{section.title}</h2>
              <p className="mt-2 leading-7 text-slate-400">{section.body}</p>
              {kind === "support" && section.title === "Contact" ? (
                <a className="mt-3 inline-block font-semibold text-orange-300" href="mailto:support@casperrequests.com">
                  Email support
                </a>
              ) : null}
            </section>
          ))}
        </main>
        <nav className="mt-8 flex flex-wrap gap-4 text-sm text-slate-400">
          <Link to="/terms">Terms</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/acceptable-use">Acceptable Use</Link>
          <Link to="/support">Support</Link>
          <Link to="/status">Status</Link>
        </nav>
      </div>
    </div>
  );
}
