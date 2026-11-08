import { createContext, useContext, useMemo, useSyncExternalStore, useEffect, useRef, type ReactNode } from "react";
import { getLocalStore, type SessionUser, sessionIdentity } from "@nebula/local";

import { clearCollaborationDrafts } from '@/features/collaborations/drafts';
import { useQueryClient } from '@tanstack/react-query';

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

  const client = useQueryClient(), previous = useRef(sessionIdentity(user));
  useEffect(() => { const identity = sessionIdentity(user); if (previous.current !== identity) { clearCollaborationDrafts(); void client.cancelQueries(); client.removeQueries({ predicate: query => ['remix-draft','remix-drafts','my-artist-preferences','my-artist-onboarding','messages','message','message-compose','offer-composition','collaboration','collaborations'].includes(String(query.queryKey[0])) }); previous.current = identity; } }, [user, client]);
  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading: false }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
