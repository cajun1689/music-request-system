import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export function SaasAuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-4 py-10 text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.18),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(14,165,233,0.14),transparent_40%)]" />
      <div className="relative w-full max-w-md">
        <Link to="/" className="mb-6 flex items-center justify-center gap-2 text-sm font-semibold text-orange-300">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-orange-400 text-lg text-orange-950">C</span>
          Casper Requests
        </Link>
        <main className="rounded-3xl border border-white/10 bg-slate-900/85 p-6 shadow-2xl shadow-black/30 backdrop-blur sm:p-8">
          <h1 className="text-2xl font-bold tracking-tight text-white">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">{subtitle}</p>
          <div className="mt-6">{children}</div>
        </main>
        <footer className="mt-5 flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs text-slate-500">
          <Link to="/terms" className="hover:text-slate-300">Terms</Link>
          <Link to="/privacy" className="hover:text-slate-300">Privacy</Link>
          <Link to="/acceptable-use" className="hover:text-slate-300">Acceptable Use</Link>
          <Link to="/support" className="hover:text-slate-300">Support</Link>
          <Link to="/status" className="hover:text-slate-300">Status</Link>
        </footer>
      </div>
    </div>
  );
}
