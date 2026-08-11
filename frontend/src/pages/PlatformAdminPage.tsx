import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api } from "../services/api";
import type {
  OrganizationRole,
  PlatformAuditEntry,
  PlatformOrganization,
  PlatformOrganizationAction,
  PlatformOrganizationDetail,
  PlatformSupportSession,
  PlatformSupportView,
  PlatformUser,
  SupportSessionMode,
} from "../types";

type Tab = "overview" | "organizations" | "users" | "support" | "audit";
const TAB_VALUES: Tab[] = ["overview", "organizations", "users", "support", "audit"];

function requestedTab(value: string | null): Tab {
  return TAB_VALUES.includes(value as Tab) ? value as Tab : "overview";
}

type Confirmation = {
  title: string;
  detail: string;
  expectedText?: string;
  execute: (reason: string) => Promise<void>;
};

const inputClass =
  "w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-cyan-400 disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton =
  "rounded-lg border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-200 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50";
const dangerButton =
  "rounded-lg border border-rose-400/40 px-3 py-2 text-sm font-semibold text-rose-300 hover:bg-rose-400/10 disabled:cursor-not-allowed disabled:opacity-50";

function Card({
  title,
  description,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-white/10 bg-slate-900/80 p-5 ${className}`}>
      <h2 className="text-lg font-semibold">{title}</h2>
      {description ? <p className="mt-1 text-sm text-slate-400">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function StatusPill({ value }: { value?: string }) {
  const normalized = value ?? "unknown";
  const positive = ["active", "enabled", "trialing", "healthy", "success"].includes(normalized);
  const negative = [
    "suspended",
    "disabled",
    "past_due",
    "unpaid",
    "canceled",
    "alarm",
    "degraded",
    "failure",
    "revoked",
    "expired",
  ].includes(normalized);
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
        positive
          ? "bg-emerald-400/15 text-emerald-300"
          : negative
            ? "bg-rose-400/15 text-rose-300"
            : "bg-slate-700 text-slate-300"
      }`}
    >
      {normalized.replaceAll("_", " ")}
    </span>
  );
}

