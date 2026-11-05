// === src/contexts/AuthContext.tsx ===
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { User } from "firebase/auth";
import {
  subscribeAuthState,
  loginRider,
  logoutRider,
  wasPreviouslyLoggedIn,
  type AuthErrorInfo,
} from "@/services/authService";
import { resolveRiderScope } from "@/services/riderService";
import { logRiderError } from "@/services/auditService";

type AuthContextValue = {
  user: User | null;
  authLoading: boolean;
  /** True on first paint if a previous session existed — lets the UI skip the loader flash. */
  hadPriorSession: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [hadPriorSession] = useState(wasPreviouslyLoggedIn());

  useEffect(() => {
    const unsubscribe = subscribeAuthState((u) => {
      setUser(u);
      setAuthLoading(false);
      if (u) {
        // Riders are outlet-scoped (riders/riderStats/settlements live under
        // businesses/{bid}/outlets/{oid}/), so resolve riderIndex/{uid} before
        // anything that builds a rider path. useRiderProfile does the same —
        // resolveRiderScope is cached, so the second call is free.
        resolveRiderScope(u.uid)
          .then(() => import("@/services/notificationService").then((m) => m.registerPushNotifications(u.uid)))
          .catch((err) => logRiderError(u.uid, "authBootstrap", err));
      }
    });
    return unsubscribe;
  }, []);

  const login = async (identifier: string, password: string) => {
    try {
      await loginRider(identifier, password);
    } catch (err) {
      throw err as AuthErrorInfo;
    }
  };

  const logout = async () => {
    try {
      await logoutRider(user?.uid);
    } catch (err) {
      if (user?.uid) logRiderError(user.uid, "logout", err);
      throw err;
    }
  };

  return (
    <AuthContext.Provider value={{ user, authLoading, hadPriorSession, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuthContext must be used within AuthProvider");
  return ctx;
}
