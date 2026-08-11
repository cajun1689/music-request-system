import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api } from "../services/api";
import { auth } from "../services/auth";
import { Sentry } from "../sentry";
import type {
  Membership,
  Organization,
  PlatformAccess,
  PlatformSupportSession,
  Session,
  SupportSessionMode,
} from "../types";

const ACTIVE_ORGANIZATION_KEY = "casper_active_organization";
const SUPPORT_SESSION_KEY = "casper_platform_support_session";

function supportExpiry(value: string | number) {
  if (typeof value === "number") return value < 10_000_000_000 ? value * 1000 : value;
  return Date.parse(value);
}

function restoreSupportSession(): PlatformSupportSession | null {
  try {
    const stored = sessionStorage.getItem(SUPPORT_SESSION_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as PlatformSupportSession;
    if (!parsed.supportSessionId || supportExpiry(parsed.expiresAt) <= Date.now()) {
      sessionStorage.removeItem(SUPPORT_SESSION_KEY);
      return null;
    }
    return parsed;
  } catch {
    try {
      sessionStorage.removeItem(SUPPORT_SESSION_KEY);
    } catch {
      // Ignore unavailable browser storage.
    }
    return null;
  }
}

type AuthContextType = {
  session: Session | null;
  organizations: Organization[];
  memberships: Membership[];
  activeOrganization: Organization | null;
  activeOrganizationId: string | null;
  loadingOrganizations: boolean;
  platformAccess: PlatformAccess | null;
  loadingPlatformAccess: boolean;
  isPlatformAdmin: boolean;
  hasLegacyPlatformEligibility: boolean;
  supportSession: PlatformSupportSession | null;
  login: (email: string, password: string) => Promise<Session>;
  signUp: (email: string, password: string) => ReturnType<typeof auth.signUp>;
  confirmSignUp: (email: string, code: string) => Promise<void>;
  resendConfirmationCode: (email: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  confirmPasswordReset: (email: string, code: string, newPassword: string) => Promise<void>;
  reloadOrganizations: () => Promise<void>;
  reloadPlatformAccess: () => Promise<PlatformAccess | null>;
  startSupportSession: (payload: {
    organizationId: string;
    targetUserId?: string;
    mode: SupportSessionMode;
    reason: string;
    durationMinutes: number;
  }) => Promise<PlatformSupportSession>;
  endSupportSession: () => Promise<void>;
  setActiveOrganization: (organizationId: string) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(auth.getSession());
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loadingOrganizations, setLoadingOrganizations] = useState(Boolean(session));
  const [platformAccess, setPlatformAccess] = useState<PlatformAccess | null>(null);
  const [loadingPlatformAccess, setLoadingPlatformAccess] = useState(Boolean(session));
  const [supportSession, setSupportSession] = useState<PlatformSupportSession | null>(
    restoreSupportSession,
  );
  const [activeOrganizationId, setActiveOrganizationId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(ACTIVE_ORGANIZATION_KEY);
    } catch {
      return null;
    }
  });

  const reloadOrganizations = useCallback(async () => {
    if (!session) {
      setOrganizations([]);
      setMemberships([]);
      setLoadingOrganizations(false);
      return;
    }
    setLoadingOrganizations(true);
    try {
      const result = await api.getOrganizations(session.idToken);
      setOrganizations(result.organizations ?? []);
      setMemberships(result.memberships ?? []);
      const savedStillExists = result.organizations.some(
        (organization) => organization.organizationId === activeOrganizationId,
      );
      if (!savedStillExists) {
        const nextId = result.organizations[0]?.organizationId ?? null;
        setActiveOrganizationId(nextId);
        try {
          if (nextId) localStorage.setItem(ACTIVE_ORGANIZATION_KEY, nextId);
          else localStorage.removeItem(ACTIVE_ORGANIZATION_KEY);
        } catch {
          // Organization selection still works for the current session.
        }
      }
    } finally {
      setLoadingOrganizations(false);
    }
  }, [activeOrganizationId, session]);

  const reloadPlatformAccess = useCallback(async () => {
    if (!session) {
      setPlatformAccess(null);
      setLoadingPlatformAccess(false);
      return null;
    }
    setLoadingPlatformAccess(true);
    try {
      const result = await api.getPlatformMe(session.idToken);
      setPlatformAccess(result.access);
      return result.access;
    } catch {
      setPlatformAccess(null);
      return null;
    } finally {
      setLoadingPlatformAccess(false);
    }
  }, [session]);

  useEffect(() => {
    void reloadOrganizations();
  }, [reloadOrganizations]);

  useEffect(() => {
    void reloadPlatformAccess();
  }, [reloadPlatformAccess]);

  useEffect(() => {
    if (!supportSession) return;
    if (!session) {
      setSupportSession(null);
      try {
        sessionStorage.removeItem(SUPPORT_SESSION_KEY);
      } catch {
        // Ignore unavailable browser storage.
      }
      return;
    }
    if (
      supportSession.operatorEmail
      && session.email
      && supportSession.operatorEmail.toLowerCase() !== session.email.toLowerCase()
    ) {
      setSupportSession(null);
      try {
        sessionStorage.removeItem(SUPPORT_SESSION_KEY);
      } catch {
        // Ignore unavailable browser storage.
      }
      return;
    }
    const delay = supportExpiry(supportSession.expiresAt) - Date.now();
    if (delay <= 0) {
      setSupportSession(null);
      try {
        sessionStorage.removeItem(SUPPORT_SESSION_KEY);
      } catch {
        // Ignore unavailable browser storage.
      }
      return;
    }
    const timeout = window.setTimeout(() => {
      setSupportSession(null);
      try {
        sessionStorage.removeItem(SUPPORT_SESSION_KEY);
      } catch {
        // Ignore unavailable browser storage.
      }
    }, Math.min(delay, 2_147_483_647));
    return () => window.clearTimeout(timeout);
  }, [session, supportSession]);

  useEffect(() => {
    const clearInvalidSupportSession = () => setSupportSession(null);
    window.addEventListener("casper:support-session-invalid", clearInvalidSupportSession);
    return () =>
      window.removeEventListener("casper:support-session-invalid", clearInvalidSupportSession);
  }, []);

  useEffect(() => {
    Sentry.setUser(session ? { id: platformAccess?.userId, email: session.email } : null);
    Sentry.setTag("organizationId", activeOrganizationId ?? "none");
    Sentry.setTag("platformRole", platformAccess?.role ?? "none");
    Sentry.setTag("supportSessionId", supportSession?.supportSessionId ?? "none");
    Sentry.setTag("supportOrganizationId", supportSession?.organizationId ?? "none");
    Sentry.setTag("supportMode", supportSession?.mode ?? "none");
  }, [activeOrganizationId, platformAccess, session, supportSession]);

  const hasLegacyPlatformEligibility = useMemo(
    () =>
      memberships.some((membership) => {
        const organization = organizations.find(
          (item) => item.organizationId === membership.organizationId,
        );
        const isMaplLegacy =
          membership.organizationId === "mapl-legacy"
          || organization?.organizationId === "mapl-legacy"
          || organization?.slug === "mapl-legacy";
        return isMaplLegacy && (membership.role === "owner" || membership.role === "admin");
      }),
    [memberships, organizations],
  );

  const value = useMemo<AuthContextType>(
    () => ({
      session,
      organizations,
      memberships,
      activeOrganization:
        organizations.find((organization) => organization.organizationId === activeOrganizationId) ?? null,
      activeOrganizationId,
      loadingOrganizations,
      platformAccess,
      loadingPlatformAccess,
      isPlatformAdmin: platformAccess?.isPlatformAdmin === true,
      hasLegacyPlatformEligibility,
      supportSession,
      async login(email: string, password: string) {
        const next = await auth.login(email, password);
        setSession(next);
        return next;
      },
      signUp: auth.signUp,
      confirmSignUp: auth.confirmSignUp,
      resendConfirmationCode: auth.resendConfirmationCode,
      requestPasswordReset: auth.requestPasswordReset,
      confirmPasswordReset: auth.confirmPasswordReset,
      reloadOrganizations,
      reloadPlatformAccess,
      async startSupportSession(payload) {
        if (!session) throw new Error("Sign in before starting a support session.");
        const result = await api.createPlatformSupportSession(payload, session.idToken);
        const next = "supportSession" in result ? result.supportSession : result;
        setSupportSession(next);
        try {
          sessionStorage.setItem(SUPPORT_SESSION_KEY, JSON.stringify(next));
        } catch {
          // The active session remains available in memory.
        }
        return next;
      },
      async endSupportSession() {
        const current = supportSession;
        try {
          if (session && current) {
            await api.endPlatformSupportSession(current.supportSessionId, session.idToken);
          }
        } finally {
          setSupportSession(null);
          try {
            sessionStorage.removeItem(SUPPORT_SESSION_KEY);
          } catch {
            // Ignore unavailable browser storage.
          }
        }
      },
      setActiveOrganization(organizationId: string) {
        setActiveOrganizationId(organizationId);
        try {
          localStorage.setItem(ACTIVE_ORGANIZATION_KEY, organizationId);
        } catch {
          // Selection remains active in memory.
        }
      },
      logout() {
        auth.logout();
        setSession(null);
        setOrganizations([]);
        setMemberships([]);
        setPlatformAccess(null);
        setSupportSession(null);
        setActiveOrganizationId(null);
        try {
          localStorage.removeItem(ACTIVE_ORGANIZATION_KEY);
          sessionStorage.removeItem(SUPPORT_SESSION_KEY);
        } catch {
          // Ignore storage errors.
        }
      },
    }),
    [
      activeOrganizationId,
      hasLegacyPlatformEligibility,
      loadingOrganizations,
      loadingPlatformAccess,
      memberships,
      organizations,
      platformAccess,
      reloadOrganizations,
      reloadPlatformAccess,
      session,
      supportSession,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// AuthProvider and its consumer hook intentionally share this small module.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
