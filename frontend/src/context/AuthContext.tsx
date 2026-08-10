import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api } from "../services/api";
import { auth } from "../services/auth";
import { Sentry } from "../sentry";
import type { Membership, Organization, Session } from "../types";

const ACTIVE_ORGANIZATION_KEY = "casper_active_organization";

type AuthContextType = {
  session: Session | null;
  organizations: Organization[];
  memberships: Membership[];
  activeOrganization: Organization | null;
  activeOrganizationId: string | null;
  loadingOrganizations: boolean;
  login: (email: string, password: string) => Promise<Session>;
  signUp: (email: string, password: string) => ReturnType<typeof auth.signUp>;
  confirmSignUp: (email: string, code: string) => Promise<void>;
  resendConfirmationCode: (email: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  confirmPasswordReset: (email: string, code: string, newPassword: string) => Promise<void>;
  reloadOrganizations: () => Promise<void>;
  setActiveOrganization: (organizationId: string) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(auth.getSession());
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loadingOrganizations, setLoadingOrganizations] = useState(Boolean(session));
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

  useEffect(() => {
    void reloadOrganizations();
  }, [reloadOrganizations]);

  useEffect(() => {
    Sentry.setUser(session ? { email: session.email } : null);
    Sentry.setTag("organizationId", activeOrganizationId ?? "none");
  }, [activeOrganizationId, session]);

  const value = useMemo<AuthContextType>(
    () => ({
      session,
      organizations,
      memberships,
      activeOrganization:
        organizations.find((organization) => organization.organizationId === activeOrganizationId) ?? null,
      activeOrganizationId,
      loadingOrganizations,
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
        setActiveOrganizationId(null);
        try {
          localStorage.removeItem(ACTIVE_ORGANIZATION_KEY);
        } catch {
          // Ignore storage errors.
        }
      },
    }),
    [
      activeOrganizationId,
      loadingOrganizations,
      memberships,
      organizations,
      reloadOrganizations,
      session,
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
