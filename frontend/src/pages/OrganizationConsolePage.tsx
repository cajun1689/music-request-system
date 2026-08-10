import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api } from "../services/api";
import type {
  BridgeDevice,
  EventRecord,
  Membership,
  Organization,
  OrganizationRole,
  SaasPlanId,
  StripeConnectStatus,
} from "../types";

const initialEvent = {
  name: "",
  date: new Date().toISOString().slice(0, 10),
  venueName: "",
  djBrandName: "",
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function Card({ title, eyebrow, children }: { title: string; eyebrow?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-slate-900/80 p-5 shadow-lg shadow-black/10 sm:p-6">
      {eyebrow ? <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-300">{eyebrow}</p> : null}
      <h2 className={eyebrow ? "mt-2 text-xl font-semibold" : "text-xl font-semibold"}>{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

const inputClass =
  "mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2.5 text-slate-100 outline-none transition focus:border-orange-400";

export function OrganizationConsolePage() {
  const {
    session,
    organizations,
    memberships,
    activeOrganization,
    activeOrganizationId,
    loadingOrganizations,
    reloadOrganizations,
    setActiveOrganization,
    logout,
  } = useAuth();
  const [organization, setOrganization] = useState<Organization | null>(activeOrganization);
  const [members, setMembers] = useState<Membership[]>([]);
  const [devices, setDevices] = useState<BridgeDevice[]>([]);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [connect, setConnect] = useState<StripeConnectStatus | null>(null);
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [orgForm, setOrgForm] = useState<{ name: string; slug: string; planId: SaasPlanId }>({
    name: "",
    slug: "",
    planId: "dj",
  });
  const [selectedPlan, setSelectedPlan] = useState<SaasPlanId>("dj");
  const [settingsForm, setSettingsForm] = useState({
    name: "",
    slug: "",
    djBrandName: "",
    venueName: "",
    primaryColor: "#0f172a",
    secondaryColor: "#1e293b",
    accentColor: "#f97316",
  });
  const [eventForm, setEventForm] = useState(initialEvent);
  const [inviteForm, setInviteForm] = useState<{
    email: string;
    role: Exclude<OrganizationRole, "owner">;
  }>({ email: "", role: "dj" });
  const [pairForm, setPairForm] = useState({
    eventId: "",
    sourceId: "",
    deviceName: "",
  });
  const [pairingCode, setPairingCode] = useState<{ code: string; expiresAt: number } | null>(null);

  const membership = useMemo(
    () => memberships.find((item) => item.organizationId === activeOrganizationId),
    [activeOrganizationId, memberships],
  );
  const canManage = membership?.role === "owner" || membership?.role === "admin";
  const subscriptionStatus = organization?.subscriptionStatus ?? organization?.billingStatus ?? "inactive";
  const subscriptionActive = subscriptionStatus === "active" || subscriptionStatus === "trialing";
  const connectStatus =
    connect?.status ??
    connect?.connectStatus ??
    connect?.stripeConnectStatus ??
    organization?.connectStatus ??
    organization?.stripeConnectStatus ??
    (connect?.payoutsEnabled ? "active" : "not_started");

  useEffect(() => {
    setOrganization(activeOrganization);
  }, [activeOrganization]);

  useEffect(() => {
    if (!session || !activeOrganizationId) {
      setOrganization(null);
      setMembers([]);
      setEvents([]);
      setDevices([]);
      setConnect(null);
      return;
    }
    let cancelled = false;
    setLoadingWorkspace(true);
    Promise.all([
      api.getOrganization(activeOrganizationId, session.idToken),
      api.getOrganizationMembers(activeOrganizationId, session.idToken),
      api.getOrganizationEvents(activeOrganizationId, session.idToken),
      api.getBridgeDevices(activeOrganizationId, session.idToken),
      api.getStripeConnectStatus(activeOrganizationId, session.idToken).catch(() => null),
    ])
      .then(([nextOrganization, memberResult, eventResult, deviceResult, connectResult]) => {
        if (cancelled) return;
        setOrganization(nextOrganization);
        setMembers(memberResult.members ?? []);
        setEvents(eventResult.events ?? []);
        setPairForm((current) => ({
          ...current,
          eventId: current.eventId || eventResult.events?.[0]?.eventId || "",
        }));
        setDevices(deviceResult.devices ?? []);
        setConnect(connectResult);
        setSelectedPlan(nextOrganization.planId === "organization" ? "organization" : "dj");
        setSettingsForm({
          name: nextOrganization.name,
          slug: nextOrganization.slug,
          djBrandName: nextOrganization.defaults?.djBrandName ?? "",
          venueName: nextOrganization.defaults?.venueName ?? "",
          primaryColor: nextOrganization.branding?.primaryColor ?? "#0f172a",
          secondaryColor: nextOrganization.branding?.secondaryColor ?? "#1e293b",
          accentColor: nextOrganization.branding?.accentColor ?? "#f97316",
        });
      })
      .catch((error: Error) => {
        if (!cancelled) setNotice(`Unable to load workspace: ${error.message}`);
      })
      .finally(() => {
        if (!cancelled) setLoadingWorkspace(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeOrganizationId, session]);

  async function createOrganization(event: FormEvent) {
    event.preventDefault();
    if (!session) return;
    const slug = slugify(orgForm.slug || orgForm.name);
    setBusy("organization");
    setNotice("");
    try {
      const result = await api.createOrganization(
        { name: orgForm.name.trim(), slug, planId: orgForm.planId },
        session.idToken,
      );
      await reloadOrganizations();
      setActiveOrganization(result.organization.organizationId);
      setOrganization(result.organization);
      setSelectedPlan(orgForm.planId);
      setSettingsForm({
        name: result.organization.name,
        slug: result.organization.slug,
        djBrandName: "",
        venueName: "",
        primaryColor: "#0f172a",
        secondaryColor: "#1e293b",
        accentColor: "#f97316",
      });
      setOrgForm({ name: "", slug: "", planId: "dj" });
      setNotice("Workspace created. Next, choose a plan and connect payouts.");
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function updateOrganization(event: FormEvent) {
    event.preventDefault();
    if (!session || !activeOrganizationId) return;
    setBusy("settings");
    setNotice("");
    try {
      const updated = await api.updateOrganization(
        activeOrganizationId,
        {
          name: settingsForm.name.trim(),
          branding: {
            primaryColor: settingsForm.primaryColor,
            secondaryColor: settingsForm.secondaryColor,
            accentColor: settingsForm.accentColor,
          },
          defaults: {
            djBrandName: settingsForm.djBrandName.trim(),
            venueName: settingsForm.venueName.trim(),
          },
        },
        session.idToken,
      );
      setOrganization(updated);
      await reloadOrganizations();
      setNotice("Workspace settings saved.");
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function openCheckout(kind: "checkout" | "portal", planId = selectedPlan) {
    if (!session || !activeOrganizationId) return;
    setBusy(kind);
    setNotice("");
    try {
      const result =
        kind === "checkout"
          ? await api.createBillingCheckout(activeOrganizationId, planId, session.idToken)
          : await api.createBillingPortal(activeOrganizationId, session.idToken);
      window.location.assign(result.url);
    } catch (error) {
      setNotice((error as Error).message);
      setBusy("");
    }
  }

  async function startConnect() {
    if (!session || !activeOrganizationId) return;
    setBusy("connect");
    setNotice("");
    try {
      const result = await api.createStripeConnectOnboarding(activeOrganizationId, session.idToken);
      window.location.assign(result.url);
    } catch (error) {
      setNotice((error as Error).message);
      setBusy("");
    }
  }

  async function refreshConnect() {
    if (!session || !activeOrganizationId) return;
    setBusy("connect-status");
    try {
      setConnect(await api.getStripeConnectStatus(activeOrganizationId, session.idToken));
      setNotice("Payout status refreshed.");
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function createEvent(event: FormEvent) {
    event.preventDefault();
    if (!session || !activeOrganizationId) return;
    setBusy("event");
    setNotice("");
    try {
      const created = await api.createEvent(
        {
          ...eventForm,
          organizationId: activeOrganizationId,
          accountMode: "saas",
          primaryColor: settingsForm.primaryColor,
          secondaryColor: settingsForm.secondaryColor,
          accentColor: settingsForm.accentColor,
        },
        session.idToken,
      );
      setEvents((current) => [created, ...current]);
      setPairForm((current) => ({ ...current, eventId: current.eventId || created.eventId }));
      setEventForm(initialEvent);
      localStorage.setItem("activeEventId", created.eventId);
      setNotice("Event created. Your guest link and DJ dashboard are ready.");
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function inviteMember(event: FormEvent) {
    event.preventDefault();
    if (!session || !activeOrganizationId) return;
    setBusy("invite");
    setNotice("");
    try {
      const invitation = await api.inviteOrganizationMember(
        activeOrganizationId,
        inviteForm,
        session.idToken,
      );
      setInviteForm({ email: "", role: "dj" });
      setInviteUrl(invitation.inviteUrl ?? "");
      setNotice("Invitation created. Copy the secure link below and send it to your teammate.");
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function createPairingCode(event: FormEvent) {
    event.preventDefault();
    if (!session || !pairForm.eventId || !pairForm.sourceId.trim()) return;
    setBusy("pairing");
    setNotice("");
    try {
      const result = await api.createBridgePairingCode(
        {
          eventId: pairForm.eventId,
          sourceId: pairForm.sourceId.trim(),
          deviceName: pairForm.deviceName.trim() || undefined,
        },
        session.idToken,
      );
      setPairingCode(result);
      setNotice("Pairing code created. Enter it in DJ Bridge within 10 minutes.");
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function revokeDevice(deviceId: string) {
    if (!session || !activeOrganizationId) return;
    setBusy(`device-${deviceId}`);
    try {
      await api.revokeBridgeDevice(activeOrganizationId, deviceId, session.idToken);
      setDevices((current) =>
        current.map((device) =>
          device.deviceId === deviceId ? { ...device, status: "revoked" } : device,
        ),
      );
      setNotice("Bridge device disconnected.");
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function updateMemberRole(userId: string, role: "admin" | "dj") {
    if (!session || !activeOrganizationId) return;
    setBusy(`member-${userId}`);
    try {
      const result = await api.updateOrganizationMember(
        activeOrganizationId,
        userId,
        { role },
        session.idToken,
      );
      if (result.membership) {
        setMembers((current) =>
          current.map((member) => (member.userId === userId ? result.membership! : member)),
        );
      }
      setNotice("Team role updated.");
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function removeMember(userId: string) {
    if (!session || !activeOrganizationId || !window.confirm("Remove this teammate?")) return;
    setBusy(`member-${userId}`);
    try {
      await api.removeOrganizationMember(activeOrganizationId, userId, session.idToken);
      setMembers((current) => current.filter((member) => member.userId !== userId));
      setNotice("Team member removed.");
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function transferOwnership(userId: string) {
    if (
      !session
      || !activeOrganizationId
      || !window.confirm("Transfer ownership to this teammate? Your role will become admin.")
    ) return;
    setBusy(`member-${userId}`);
    try {
      await api.updateOrganizationMember(
        activeOrganizationId,
        userId,
        { transferOwnership: true },
        session.idToken,
      );
      const result = await api.getOrganizationMembers(activeOrganizationId, session.idToken);
      setMembers(result.members ?? []);
      await reloadOrganizations();
      setNotice("Organization ownership transferred.");
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function downloadOrganizationExport() {
    if (!session || !activeOrganizationId) return;
    setBusy("export");
    try {
      const data = await api.getOrganizationExport(activeOrganizationId, session.idToken);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `${organization?.slug ?? "casper-requests"}-export.json`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice("Organization export downloaded.");
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function changeDeletionStatus(requestDeletion: boolean) {
    if (!session || !activeOrganizationId) return;
    const message = requestDeletion
      ? "Schedule this organization for deletion in 30 days? New SaaS activity will be blocked."
      : "Cancel the scheduled organization deletion?";
    if (!window.confirm(message)) return;
    setBusy("deletion");
    try {
      const updated = await api.updateOrganization(
        activeOrganizationId,
        requestDeletion ? { requestDeletion: true } : { cancelDeletion: true },
        session.idToken,
      );
      setOrganization(updated);
      setNotice(requestDeletion ? "Deletion scheduled with a 30-day recovery window." : "Deletion canceled.");
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <title>Organization Console — Casper Requests</title>
      <header className="border-b border-white/10 bg-slate-950/90 px-4 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <Link to="/console" className="flex items-center gap-2 font-bold">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-orange-400 text-orange-950">C</span>
            Casper Requests
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            {organizations.length ? (
              <select
                aria-label="Active organization"
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                value={activeOrganizationId ?? ""}
                onChange={(event) => setActiveOrganization(event.target.value)}
              >
                {organizations.map((item) => (
                  <option key={item.organizationId} value={item.organizationId}>{item.name}</option>
                ))}
              </select>
            ) : null}
            <span className="hidden text-sm text-slate-400 sm:inline">{session?.email}</span>
            <button onClick={logout} className="rounded-lg border border-slate-700 px-3 py-2 text-sm">Sign out</button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        {loadingOrganizations ? <p className="text-slate-400">Loading your organizations...</p> : null}
        {!loadingOrganizations && organizations.length === 0 ? (
          <div className="mx-auto max-w-2xl">
            <div className="mb-6">
              <p className="text-sm font-semibold text-orange-300">Welcome to Casper Requests</p>
              <h1 className="mt-2 text-3xl font-bold">Create your DJ workspace</h1>
              <p className="mt-3 text-slate-400">This groups your team, subscription, payouts, and events.</p>
            </div>
            <Card title="Organization details" eyebrow="Step 1 of 4">
              <form onSubmit={createOrganization} className="space-y-4">
                <label className="block text-sm">
                  Organization name
                  <input
                    className={inputClass}
                    placeholder="Night Shift Events"
                    value={orgForm.name}
                    onChange={(event) =>
                      setOrgForm((current) => ({
                        ...current,
                        name: event.target.value,
                        slug: current.slug || slugify(event.target.value),
                      }))
                    }
                    required
                  />
                </label>
                <label className="block text-sm">
                  Workspace URL
                  <div className="mt-1.5 flex rounded-xl border border-slate-700 bg-slate-950/80 focus-within:border-orange-400">
                    <span className="border-r border-slate-700 px-3 py-2.5 text-slate-500">casperrequests.com/</span>
                    <input
                      className="min-w-0 flex-1 bg-transparent px-3 py-2.5 outline-none"
                      value={orgForm.slug}
                      onChange={(event) => setOrgForm((current) => ({ ...current, slug: slugify(event.target.value) }))}
                      required
                    />
                  </div>
                </label>
                <fieldset>
                  <legend className="text-sm font-medium">Choose your plan</legend>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    {([
                      ["dj", "Solo DJ", "$25/month", "1 DJ · 3 Bridge devices · 3 active events"],
                      [
                        "organization",
                        "Club / DJ Organization",
                        "$100/month",
                        "25 team members · 25 devices · 20 active events",
                      ],
                    ] as const).map(([planId, name, price, detail]) => (
                      <label
                        key={planId}
                        className={`cursor-pointer rounded-xl border p-3 ${
                          orgForm.planId === planId
                            ? "border-orange-400 bg-orange-400/10"
                            : "border-slate-700 bg-slate-950/60"
                        }`}
                      >
                        <input
                          className="sr-only"
                          type="radio"
                          name="plan"
                          value={planId}
                          checked={orgForm.planId === planId}
                          onChange={() => setOrgForm((current) => ({ ...current, planId }))}
                        />
                        <span className="block font-semibold">{name}</span>
                        <span className="mt-1 block text-orange-300">{price}</span>
                        <span className="mt-1 block text-xs text-slate-400">{detail}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <button
                  disabled={busy === "organization"}
                  className="w-full rounded-xl bg-orange-400 px-4 py-2.5 font-semibold text-orange-950 disabled:opacity-60"
                >
                  {busy === "organization" ? "Creating..." : "Create workspace"}
                </button>
              </form>
            </Card>
          </div>
        ) : null}

        {organization ? (
          <>
            <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-orange-300">Organization console</p>
                <h1 className="mt-1 text-3xl font-bold">{organization.name}</h1>
                <p className="mt-2 text-sm text-slate-400">
                  {membership?.role ?? "member"} · {events.length} event{events.length === 1 ? "" : "s"}
                </p>
              </div>
              <div className="flex gap-2">
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${subscriptionActive ? "bg-emerald-400/15 text-emerald-300" : "bg-amber-400/15 text-amber-300"}`}>
                  {organization.planId === "organization" ? "$100 Organization" : "$25 DJ"} · {subscriptionStatus}
                </span>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${connectStatus === "active" ? "bg-emerald-400/15 text-emerald-300" : "bg-sky-400/15 text-sky-300"}`}>
                  Payouts: {connectStatus.replace("_", " ")}
                </span>
              </div>
            </div>

            {notice ? (
              <div className="mb-5 rounded-xl border border-sky-400/30 bg-sky-400/10 px-4 py-3 text-sm text-sky-100">
                <p>{notice}</p>
                {inviteUrl && notice.startsWith("Invitation") ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      aria-label="Invitation link"
                      className="min-w-0 flex-1 rounded border border-sky-300/20 bg-slate-950/50 px-2 py-1 font-mono text-xs"
                      value={inviteUrl}
                      readOnly
                    />
                    <button
                      type="button"
                      onClick={() => void navigator.clipboard.writeText(inviteUrl)}
                      className="rounded border border-sky-300/30 px-2 py-1 text-xs"
                    >
                      Copy link
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {loadingWorkspace ? <p className="mb-5 text-sm text-slate-400">Refreshing workspace...</p> : null}

            <div className="grid gap-5 lg:grid-cols-2">
              <Card title="Activate your plan" eyebrow="Step 2 of 4">
                <p className="text-sm leading-6 text-slate-400">
                  Subscription billing unlocks SaaS events, team access, and Stripe-powered guest tips.
                </p>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {([
                    ["dj", "Solo DJ", "$25 / month"],
                    ["organization", "Club / DJ Organization", "$100 / month"],
                  ] as const).map(([planId, name, price]) => (
                    <button
                      key={planId}
                      type="button"
                      onClick={() => setSelectedPlan(planId)}
                      className={`rounded-xl border p-3 text-left ${
                        selectedPlan === planId
                          ? "border-orange-400 bg-orange-400/10"
                          : "border-slate-700 bg-slate-950/60"
                      }`}
                    >
                      <span className="block text-sm font-semibold">{name}</span>
                      <span className="mt-1 block text-sm text-orange-300">{price}</span>
                    </button>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {!subscriptionActive ? (
                    <button
                      onClick={() => void openCheckout("checkout", selectedPlan)}
                      disabled={busy === "checkout"}
                      className="rounded-xl bg-orange-400 px-4 py-2.5 font-semibold text-orange-950 disabled:opacity-60"
                    >
                      {busy === "checkout"
                        ? "Opening..."
                        : `Start ${selectedPlan === "dj" ? "$25 DJ" : "$100 organization"} plan`}
                    </button>
                  ) : null}
                  <button
                    onClick={() => void openCheckout("portal")}
                    disabled={busy === "portal"}
                    className="rounded-xl border border-slate-700 px-4 py-2.5 font-semibold disabled:opacity-60"
                  >
                    Manage billing
                  </button>
                </div>
              </Card>

              <Card title="Connect your payouts" eyebrow="Step 3 of 4">
                <p className="text-sm leading-6 text-slate-400">
                  Stripe Connect sends guest tips to your verified payout account. Casper Requests never sees bank credentials.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    onClick={() => void startConnect()}
                    disabled={busy === "connect" || !subscriptionActive}
                    className="rounded-xl bg-sky-400 px-4 py-2.5 font-semibold text-sky-950 disabled:opacity-60"
                  >
                    {!subscriptionActive
                      ? "Activate a plan first"
                      : connectStatus === "active"
                        ? "Manage payout account"
                        : "Set up payouts"}
                  </button>
                  <button
                    onClick={() => void refreshConnect()}
                    disabled={busy === "connect-status"}
                    className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
                  >
                    Refresh status
                  </button>
                </div>
                {connect?.requirementsDue?.length ? (
                  <p className="mt-3 text-xs text-amber-300">{connect.requirementsDue.length} payout requirement(s) remain.</p>
                ) : null}
              </Card>

              <Card title={events.length ? "Create another event" : "Create your first event"} eyebrow="Step 4 of 4">
                <form onSubmit={createEvent} className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm sm:col-span-2">
                    Event name
                    <input className={inputClass} value={eventForm.name} onChange={(event) => setEventForm((current) => ({ ...current, name: event.target.value }))} required />
                  </label>
                  <label className="block text-sm">
                    Date
                    <input className={inputClass} type="date" value={eventForm.date} onChange={(event) => setEventForm((current) => ({ ...current, date: event.target.value }))} required />
                  </label>
                  <label className="block text-sm">
                    Venue
                    <input className={inputClass} value={eventForm.venueName} onChange={(event) => setEventForm((current) => ({ ...current, venueName: event.target.value }))} required />
                  </label>
                  <label className="block text-sm sm:col-span-2">
                    DJ or brand name
                    <input className={inputClass} value={eventForm.djBrandName} onChange={(event) => setEventForm((current) => ({ ...current, djBrandName: event.target.value }))} required />
                  </label>
                  <button
                    disabled={busy === "event" || !subscriptionActive}
                    className="rounded-xl bg-orange-400 px-4 py-2.5 font-semibold text-orange-950 disabled:opacity-60 sm:col-span-2"
                  >
                    {busy === "event"
                      ? "Creating..."
                      : subscriptionActive
                        ? "Create event"
                        : "Activate a plan first"}
                  </button>
                </form>
              </Card>

              <Card title="Your events">
                {events.length ? (
                  <div className="space-y-3">
                    {events.map((item) => (
                      <div key={item.eventId} className="rounded-xl border border-slate-700 bg-slate-950/60 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold">{item.name}</p>
                            <p className="mt-1 text-xs text-slate-400">{item.venueName} · {item.date}</p>
                          </div>
                          <span className={`rounded-full px-2 py-1 text-xs ${item.isActive ? "bg-emerald-400/15 text-emerald-300" : "bg-slate-700 text-slate-300"}`}>
                            {item.isActive ? "Active" : "Inactive"}
                          </span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Link to={`/dashboard/${item.eventId}`} className="rounded-lg bg-orange-400 px-3 py-1.5 text-sm font-semibold text-orange-950">Dashboard</Link>
                          <Link to={`/analytics/${item.eventId}`} className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm">Analytics</Link>
                          <Link to={`/event/${item.eventId}`} className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm">Guest page</Link>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">Create your first event to get guest and dashboard links.</p>
                )}
              </Card>

              <Card title="DJ Bridge devices">
                <p className="text-sm text-slate-400">
                  Generate a short-lived code, then enter it in DJ Bridge. Each laptop can be disconnected independently.
                </p>
                {canManage && events.length ? (
                  <form onSubmit={createPairingCode} className="mt-4 grid gap-2 sm:grid-cols-2">
                    <select
                      className="rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2.5"
                      value={pairForm.eventId}
                      onChange={(event) =>
                        setPairForm((current) => ({ ...current, eventId: event.target.value }))
                      }
                      required
                    >
                      <option value="">Choose event</option>
                      {events.map((item) => (
                        <option key={item.eventId} value={item.eventId}>{item.name}</option>
                      ))}
                    </select>
                    <input
                      className="rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2.5"
                      placeholder="Source ID, e.g. main-booth"
                      value={pairForm.sourceId}
                      onChange={(event) =>
                        setPairForm((current) => ({ ...current, sourceId: slugify(event.target.value) }))
                      }
                      required
                    />
                    <input
                      className="rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2.5 sm:col-span-2"
                      placeholder="Laptop name (optional)"
                      value={pairForm.deviceName}
                      onChange={(event) =>
                        setPairForm((current) => ({ ...current, deviceName: event.target.value }))
                      }
                    />
                    <button
                      disabled={busy === "pairing" || !subscriptionActive}
                      className="rounded-xl bg-sky-400 px-4 py-2.5 font-semibold text-sky-950 disabled:opacity-50 sm:col-span-2"
                    >
                      {busy === "pairing" ? "Generating..." : "Generate pairing code"}
                    </button>
                  </form>
                ) : null}
                {pairingCode ? (
                  <div className="mt-4 rounded-xl border border-orange-400/40 bg-orange-400/10 p-4 text-center">
                    <p className="text-xs uppercase tracking-widest text-orange-200">DJ Bridge pairing code</p>
                    <p className="mt-2 font-mono text-3xl font-bold tracking-[0.2em]">{pairingCode.code}</p>
                    <p className="mt-2 text-xs text-slate-400">
                      Expires {new Date(pairingCode.expiresAt * 1000).toLocaleTimeString()}
                    </p>
                    <button
                      type="button"
                      onClick={() => void navigator.clipboard.writeText(pairingCode.code)}
                      className="mt-3 rounded-lg border border-orange-300/30 px-3 py-1 text-xs"
                    >
                      Copy code
                    </button>
                  </div>
                ) : null}
                <a
                  className="mt-4 inline-block text-sm text-sky-300 underline"
                  href="https://github.com/cajun1689/music-request-system/releases/latest"
                  target="_blank"
                  rel="noreferrer"
                >
                  Download the latest DJ Bridge
                </a>
                <div className="mt-4 space-y-2">
                  {devices.map((device) => (
                    <div key={device.deviceId} className="flex items-center justify-between gap-3 rounded-xl bg-slate-950/60 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{device.name}</p>
                        <p className="truncate text-xs text-slate-400">
                          {device.sourceId} · {device.lastSeenAt ? `seen ${new Date(device.lastSeenAt).toLocaleString()}` : "not seen yet"}
                        </p>
                      </div>
                      {device.status === "active" && canManage ? (
                        <button
                          type="button"
                          disabled={busy === `device-${device.deviceId}`}
                          onClick={() => void revokeDevice(device.deviceId)}
                          className="rounded-lg border border-red-400/40 px-2 py-1 text-xs text-red-300 disabled:opacity-50"
                        >
                          Disconnect
                        </button>
                      ) : (
                        <span className="text-xs capitalize text-slate-500">{device.status}</span>
                      )}
                    </div>
                  ))}
                  {!devices.length ? <p className="text-sm text-slate-500">No paired devices yet.</p> : null}
                </div>
              </Card>

              <Card title="Team members">
                {canManage && organization.planId === "organization" ? (
                  <form onSubmit={inviteMember} className="mb-4 flex flex-col gap-2 sm:flex-row">
                    <input
                      className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2.5 outline-none focus:border-orange-400"
                      type="email"
                      placeholder="teammate@example.com"
                      value={inviteForm.email}
                      onChange={(event) => setInviteForm((current) => ({ ...current, email: event.target.value }))}
                      required
                    />
                    <select
                      className="rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2.5"
                      value={inviteForm.role}
                      onChange={(event) => setInviteForm((current) => ({ ...current, role: event.target.value as "admin" | "dj" }))}
                    >
                      <option value="dj">DJ</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button disabled={busy === "invite"} className="rounded-xl bg-slate-100 px-4 py-2.5 font-semibold text-slate-950 disabled:opacity-60">
                      Invite
                    </button>
                  </form>
                ) : organization.planId !== "organization" ? (
                  <p className="mb-4 text-sm text-slate-400">
                    The Solo DJ plan includes one login. Choose the Club / DJ Organization plan to invite a team.
                  </p>
                ) : null}
                <div className="space-y-2">
                  {members.map((item, index) => (
                    <div key={`${item.userId ?? item.email ?? "member"}-${index}`} className="flex items-center justify-between gap-3 rounded-xl bg-slate-950/60 px-3 py-2.5">
                      <span className="truncate text-sm">{item.email ?? item.userId ?? "Organization member"}</span>
                      {membership?.role === "owner" && item.role !== "owner" && item.userId ? (
                        <div className="flex items-center gap-2">
                          <select
                            value={item.role}
                            disabled={busy === `member-${item.userId}`}
                            onChange={(event) =>
                              void updateMemberRole(item.userId!, event.target.value as "admin" | "dj")
                            }
                            className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs"
                          >
                            <option value="dj">DJ</option>
                            <option value="admin">Admin</option>
                          </select>
                          <button
                            type="button"
                            disabled={busy === `member-${item.userId}`}
                            onClick={() => void removeMember(item.userId!)}
                            className="text-xs text-red-300 disabled:opacity-50"
                          >
                            Remove
                          </button>
                          <button
                            type="button"
                            disabled={busy === `member-${item.userId}`}
                            onClick={() => void transferOwnership(item.userId!)}
                            className="text-xs text-orange-300 disabled:opacity-50"
                          >
                            Make owner
                          </button>
                        </div>
                      ) : (
                        <span className="ml-3 rounded-full bg-slate-700 px-2 py-1 text-xs capitalize text-slate-300">{item.role}</span>
                      )}
                    </div>
                  ))}
                  {!members.length ? <p className="text-sm text-slate-400">No team members returned yet.</p> : null}
                </div>
              </Card>

              {canManage ? (
                <Card title="Workspace settings">
                  <form onSubmit={updateOrganization} className="space-y-3">
                    <label className="block text-sm">
                      Name
                      <input className={inputClass} value={settingsForm.name} onChange={(event) => setSettingsForm((current) => ({ ...current, name: event.target.value }))} required />
                    </label>
                    <label className="block text-sm">
                      Workspace URL (permanent)
                      <input className={`${inputClass} opacity-60`} value={settingsForm.slug} readOnly />
                    </label>
                    <label className="block text-sm">
                      Default DJ / brand name
                      <input className={inputClass} value={settingsForm.djBrandName} onChange={(event) => setSettingsForm((current) => ({ ...current, djBrandName: event.target.value }))} />
                    </label>
                    <label className="block text-sm">
                      Default venue
                      <input className={inputClass} value={settingsForm.venueName} onChange={(event) => setSettingsForm((current) => ({ ...current, venueName: event.target.value }))} />
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {([
                        ["primaryColor", "Primary"],
                        ["secondaryColor", "Secondary"],
                        ["accentColor", "Accent"],
                      ] as const).map(([key, label]) => (
                        <label key={key} className="text-xs text-slate-400">
                          {label}
                          <input
                            className="mt-1 h-10 w-full rounded border border-slate-700 bg-slate-950 p-1"
                            type="color"
                            value={settingsForm[key]}
                            onChange={(event) =>
                              setSettingsForm((current) => ({ ...current, [key]: event.target.value }))
                            }
                          />
                        </label>
                      ))}
                    </div>
                    <button disabled={busy === "settings"} className="rounded-xl border border-slate-600 px-4 py-2.5 font-semibold disabled:opacity-60">
                      Save settings
                    </button>
                    {membership?.role === "owner" ? (
                      <div className="flex flex-wrap gap-2 border-t border-slate-800 pt-4">
                        <button
                          type="button"
                          onClick={() => void downloadOrganizationExport()}
                          disabled={busy === "export"}
                          className="rounded-lg border border-slate-700 px-3 py-2 text-sm"
                        >
                          Export organization data
                        </button>
                        <button
                          type="button"
                          onClick={() => void changeDeletionStatus(organization.accountStatus !== "deletion_pending")}
                          disabled={busy === "deletion"}
                          className="rounded-lg border border-red-400/40 px-3 py-2 text-sm text-red-300"
                        >
                          {organization.accountStatus === "deletion_pending"
                            ? "Cancel scheduled deletion"
                            : "Schedule account deletion"}
                        </button>
                      </div>
                    ) : null}
                  </form>
                </Card>
              ) : null}
            </div>

            <footer className="mt-8 flex flex-wrap gap-4 border-t border-white/10 pt-6 text-sm text-slate-500">
              <Link to="/terms">Terms</Link>
              <Link to="/privacy">Privacy</Link>
              <Link to="/acceptable-use">Acceptable Use</Link>
              <Link to="/support">Support</Link>
              <Link to="/status">Status</Link>
            </footer>
          </>
        ) : null}
      </main>
    </div>
  );
}
