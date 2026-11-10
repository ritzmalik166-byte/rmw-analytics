'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toQuery } from '@/lib/utils';
import { useFilters } from '@/providers/FiltersProvider';

/**
 * Query an analytics endpoint with the global filters applied.
 * `useStats('/stats/overview')` → GET /api/v1/stats/overview?site=…&range=…
 */
export function useStats(path, extra = {}, options = {}) {
  const { query } = useFilters();
  const q = { ...query, ...extra };
  return useQuery({
    queryKey: ['stats', path, q],
    queryFn: () => api(`${path}${toQuery(q)}`),
    placeholderData: (prev) => prev,
    ...options,
  });
}
