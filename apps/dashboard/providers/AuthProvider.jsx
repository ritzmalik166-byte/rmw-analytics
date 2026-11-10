'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ORG_KEY } from '@/lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const qc = useQueryClient();
  const [loggingOut, setLoggingOut] = useState(false);
  const { data: me, isLoading, refetch } = useQuery({
    queryKey: ['me'],
    queryFn: () => api('/auth/me').catch((e) => (e.status === 401 || e.status === 403 ? null : Promise.reject(e))),
    staleTime: 5 * 60_000,
    retry: false,
  });

  useEffect(() => {
    const onUnauthorized = () => qc.setQueryData(['me'], null);
    window.addEventListener('rmwa:unauthorized', onUnauthorized);
    return () => window.removeEventListener('rmwa:unauthorized', onUnauthorized);
  }, [qc]);

  const logout = useCallback(async () => {
    setLoggingOut(true);
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* cookie may already be gone */ }
    qc.clear();
    qc.setQueryData(['me'], null);
    window.location.href = '/login';
  }, [qc]);

  const switchOrg = useCallback((orgId) => {
    try { localStorage.setItem(ORG_KEY, orgId); } catch { /* ignore */ }
    qc.clear();
    window.location.href = '/overview';
  }, [qc]);

  const can = useCallback((perm) => Boolean(me?.permissions?.includes(perm)), [me]);
  const value = useMemo(() => ({ me, loading: isLoading, loggingOut, logout, refetch, can, switchOrg }), [me, isLoading, loggingOut, logout, refetch, can, switchOrg]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
