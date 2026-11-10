'use client';
import Link from 'next/link';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { CHANNELS } from '@rmw-analytics/shared/channels';
import { api } from '@/lib/api';
import { duration, formatDateTime, countryName, flag, titleCase, shortVisitor } from '@/lib/utils';
import { PageHeader, ErrorState, PageSkeleton } from '@/components/ui/feedback';
import { Badge } from '@/components/ui/badge';
import { Panel } from '@/components/analytics/Panel';
import { Journey } from '@/components/analytics/Journey';

export default function SessionDetailPage({ params }) {
  const { websiteId, sessionId } = use(params);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['session', websiteId, sessionId], queryFn: () => api(`/sessions/${websiteId}/${sessionId}`) });
  if (isLoading) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const s = data.session;
  const facts = [
    ['Started', formatDateTime(s.startedAt)], ['Duration', duration(s.durationMs)], ['Active time', duration(s.activeMs)], ['Pages', s.pageviews], ['Events', s.events],
    ['Source', `${s.source} (${CHANNELS[s.channel] || s.channel})`], ['Referrer', s.referrer || 'Direct'], ['Campaign', s.utm?.campaign || '—'],
    ['Location', `${flag(s.geo?.country)} ${s.geo?.city ? `${s.geo.city}, ` : ''}${countryName(s.geo?.country)}`], ['Device', `${s.device?.os} ${titleCase(s.device?.type)} · ${s.device?.browser} ${s.device?.browserVersion || ''}`],
    ['Screen', s.device?.screen || '—'], ['Language', s.lang || '—'],
  ];
  return (
    <>
      <Link href="/sessions" className="mb-2 inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" />Sessions</Link>
      <PageHeader
        title={<span className="flex items-center gap-2">Session {formatDateTime(s.startedAt)}{s.converted && <Badge variant="success">Converted</Badge>}{s.bounced && <Badge>Bounced</Badge>}</span>}
        description={<>Visitor <Link className="underline" href={`/visitors/${websiteId}/${s.visitorId}`}>{shortVisitor(s.visitorId)}</Link> · {s.isNew ? 'first visit' : 'returning visitor'}</>}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Session">
          <dl className="grid grid-cols-2 gap-x-4 px-3 py-2">{facts.map(([l, v]) => <div key={l} className="py-1.5"><dt className="kv-label">{l}</dt><dd className="mt-0.5 break-words text-[13px]">{v}</dd></div>)}</dl>
        </Panel>
        <Panel title={`Timeline (${data.events.length} events)`} className="lg:col-span-2" bodyClassName="max-h-[640px] overflow-y-auto"><Journey events={data.events} /></Panel>
      </div>
    </>
  );
}
