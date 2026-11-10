'use client';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

export function QueryProvider({ children }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (count, err) => (err?.status >= 400 && err?.status < 500 ? false : count < 2),
      },
    },
  }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
