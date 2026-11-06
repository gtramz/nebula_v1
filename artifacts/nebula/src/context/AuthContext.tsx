import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { getLocalStore, type SessionUser } from "@nebula/local";

type AuthContextType = {
  user: SessionUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
};

const AuthContext = createContext<AuthContextType>({
  user: null, isAuthenticated: false, isLoading: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const store = getLocalStore();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const user = useMemo(() => store.getCurrentUser(), [store, snapshot]);

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading: false }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
