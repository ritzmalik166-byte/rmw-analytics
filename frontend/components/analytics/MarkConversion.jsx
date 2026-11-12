'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Target } from 'lucide-react';
import { api, apiMessage } from '@/lib/api';
import { toQuery } from '@/lib/utils';
import { useFilters } from '@/providers/FiltersProvider';
import { useAuth } from '@/providers/AuthProvider';
import { Button } from '@/components/ui/button';

/** Goals (conversions) for every website in the organisation. */
export function useGoals() {
  return useQuery({ queryKey: ['goals'], queryFn: () => api(`/goals${toQuery({ site: 'all' })}`), staleTime: 30_000 });
}

/** Websites the action applies to: the selected one, or all of them. */
function useTargets() {
  const { site, websites } = useFilters();
  return site === 'all' ? websites : websites.filter((w) => w.id === site);
}

/**
 * Create one event goal per target website. Matching activity from the last 90 days is counted too
 * (the API backfills), so the conversions report isn't empty on day one.
 */
export function useCreateGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ websiteIds, name, type, match, value }) => {
      let backfilled = 0;
      for (const websiteId of websiteIds) {
        const r = await api('/goals', { method: 'POST', body: { websiteId, name, type, match, ...(value ? { value } : {}) } });
        backfilled += r?.backfilled || 0;
      }
      return { backfilled };
    },
    onSuccess: ({ backfilled }, v) => {
      toast.success(`"${v.name}" now counts as a conversion`, { description: backfilled ? `${backfilled} from the last 90 days were added.` : 'Matching activity will be counted from now on.' });
      qc.invalidateQueries({ queryKey: ['goals'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
    },
    onError: (e) => toast.error(apiMessage(e)),
  });
}

/** "Count as conversion" toggle for an event name. Shows "Counted as conversion" once it is one. */
export function MarkConversionButton({ event, label, compact = false }) {
  const { can } = useAuth();
  const { data: goals } = useGoals();
  const targets = useTargets();
  const create = useCreateGoal();
  const missing = targets.filter((w) => !(goals || []).some((g) => g.websiteId === w.id && g.type === 'event' && g.match === event));
  if (!goals || !targets.length) return null;
  if (!missing.length) {
    return <span className="inline-flex items-center gap-1 whitespace-nowrap text-[12px] font-medium text-emerald-700"><Check className="h-3.5 w-3.5" />{compact ? 'Conversion' : 'Counted as conversion'}</span>;
  }
  if (!can('websites:write')) return null;
  return (
    <Button
      variant="outline"
      size="sm"
      className={compact ? 'h-7 px-2 text-[11px]' : undefined}
      loading={create.isPending}
      onClick={() => create.mutate({ websiteIds: missing.map((w) => w.id), name: label || event, type: 'event', match: event })}
      title="Count every time this happens as a conversion"
    >
      <Target />{compact ? 'Count as conversion' : 'Count as conversion'}
    </Button>
  );
}
