import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { auth } from "../services/auth";
import type { Session } from "../types";

type AuthContextType = {
  session: Session | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(auth.getSession());

  const value = useMemo<AuthContextType>(
    () => ({
      session,
      async login(email: string, password: string) {
        const next = await auth.login(email, password);
        setSession(next);
      },
      logout() {
        auth.logout();
        setSession(null);
      },
    }),
    [session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
