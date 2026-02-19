import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from 'react';

interface AuthUser {
  id: string;
  displayName: string;
  role: string;
  authMethod: string;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/auth/status')
      .then((r) => r.json() as Promise<{ authenticated: boolean; user?: AuthUser }>)
      .then((data) => {
        setUser(data.authenticated && data.user ? data.user : null);
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const logout = useCallback(async () => {
    await fetch('/auth/session', { method: 'DELETE' });
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, loading, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
