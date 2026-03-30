import type { CSSProperties, ReactNode } from "react";
import type { EventRecord } from "../types";

export function BrandedLayout({
  event,
  title,
  subtitle,
  children,
}: {
  event: EventRecord;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const headerLogoUrl = event.djLogoUrl ?? event.venueLogoUrl;
  const headerLogoAlt = event.djLogoUrl ? `${event.djBrandName} logo` : `${event.venueName} logo`;

  return (
    <div
      className="brand-bg min-h-screen px-4 py-8 text-slate-100"
      style={
        {
          "--brand-primary": event.primaryColor,
          "--brand-secondary": event.secondaryColor,
        } as CSSProperties
      }
    >
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-6 rounded-2xl border border-white/20 bg-black/25 p-5 backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold">{title}</h1>
              {subtitle ? <p className="mt-1 text-sm text-slate-200/80">{subtitle}</p> : null}
              <p className="mt-2 text-xs uppercase tracking-widest text-slate-200/70">
                {event.venueName} • {event.djBrandName}
              </p>
            </div>
            {headerLogoUrl ? (
              <img
                src={headerLogoUrl}
                alt={headerLogoAlt}
                className="h-14 w-14 shrink-0 rounded-full bg-white/95 object-cover p-1"
              />
            ) : null}
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