function MetricGrid({ data, empty }: { data?: Record<string, unknown>; empty: string }) {
  const values = Object.entries(data ?? {}).filter(([, value]) => {
    return ["string", "number", "boolean"].includes(typeof value) || value === null;
  });
  if (!values.length) return <p className="text-sm text-slate-500">{empty}</p>;
  return (
    <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {values.map(([key, value]) => (
        <div key={key} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {key.replaceAll("_", " ")}
          </dt>
          <dd className="mt-1 break-words text-lg font-semibold">
            {value === null ? "—" : typeof value === "boolean" ? (value ? "Yes" : "No") : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function formatDate(value?: string | number) {
  if (!value) return "—";
  const normalized = typeof value === "number" && value < 10_000_000_000 ? value * 1000 : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function redactSupportData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSupportData);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !/(password|secret|token|credential|authorization)/i.test(key))
      .map(([key, nested]) => [key, redactSupportData(nested)]),
  );
}

function ConfirmationDialog({
  operation,
  busy,
  onClose,
}: {
  operation: Confirmation;
  busy: boolean;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const valid = reason.trim().length > 0 && (!operation.expectedText || typed === operation.expectedText);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    await operation.execute(reason.trim()).catch(() => undefined);
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="platform-confirm-title"
    >
      <form onSubmit={(event) => void submit(event)} className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <h2 id="platform-confirm-title" className="text-xl font-semibold">{operation.title}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-400">{operation.detail}</p>
        <label className="mt-5 block text-sm font-medium">
          Audit reason
          <textarea
            className={`${inputClass} mt-2`}
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Explain why this platform action is necessary"
            required
            autoFocus
          />
        </label>
        {operation.expectedText ? (
          <label className="mt-4 block text-sm font-medium">
            Type <strong className="text-rose-300">{operation.expectedText}</strong> to confirm
            <input
              className={`${inputClass} mt-2`}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              required
            />
          </label>
        ) : null}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className={secondaryButton} onClick={onClose} disabled={busy}>Cancel</button>
          <button
            type="submit"
            disabled={!valid || busy}
            className="rounded-lg bg-rose-400 px-4 py-2 font-semibold text-rose-950 disabled:opacity-50"
          >
            {busy ? "Applying..." : "Confirm action"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function PlatformAdminPage() {
  const {
    session,
    platformAccess,
    supportSession,
    startSupportSession,
    endSupportSession,
    logout,
  } = useAuth();
  const token = session?.idToken ?? "";
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => requestedTab(searchParams.get("tab")));
  const [summary, setSummary] = useState<Record<string, unknown>>({});
  const [organizations, setOrganizations] = useState<PlatformOrganization[]>([]);
  const [organizationCursor, setOrganizationCursor] = useState<string>();
  const [organizationQuery, setOrganizationQuery] = useState("");
  const [organizationStatus, setOrganizationStatus] = useState("");
  const [organizationPlan, setOrganizationPlan] = useState("");
  const [selectedOrganizationId, setSelectedOrganizationId] = useState("");
  const [detail, setDetail] = useState<PlatformOrganizationDetail | null>(null);
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [userCursor, setUserCursor] = useState<string>();
  const [userQuery, setUserQuery] = useState("");
  const [audit, setAudit] = useState<PlatformAuditEntry[]>([]);
  const [supportSessions, setSupportSessions] = useState<PlatformSupportSession[]>([]);
  const [supportView, setSupportView] = useState<PlatformSupportView | null>(null);
  const [loading, setLoading] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [invite, setInvite] = useState({ email: "", role: "dj" as "admin" | "dj", reason: "" });
  const [createdInviteUrl, setCreatedInviteUrl] = useState("");
  const [planId, setPlanId] = useState("dj");
  const [trialDays, setTrialDays] = useState(7);
  const [supportForm, setSupportForm] = useState<{
    organizationId: string;
    targetUserId: string;
    mode: SupportSessionMode;
    reason: string;
    durationMinutes: number;
  }>({
    organizationId: "",
    targetUserId: "",
    mode: "read_only",
    reason: "",
    durationMinutes: 30,
  });

  function selectTab(nextTab: Tab) {
    setTab(nextTab);
    setSearchParams(nextTab === "overview" ? {} : { tab: nextTab }, { replace: true });
  }

  useEffect(() => {
    setTab(requestedTab(searchParams.get("tab")));
  }, [searchParams]);

  const run = useCallback(async (key: string, action: () => Promise<void>) => {
    setLoading(key);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (caught) {
      setError((caught as Error).message);
      throw caught;
    } finally {
      setLoading("");
    }
  }, []);

  const loadSummary = useCallback(async () => {
    if (!token) return;
    await run("summary", async () => {
      const result = await api.getPlatformSummary(token);
      setSummary(result.summary ?? {});
    }).catch(() => undefined);
  }, [run, token]);

  const loadOrganizations = useCallback(async (append = false, cursor?: string) => {
    if (!token) return;
    await run("organizations", async () => {
      const result = await api.getPlatformOrganizations(
        {
          q: organizationQuery.trim() || undefined,
          status: organizationStatus || undefined,
          plan: organizationPlan || undefined,
          limit: 50,
          cursor,
        },
        token,
      );
      setOrganizations((current) => append ? [...current, ...(result.organizations ?? [])] : result.organizations ?? []);
      setOrganizationCursor(result.nextCursor);
    }).catch(() => undefined);
  }, [organizationPlan, organizationQuery, organizationStatus, run, token]);

  const loadDetail = useCallback(async (organizationId: string) => {
    if (!token || !organizationId) return;
    await run("detail", async () => {
      const result = await api.getPlatformOrganization(organizationId, token);
      setDetail({
        ...result,
        members: result.members ?? [],
        invitations: result.invitations ?? [],
        events: result.events ?? [],
        devices: result.devices ?? [],
        usage: result.usage ?? {},
        analytics: result.analytics ?? {},
        billing: result.billing ?? {},
        recentAudit: result.recentAudit ?? [],
      });
      setPlanId(String(result.billing?.planId ?? result.organization.planId ?? "dj"));
    }).catch(() => undefined);
  }, [run, token]);

  const loadUsers = useCallback(async (append = false, cursor?: string) => {
    if (!token) return;
    await run("users", async () => {
      const result = await api.getPlatformUsers(
        { q: userQuery.trim() || undefined, limit: 50, cursor },
        token,
      );
      setUsers((current) => append ? [...current, ...(result.users ?? [])] : result.users ?? []);
      setUserCursor(result.nextCursor);
    }).catch(() => undefined);
  }, [run, token, userQuery]);

  const loadAudit = useCallback(async () => {
    if (!token) return;
    await run("audit", async () => {
      const result = await api.getPlatformAudit(token);
      setAudit(Array.isArray(result) ? result : result.audit ?? result.entries ?? []);
    }).catch(() => undefined);
  }, [run, token]);

  const loadSupportSessions = useCallback(async () => {
    if (!token) return;
    await run("support-list", async () => {
      const result = await api.getPlatformSupportSessions(token);
      setSupportSessions(
        Array.isArray(result) ? result : result.supportSessions ?? result.sessions ?? [],
      );
    }).catch(() => undefined);
  }, [run, token]);

  useEffect(() => {
    if (supportSession) {
      setTab("support");
      setSearchParams({ tab: "support" }, { replace: true });
      return;
    }
    void Promise.all([loadSummary(), loadOrganizations()]);
  }, [loadOrganizations, loadSummary, setSearchParams, supportSession]);

  useEffect(() => {
    if (!supportSession && selectedOrganizationId) void loadDetail(selectedOrganizationId);
  }, [loadDetail, selectedOrganizationId, supportSession]);

  useEffect(() => {
    if (supportSession && tab !== "support") return;
    if (tab === "users" && !users.length) void loadUsers();
    if (tab === "audit" && !audit.length) void loadAudit();
    if (tab === "support" && !supportSessions.length) void loadSupportSessions();
  }, [audit.length, loadAudit, loadSupportSessions, loadUsers, supportSession, supportSessions.length, tab, users.length]);

  useEffect(() => {
    if (!supportSession || !token) {
      setSupportView(null);
      return;
    }
    void run("support-view", async () => {
      setSupportView(await api.getPlatformSupportView(supportSession.supportSessionId, token));
    }).catch(() => undefined);
  }, [run, supportSession, token]);

  const legacyProtected = Boolean(
    detail
    && (
      detail.organization.organizationId === "mapl-legacy"
      || detail.organization.accountMode !== "saas"
    ),
  );

  const stripeAvailable = useMemo(() => {
    if (!detail) return false;
    if (legacyProtected) return false;
    const serverValue = detail.billing?.stripeAvailable;
    return typeof serverValue === "boolean"
      ? serverValue
      : import.meta.env.VITE_STRIPE_ENABLED === "true";
  }, [detail, legacyProtected]);

  function supportAllowsWrite(organizationId?: string): boolean {
    if (!supportSession) return true;
    if (supportSession.mode !== "support_write") {
      setError("This support session is read-only. End it or start an explicitly elevated support-write session.");
      return false;
    }
    if (!organizationId || supportSession.organizationId !== organizationId) {
      setError("Support-write mode is limited to its selected organization.");
      return false;
    }
    return true;
  }

  function openOrganizationAction(
    action: PlatformOrganizationAction,
    title: string,
    detailText: string,
    expectedText?: string,
    extra?: { planId?: string; days?: number },
  ) {
    if (!detail) return;
    if (legacyProtected) {
      setError("Legacy MAPL account lifecycle and billing are protected from platform changes.");
      return;
    }
    if (supportSession) {
      setError("End customer support mode before changing platform account, billing, trial, or deletion state.");
      return;
    }
    setConfirmation({
      title,
      detail: detailText,
      expectedText,
      execute: async (reason) => {
        await run(`organization-${action}`, async () => {
          await api.updatePlatformOrganization(
            detail.organization.organizationId,
            { action, reason, ...extra },
            token,
          );
          await Promise.all([
            loadDetail(detail.organization.organizationId),
            loadOrganizations(),
            loadSummary(),
          ]);
          setNotice(`${title} completed.`);
          setConfirmation(null);
        });
      },
    });
  }

  function openMemberAction(
    userId: string,
    label: string,
    payload: { role?: OrganizationRole; transferOwnership?: boolean },
    expectedText?: string,
  ) {
    if (!detail) return;
    if (!supportAllowsWrite(detail.organization.organizationId)) return;
    setConfirmation({
      title: label,
      detail: `Apply this member change in ${detail.organization.name}.`,
      expectedText,
      execute: async (reason) => {
        await run(`member-${userId}`, async () => {
          await api.updatePlatformMember(detail.organization.organizationId, userId, { ...payload, reason }, token);
          await loadDetail(detail.organization.organizationId);
          setNotice(`${label} completed.`);
          setConfirmation(null);
        });
      },
    });
  }

  function openRemoveMember(userId: string, identity: string) {
    if (!detail) return;
    if (!supportAllowsWrite(detail.organization.organizationId)) return;
    setConfirmation({
      title: "Remove organization member",
      detail: `Remove ${identity} from ${detail.organization.name}.`,
      expectedText: identity,
      execute: async (reason) => {
        await run(`member-${userId}`, async () => {
          await api.removePlatformMember(detail.organization.organizationId, userId, reason, token);
          await loadDetail(detail.organization.organizationId);
          setNotice("Member removed.");
          setConfirmation(null);
        });
      },
    });
  }

  function openUserAction(user: PlatformUser, action: "disable" | "enable" | "reset_password") {
    if (supportSession) {
      setError("End customer support mode before changing a global Cognito user.");
      return;
    }
    const identity = user.email ?? user.userId;
    setConfirmation({
      title: `${action.replace("_", " ")} user`,
      detail: `${action.replace("_", " ")} for ${identity}. Password reset sends the normal secure reset flow; customer passwords are never displayed.`,
      expectedText: action === "disable" ? identity : undefined,
      execute: async (reason) => {
        await run(`user-${user.userId}`, async () => {
          await api.runPlatformUserAction(user.userId, { action, reason }, token);
          await loadUsers();
          setNotice(`User action "${action.replace("_", " ")}" completed.`);
          setConfirmation(null);
        });
      },
    });
  }

  async function submitInvitation(event: FormEvent) {
    event.preventDefault();
    if (!detail || !invite.reason.trim()) return;
    if (!supportAllowsWrite(detail.organization.organizationId)) return;
    await run("invite", async () => {
      const result = await api.createPlatformInvitation(
        detail.organization.organizationId,
        { email: invite.email.trim(), role: invite.role, reason: invite.reason.trim() },
        token,
      );
      setCreatedInviteUrl(result.invitation.inviteUrl ?? "");
      setInvite({ email: "", role: "dj", reason: "" });
      await loadDetail(detail.organization.organizationId);
      setNotice("Invitation created.");
    }).catch(() => undefined);
  }

  async function submitSupportSession(event: FormEvent) {
    event.preventDefault();
    const durationMinutes = Math.min(60, Math.max(1, supportForm.durationMinutes));
    await run("support-start", async () => {
      await startSupportSession({
        organizationId: supportForm.organizationId,
        targetUserId: supportForm.targetUserId.trim() || undefined,
        mode: supportForm.mode,
        reason: supportForm.reason.trim(),
        durationMinutes,
      });
      setSupportForm((current) => ({ ...current, targetUserId: "", reason: "", durationMinutes }));
      await loadSupportSessions();
      setNotice("Support session started. Every action remains explicitly audited.");
    }).catch(() => undefined);
  }

  async function revokeSupportSession(supportSessionId: string) {
    await run(`support-end-${supportSessionId}`, async () => {
      if (supportSession?.supportSessionId === supportSessionId) {
        await endSupportSession();
        setSupportView(null);
      } else {
        await api.endPlatformSupportSession(supportSessionId, token);
      }
      await loadSupportSessions();
      setNotice("Support session ended immediately.");
    }).catch(() => undefined);
  }

  async function downloadExport() {
    if (!detail) return;
    await run("export", async () => {
      const data = await api.getPlatformOrganizationExport(detail.organization.organizationId, token);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${detail.organization.slug || detail.organization.organizationId}-platform-export.json`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice("Organization export downloaded.");
    }).catch(() => undefined);
  }

  const tabs: Array<[Tab, string]> = [
    ["overview", "Overview"],
    ["organizations", "Organizations"],
    ["users", "Users"],
    ["support", "Support sessions"],
    ["audit", "Audit history"],
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <title>Platform Admin — Casper Requests</title>
      <header className="border-b border-white/10 bg-slate-950/95 px-4 py-4">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">MAPL operations</p>
            <h1 className="mt-1 text-2xl font-bold">Platform Admin</h1>
          </div>
          <nav aria-label="Account destinations" className="flex flex-wrap items-center gap-2">
            <Link className={secondaryButton} to="/admin">Legacy admin</Link>
            <Link className={secondaryButton} to="/console">Customer console</Link>
            <span className="hidden text-xs text-slate-500 lg:inline">
              {platformAccess?.email} · {platformAccess?.role}
            </span>
            <button className={secondaryButton} onClick={logout}>Sign out</button>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-6 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Platform admin sections">
          {tabs.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => selectTab(value)}
              disabled={Boolean(supportSession && value !== "support")}
              className={`whitespace-nowrap rounded-xl px-4 py-2 text-sm font-semibold ${
                tab === value ? "bg-cyan-300 text-slate-950" : "border border-slate-700 text-slate-300"
              } disabled:cursor-not-allowed disabled:opacity-40`}
            >
              {label}
            </button>
          ))}
        </div>

        {error ? (
          <div role="alert" className="mb-5 rounded-xl border border-rose-400/40 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div role="status" className="mb-5 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">
            {notice}
          </div>
        ) : null}

        {tab === "overview" ? (
          <div className="space-y-5">
            <Card title="Platform health" description="Current account, billing, usage, and service indicators returned by the platform API.">
              {loading === "summary" ? <p className="text-sm text-slate-400">Loading platform health...</p> : (
                <MetricGrid data={summary} empty="No summary metrics were returned." />
              )}
            </Card>
            <div className="grid gap-5 lg:grid-cols-3">
              <Card title="Account status">
                <MetricGrid data={asRecord(summary.status)} empty="No account status data." />
              </Card>
              <Card title="Plans">
                <MetricGrid data={asRecord(summary.plan)} empty="No plan data." />
              </Card>
              <Card title="Current usage">
                <MetricGrid data={asRecord(summary.usage)} empty="No usage counters." />
              </Card>
            </div>
            <Card title="Infrastructure health" description="Active CloudWatch alarms and asynchronous failure-queue depth.">
              <MetricGrid data={asRecord(summary.health)} empty="No infrastructure health data." />
              {asRecordArray(asRecord(summary.health).activeAlarms).length ? (
                <div className="mt-4 space-y-2">
                  {asRecordArray(asRecord(summary.health).activeAlarms).map((alarm, index) => (
                    <div key={String(alarm.name ?? index)} className="rounded-xl bg-rose-400/10 p-3 text-sm text-rose-200">
                      <p className="font-semibold">{String(alarm.name ?? "CloudWatch alarm")}</p>
                      <p className="mt-1 text-xs text-rose-200/70">{String(alarm.reason ?? "")}</p>
                    </div>
                  ))}
                </div>
              ) : null}
            </Card>
            <div className="grid gap-5 lg:grid-cols-2">
              <Card title="Organizations" description="Search and manage tenant lifecycle, access, billing, usage, and data.">
                <p className="text-3xl font-bold">{organizations.length}</p>
                <button className={`${secondaryButton} mt-4`} onClick={() => selectTab("organizations")}>Open organizations</button>
              </Card>
              <Card title="Active support mode" description="Support access is time-limited, reason-bound, and audited.">
                {supportSession ? (
                  <div>
                    <StatusPill value={supportSession.mode} />
                    <p className="mt-3 text-sm">{supportSession.organizationName ?? supportSession.organizationId}</p>
                    <button className={`${dangerButton} mt-4`} onClick={() => void endSupportSession().catch(() => undefined)}>End immediately</button>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">No active support session.</p>
                )}
              </Card>
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              <Card title="Recent event activity">
                <div className="space-y-2">
                  {asRecordArray(summary.recentEvents).map((eventRecord, index) => (
                    <div key={String(eventRecord.eventId ?? index)} className="rounded-xl bg-slate-950/60 p-3 text-sm">
                      <div className="flex justify-between gap-3">
                        <span className="font-medium">{String(eventRecord.name ?? eventRecord.eventId ?? "Event")}</span>
                        <StatusPill value={eventRecord.isActive === true ? "active" : "inactive"} />
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{formatDate(eventRecord.updatedAt as string | undefined)}</p>
                    </div>
                  ))}
                  {!asRecordArray(summary.recentEvents).length ? <p className="text-sm text-slate-500">No event activity.</p> : null}
                </div>
              </Card>
              <Card title="Recent platform operations">
                <div className="space-y-2">
                  {asRecordArray(summary.activity).map((entry, index) => (
                    <div key={String(entry.recordId ?? index)} className="rounded-xl bg-slate-950/60 p-3 text-sm">
                      <div className="flex justify-between gap-3">
                        <span className="font-medium">{String(entry.action ?? "Platform action")}</span>
                        <StatusPill value={String(entry.outcome ?? "success")} />
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{String(entry.actorEmail ?? "system")} · {formatDate(entry.createdAt as string | undefined)}</p>
                    </div>
                  ))}
                  {!asRecordArray(summary.activity).length ? <p className="text-sm text-slate-500">No platform operations.</p> : null}
                </div>
              </Card>
            </div>
          </div>
        ) : null}

        {tab === "organizations" ? (
          <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
            <Card title="Organizations" description="Search by name, slug, or organization ID.">
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void loadOrganizations();
                }}
              >
                <input className={inputClass} value={organizationQuery} onChange={(event) => setOrganizationQuery(event.target.value)} placeholder="Search organizations" />
                <div className="grid grid-cols-2 gap-2">
                  <select className={inputClass} value={organizationStatus} onChange={(event) => setOrganizationStatus(event.target.value)} aria-label="Organization status">
                    <option value="">All statuses</option>
                    <option value="active">Active</option>
                    <option value="suspended">Suspended</option>
                    <option value="deletion_pending">Deletion pending</option>
                  </select>
                  <select className={inputClass} value={organizationPlan} onChange={(event) => setOrganizationPlan(event.target.value)} aria-label="Organization plan">
                    <option value="">All plans</option>
                    <option value="legacy">Legacy</option>
                    <option value="dj">DJ</option>
                    <option value="organization">Organization</option>
                  </select>
                </div>
                <button className="w-full rounded-xl bg-cyan-300 px-3 py-2.5 font-semibold text-slate-950" disabled={loading === "organizations"}>
                  {loading === "organizations" ? "Searching..." : "Search"}
                </button>
              </form>
              <div className="mt-4 max-h-[65vh] space-y-2 overflow-y-auto pr-1">
                {organizations.map((organization) => (
                  <button
                    key={organization.organizationId}
                    type="button"
                    onClick={() => {
                      setSelectedOrganizationId(organization.organizationId);
                      setCreatedInviteUrl("");
                      setSupportForm((current) => ({ ...current, organizationId: organization.organizationId }));
                    }}
                    className={`w-full rounded-xl border p-3 text-left ${
                      selectedOrganizationId === organization.organizationId
                        ? "border-cyan-300 bg-cyan-300/10"
                        : "border-slate-800 bg-slate-950/50 hover:border-slate-600"
                    }`}
                  >
                    <span className="block truncate font-semibold">{organization.name}</span>
                    <span className="mt-1 block truncate text-xs text-slate-500">{organization.slug} · {organization.organizationId}</span>
                    <span className="mt-2 flex items-center gap-2">
                      <StatusPill value={organization.accountStatus} />
                      <span className="text-xs text-slate-400">{organization.planId ?? organization.plan ?? "no plan"}</span>
                    </span>
                  </button>
                ))}
                {!organizations.length && loading !== "organizations" ? <p className="text-sm text-slate-500">No organizations found.</p> : null}
              </div>
              {organizationCursor ? (
                <button className={`${secondaryButton} mt-3 w-full`} onClick={() => void loadOrganizations(true, organizationCursor)}>Load more</button>
              ) : null}
            </Card>

            <div className="min-w-0 space-y-5">
              {!selectedOrganizationId ? (
                <Card title="Organization detail"><p className="text-sm text-slate-500">Select an organization to inspect and manage it.</p></Card>
              ) : loading === "detail" && !detail ? (
                <Card title="Organization detail"><p className="text-sm text-slate-400">Loading organization...</p></Card>
              ) : detail ? (
                <>
                  <Card title={detail.organization.name} description={`${detail.organization.slug} · ${detail.organization.organizationId}`}>
                    <div className="flex flex-wrap gap-2">
                      <StatusPill value={detail.organization.accountStatus} />
                      <StatusPill value={detail.organization.subscriptionStatus ?? detail.organization.billingStatus} />
                      <StatusPill value={String(detail.organization.planId ?? detail.organization.plan ?? "no plan")} />
                    </div>
                    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                      <div><dt className="text-slate-500">Owner</dt><dd className="mt-1 break-all">{detail.organization.ownerEmail ?? "—"}</dd></div>
                      <div><dt className="text-slate-500">Created</dt><dd className="mt-1">{formatDate(detail.organization.createdAt)}</dd></div>
                      <div><dt className="text-slate-500">Members</dt><dd className="mt-1">{detail.members.length}</dd></div>
                      <div><dt className="text-slate-500">Events / devices</dt><dd className="mt-1">{detail.events.length} / {detail.devices.length}</dd></div>
                    </dl>
                  </Card>

                  <div className="grid gap-5 lg:grid-cols-2">
                    <Card
                      title="Lifecycle"
                      description={legacyProtected
                        ? "Legacy MAPL lifecycle is protected from SaaS platform mutations."
                        : "Every platform lifecycle change requires an audit reason."}
                    >
                      <div className="flex flex-wrap gap-2">
                        {detail.organization.accountStatus === "suspended" ? (
                          <button className={secondaryButton} disabled={legacyProtected} onClick={() => openOrganizationAction("reactivate", "Reactivate organization", "Restore tenant access.")}>Reactivate</button>
                        ) : (
                          <button className={dangerButton} disabled={legacyProtected} onClick={() => openOrganizationAction("suspend", "Suspend organization", "Block tenant access while preserving data.")}>Suspend</button>
                        )}
                        <button className={secondaryButton} disabled={legacyProtected} onClick={() => openOrganizationAction("extend_trial", "Extend trial", `Extend the trial by ${trialDays} days.`, undefined, { days: trialDays })}>Extend trial</button>
                        <input
                          className={`${inputClass} w-24`}
                          type="number"
                          min={1}
                          max={365}
                          aria-label="Trial extension days"
                          disabled={legacyProtected}
                          value={trialDays}
                          onChange={(event) => setTrialDays(Number(event.target.value))}
                        />
                      </div>
                      <div className="mt-4 border-t border-slate-800 pt-4">
                        {detail.organization.accountStatus === "deletion_pending" ? (
                          <button className={secondaryButton} disabled={legacyProtected} onClick={() => openOrganizationAction("cancel_deletion", "Cancel scheduled deletion", "Remove the pending organization deletion.")}>Cancel deletion</button>
                        ) : (
                          <button
                            className={dangerButton}
                            disabled={legacyProtected}
                            onClick={() => openOrganizationAction(
                              "schedule_deletion",
                              "Schedule organization deletion",
                              "Schedule deletion and begin the recovery window.",
                              detail.organization.name,
                            )}
                          >
                            Schedule deletion
                          </button>
                        )}
                      </div>
                    </Card>

                    <Card title="Billing and plan" description={stripeAvailable ? "Stripe billing controls are available." : "Stripe is unavailable; subscription controls are disabled."}>
                      <div className="flex flex-wrap gap-2">
                        <select className={`${inputClass} max-w-48`} value={planId} onChange={(event) => setPlanId(event.target.value)} aria-label="Plan" disabled={!stripeAvailable}>
                          <option value="dj">DJ</option>
                          <option value="organization">Organization</option>
                          <option value="legacy" disabled>Legacy (protected)</option>
                        </select>
                        <button
                          className={secondaryButton}
                          disabled={!stripeAvailable}
                          title={stripeAvailable ? undefined : "Stripe unavailable"}
                          onClick={() => openOrganizationAction("change_plan", "Change billing plan", `Change this organization to the ${planId} plan.`, undefined, { planId })}
                        >
                          {stripeAvailable ? "Change plan" : "Change plan — Stripe unavailable"}
                        </button>
                        <button
                          className={dangerButton}
                          disabled={!stripeAvailable}
                          title={stripeAvailable ? undefined : "Stripe unavailable"}
                          onClick={() => openOrganizationAction("cancel_subscription", "Cancel subscription", "Cancel the active Stripe subscription.", "CANCEL SUBSCRIPTION")}
                        >
                          {stripeAvailable ? "Cancel subscription" : "Cancel — Stripe unavailable"}
                        </button>
                        <button
                          className={secondaryButton}
                          disabled={!stripeAvailable}
                          title={stripeAvailable ? undefined : "Stripe unavailable"}
                          onClick={() => openOrganizationAction("reactivate_subscription", "Reactivate subscription", "Reactivate the Stripe subscription.")}
                        >
                          {stripeAvailable ? "Reactivate subscription" : "Reactivate — Stripe unavailable"}
                        </button>
                      </div>
                      <div className="mt-4"><MetricGrid data={detail.billing} empty="No billing data returned." /></div>
                      {detail.billingEvents?.length ? (
                        <div className="mt-4 border-t border-slate-800 pt-4">
                          <h3 className="text-sm font-semibold">Recent billing events</h3>
                          <div className="mt-2 space-y-2">
                            {detail.billingEvents.slice(0, 5).map((billingEvent, index) => (
                              <div key={String(billingEvent.eventId ?? index)} className="rounded-xl bg-slate-950/60 p-3 text-sm">
                                <div className="flex justify-between gap-3">
                                  <span className="font-medium">{String(billingEvent.eventType ?? "Stripe event")}</span>
                                  <StatusPill value={String(billingEvent.status ?? "unknown")} />
                                </div>
                                <p className="mt-1 text-xs text-slate-500">{formatDate(billingEvent.createdAt as string | number | undefined)}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </Card>
                  </div>

                  <Card title="Members and invitations" description="Platform changes remain separate from customer console controls.">
                    <form onSubmit={(event) => void submitInvitation(event)} className="grid gap-2 md:grid-cols-[1fr_140px_1fr_auto]">
                      <input className={inputClass} type="email" placeholder="member@example.com" value={invite.email} onChange={(event) => setInvite((current) => ({ ...current, email: event.target.value }))} required />
                      <select className={inputClass} value={invite.role} onChange={(event) => setInvite((current) => ({ ...current, role: event.target.value as "admin" | "dj" }))}>
                        <option value="dj">DJ</option>
                        <option value="admin">Admin</option>
                      </select>
                      <input className={inputClass} placeholder="Required invitation reason" value={invite.reason} onChange={(event) => setInvite((current) => ({ ...current, reason: event.target.value }))} required />
                      <button className="rounded-xl bg-cyan-300 px-4 py-2 font-semibold text-slate-950" disabled={loading === "invite"}>Invite</button>
                    </form>
                    {createdInviteUrl ? (
                      <div role="status" className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-cyan-400/30 bg-cyan-400/10 p-3 text-sm">
                        <a className="break-all text-cyan-300 underline" href={createdInviteUrl} target="_blank" rel="noreferrer">
                          {createdInviteUrl}
                        </a>
                        <button
                          type="button"
                          className={secondaryButton}
                          onClick={() => {
                            void navigator.clipboard.writeText(createdInviteUrl)
                              .then(() => setNotice("Invitation link copied."))
                              .catch(() => setError("Could not copy the invitation link."));
                          }}
                        >
                          Copy link
                        </button>
                      </div>
                    ) : null}
                    <div className="mt-5 space-y-2">
                      {detail.members.map((member, index) => {
                        const identity = member.email ?? member.userId ?? `Member ${index + 1}`;
                        return (
                          <div key={`${member.userId ?? identity}-${index}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                            <div className="min-w-0"><p className="truncate text-sm font-medium">{identity}</p><p className="text-xs text-slate-500">{member.userId ?? "No user ID"}</p></div>
                            <div className="flex flex-wrap items-center gap-2">
                              <StatusPill value={member.role} />
                              {member.userId ? (
                                <>
                                  {member.role !== "owner" ? (
                                    <select
                                      className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs"
                                      value={member.role}
                                      aria-label={`Role for ${identity}`}
                                      onChange={(event) => openMemberAction(member.userId!, "Change member role", { role: event.target.value as OrganizationRole })}
                                    >
                                      <option value="dj">DJ</option><option value="admin">Admin</option>
                                    </select>
                                  ) : null}
                                  {member.role !== "owner" ? (
                                    <button className={dangerButton} onClick={() => openRemoveMember(member.userId!, identity)}>Remove</button>
                                  ) : null}
                                  {member.role !== "owner" ? (
                                    <button className={secondaryButton} onClick={() => openMemberAction(member.userId!, "Transfer ownership", { transferOwnership: true }, "TRANSFER OWNERSHIP")}>Make owner</button>
                                  ) : null}
                                </>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                      {!detail.members.length ? <p className="text-sm text-slate-500">No members returned.</p> : null}
                    </div>
                    {detail.invitations.length ? (
                      <div className="mt-5 border-t border-slate-800 pt-4">
                        <h3 className="text-sm font-semibold">Pending invitations</h3>
                        <div className="mt-2 space-y-2">
                          {detail.invitations.map((invitation, index) => (
                            <div key={invitation.invitationId ?? `${invitation.email}-${index}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-950/60 p-3">
                              <span className="text-sm">{invitation.email} · {invitation.role}</span>
                              {invitation.invitationId ? (
                                <button
                                  className={dangerButton}
                                  onClick={() => {
                                    if (!supportAllowsWrite(detail.organization.organizationId)) return;
                                    setConfirmation({
                                      title: "Revoke invitation",
                                      detail: `Revoke the pending invitation for ${invitation.email}.`,
                                      execute: async (reason) => {
                                        await run("invitation", async () => {
                                          await api.revokePlatformInvitation(detail.organization.organizationId, invitation.invitationId!, reason, token);
                                          await loadDetail(detail.organization.organizationId);
                                          setConfirmation(null);
                                          setNotice("Invitation revoked.");
                                        });
                                      },
                                    });
                                  }}
                                >
                                  Revoke
                                </button>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </Card>

                  <div className="grid gap-5 lg:grid-cols-2">
                    <Card title="Events">
                      <div className="space-y-2">
                        {detail.events.map((event) => (
                          <div key={event.eventId} className="rounded-xl bg-slate-950/60 p-3">
                            <div className="flex items-start justify-between gap-2"><span className="font-medium">{event.name}</span><StatusPill value={event.isActive ? "active" : "inactive"} /></div>
                            <p className="mt-1 text-xs text-slate-500">{event.eventId} · {formatDate(event.date)}</p>
                          </div>
                        ))}
                        {!detail.events.length ? <p className="text-sm text-slate-500">No events returned.</p> : null}
                      </div>
                    </Card>
                    <Card title="DJ Bridge devices">
                      <div className="space-y-2">
                        {detail.devices.map((device) => (
                          <div key={device.deviceId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-950/60 p-3">
                            <div><p className="font-medium">{device.name}</p><p className="text-xs text-slate-500">{device.sourceId} · last seen {formatDate(device.lastSeenAt)}</p></div>
                            <button
                              className={dangerButton}
                              onClick={() => {
                                if (!supportAllowsWrite(detail.organization.organizationId)) return;
                                setConfirmation({
                                  title: "Revoke Bridge device",
                                  detail: `Disconnect ${device.name} immediately.`,
                                  execute: async (reason) => {
                                    await run(`device-${device.deviceId}`, async () => {
                                      await api.revokePlatformDevice(detail.organization.organizationId, device.deviceId, reason, token);
                                      await loadDetail(detail.organization.organizationId);
                                      setConfirmation(null);
                                      setNotice("Device revoked.");
                                    });
                                  },
                                });
                              }}
                            >
                              Revoke
                            </button>
                          </div>
                        ))}
                        {!detail.devices.length ? <p className="text-sm text-slate-500">No devices returned.</p> : null}
                      </div>
                    </Card>
                  </div>

                  <div className="grid gap-5 lg:grid-cols-3">
                    <Card title="Usage"><MetricGrid data={detail.usage} empty="No usage metrics returned." /></Card>
                    <Card title="Analytics"><MetricGrid data={detail.analytics} empty="No analytics returned." /></Card>
                    <Card title="Account health"><MetricGrid data={detail.health} empty="No account health returned." /></Card>
                  </div>

                  <div className="grid gap-5 lg:grid-cols-2">
                    <Card title="Export and data lifecycle" description="Exports are downloaded locally as JSON.">
                      <button className={secondaryButton} onClick={() => void downloadExport()} disabled={loading === "export"}>
                        {loading === "export" ? "Preparing export..." : "Download organization export"}
                      </button>
                    </Card>
                    <Card title="Recent organization audit">
                      <div className="space-y-2">
                        {detail.recentAudit.slice(0, 10).map((entry, index) => (
                          <div key={entry.auditId ?? entry.id ?? index} className="rounded-xl bg-slate-950/60 p-3 text-sm">
                            <div className="flex justify-between gap-3"><span className="font-medium">{entry.action}</span><span className="text-xs text-slate-500">{formatDate(entry.createdAt ?? entry.timestamp)}</span></div>
                            <p className="mt-1 text-xs text-slate-400">{entry.actorEmail ?? entry.actorUserId ?? "system"} · {entry.reason ?? "No reason returned"}</p>
                          </div>
                        ))}
                        {!detail.recentAudit.length ? <p className="text-sm text-slate-500">No recent audit entries.</p> : null}
                      </div>
                    </Card>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        ) : null}

        {tab === "users" ? (
          <Card title="Platform users" description="Search users and run explicit account actions. Passwords are never requested or shown.">
            <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); void loadUsers(); }}>
              <input className={inputClass} value={userQuery} onChange={(event) => setUserQuery(event.target.value)} placeholder="Search email or user ID" />
              <button className="rounded-xl bg-cyan-300 px-5 py-2 font-semibold text-slate-950" disabled={loading === "users"}>Search</button>
            </form>
            <div className="mt-5 space-y-2">
              {users.map((user) => (
                <div key={user.userId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                  <div className="min-w-0"><p className="truncate font-medium">{user.email ?? "No email returned"}</p><p className="text-xs text-slate-500">{user.userId} · last login {formatDate(user.lastLoginAt)}</p></div>
                  <div className="flex flex-wrap gap-2">
                    <StatusPill value={user.enabled === false ? "disabled" : user.status ?? "enabled"} />
                    {user.enabled === false || user.status === "disabled" ? (
                      <button className={secondaryButton} onClick={() => openUserAction(user, "enable")}>Enable</button>
                    ) : (
                      <button className={dangerButton} onClick={() => openUserAction(user, "disable")}>Disable</button>
                    )}
                    <button className={secondaryButton} onClick={() => openUserAction(user, "reset_password")}>Send password reset</button>
                  </div>
                </div>
              ))}
              {!users.length && loading !== "users" ? <p className="text-sm text-slate-500">No users found.</p> : null}
            </div>
            {userCursor ? <button className={`${secondaryButton} mt-4`} onClick={() => void loadUsers(true, userCursor)}>Load more</button> : null}
          </Card>
        ) : null}

        {tab === "support" ? (
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Start support session" description="Time-limited customer context. Maximum duration is 60 minutes.">
              {supportSession ? (
                <div className="rounded-xl border border-amber-300/40 bg-amber-300/10 p-4">
                  <p className="font-semibold">A support session is already active.</p>
                  <p className="mt-1 text-sm text-amber-100">{supportSession.organizationName ?? supportSession.organizationId} · {supportSession.mode.replace("_", " ")}</p>
                  <button className={`${dangerButton} mt-4`} onClick={() => void endSupportSession().catch(() => undefined)}>End active session</button>
                </div>
              ) : (
                <form onSubmit={(event) => void submitSupportSession(event)} className="space-y-3">
                  <label className="block text-sm">Organization
                    <select className={`${inputClass} mt-1.5`} value={supportForm.organizationId} onChange={(event) => setSupportForm((current) => ({ ...current, organizationId: event.target.value }))} required>
                      <option value="">Choose organization</option>
                      {organizations.map((organization) => <option key={organization.organizationId} value={organization.organizationId}>{organization.name}</option>)}
                    </select>
                  </label>
                  <label className="block text-sm">Target user ID <span className="text-slate-500">(optional)</span>
                    <input className={`${inputClass} mt-1.5`} value={supportForm.targetUserId} onChange={(event) => setSupportForm((current) => ({ ...current, targetUserId: event.target.value }))} />
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block text-sm">Mode
                      <select className={`${inputClass} mt-1.5`} value={supportForm.mode} onChange={(event) => setSupportForm((current) => ({ ...current, mode: event.target.value as SupportSessionMode }))}>
                        <option value="read_only">Read only</option>
                        <option value="support_write">Support write</option>
                      </select>
                    </label>
                    <label className="block text-sm">Duration (minutes)
                      <input className={`${inputClass} mt-1.5`} type="number" min={1} max={60} value={supportForm.durationMinutes} onChange={(event) => setSupportForm((current) => ({ ...current, durationMinutes: Number(event.target.value) }))} required />
                    </label>
                  </div>
                  <label className="block text-sm">Required support reason
                    <textarea className={`${inputClass} mt-1.5`} rows={3} value={supportForm.reason} onChange={(event) => setSupportForm((current) => ({ ...current, reason: event.target.value }))} required />
                  </label>
                  <p className="text-xs leading-5 text-slate-500">Support-write does not impersonate the customer. It is limited to invitation, member, and Bridge-device actions for this organization; each mutation still requires an audit reason.</p>
                  <button className="w-full rounded-xl bg-amber-300 px-4 py-2.5 font-semibold text-amber-950" disabled={loading === "support-start"}>{loading === "support-start" ? "Starting..." : "Start support session"}</button>
                </form>
              )}
            </Card>
            <Card title="Customer support view" description="Content returned by the scoped support-session view endpoint.">
              {loading === "support-view" ? <p className="text-sm text-slate-400">Loading scoped customer view...</p> : supportView ? (
                <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-xs leading-5 text-slate-300">
                  {JSON.stringify(redactSupportData(supportView), null, 2)}
                </pre>
              ) : <p className="text-sm text-slate-500">Start a support session to load the scoped customer view.</p>}
            </Card>
            <Card title="Support session history" className="lg:col-span-2">
              <div className="space-y-2">
                {supportSessions.map((item) => (
                  <div key={item.supportSessionId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-950/60 p-4">
                    <div><p className="font-medium">{item.organizationName ?? item.organizationId}</p><p className="mt-1 text-xs text-slate-500">{item.mode.replace("_", " ")} · expires {formatDate(item.expiresAt)} · {item.reason}</p></div>
                    <div className="flex items-center gap-2">
                      <StatusPill value={item.status ?? "recorded"} />
                      {!item.status || item.status === "active" ? (
                        <button
                          className={dangerButton}
                          disabled={loading === `support-end-${item.supportSessionId}`}
                          onClick={() => void revokeSupportSession(item.supportSessionId)}
                        >
                          Revoke now
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
                {!supportSessions.length ? <p className="text-sm text-slate-500">No support sessions returned.</p> : null}
              </div>
            </Card>
          </div>
        ) : null}

        {tab === "audit" ? (
          <Card title="Platform audit history" description="Privileged actions and support activity across organizations.">
            <div className="space-y-2">
              {audit.map((entry, index) => (
                <article key={entry.auditId ?? entry.id ?? index} className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex items-center gap-2"><h3 className="font-semibold">{entry.action}</h3><StatusPill value={entry.outcome ?? "success"} /></div>
                    <time className="text-xs text-slate-500">{formatDate(entry.createdAt ?? entry.timestamp)}</time>
                  </div>
                  <p className="mt-2 text-sm text-slate-400">{entry.actorEmail ?? entry.actorUserId ?? "system"}{entry.sourceIp ? ` · IP ${entry.sourceIp}` : ""}{entry.organizationId ? ` · organization ${entry.organizationId}` : ""}{entry.targetUserId ? ` · user ${entry.targetUserId}` : ""}</p>
                  <p className="mt-1 text-sm text-slate-300">{entry.reason ?? "No reason returned."}</p>
                </article>
              ))}
              {!audit.length && loading !== "audit" ? <p className="text-sm text-slate-500">No audit entries returned.</p> : null}
            </div>
          </Card>
        ) : null}
      </main>

      {confirmation ? (
        <ConfirmationDialog
          operation={confirmation}
          busy={loading !== ""}
          onClose={() => setConfirmation(null)}
        />
      ) : null}
    </div>
  );
}
