'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Flame } from 'lucide-react';
import { useStats } from '@/lib/hooks';
import { cn, num, pct } from '@/lib/utils';
import { useFilters } from '@/providers/FiltersProvider';
import { PageHeader, EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { Switch } from '@/components/ui/controls';
import { Panel } from '@/components/analytics/Panel';
import { RangePicker } from '@/components/analytics/RangePicker';
import { WebsiteTag } from '@/components/analytics/WebsiteDot';

const LAYOUT_WIDTH = 1280; // reference document width used to scale y (px) against x (‰ of width)
const KINDS = [['click', 'Clicks'], ['rage', 'Rage clicks'], ['dead', 'Dead clicks']];

/** Density grid drawn on a canvas. One hue, light → dark (sequential), never a rainbow. */
function HeatCanvas({ data, kind, pageUrl, showPage }) {
  const wrap = useRef(null);
  const canvas = useRef(null);
  const [width, setWidth] = useState(800);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);
  const scale = width / LAYOUT_WIDTH;
  const height = Math.max(400, Math.min(6000, Math.ceil(((data?.maxY || 0) + 200) * scale)));
  const points = useMemo(() => (data?.points || []).filter((p) => p.kind === kind), [data, kind]);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = width * dpr;
    c.height = height * dpr;
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);
    const max = Math.max(1, ...points.map((p) => p.n));
    const cw = width / data.xBuckets;
    const ch = data.yBucketPx * scale;
    for (const p of points) {
      const t = Math.sqrt(p.n / max); // perceptual boost for sparse cells
      ctx.fillStyle = `rgba(220, 38, 38, ${0.12 + t * 0.78})`;
      ctx.beginPath();
      ctx.roundRect(p.x * cw + 0.5, p.y * ch + 0.5, Math.max(2, cw - 1), Math.max(2, ch - 1), 2);
      ctx.fill();
    }
  }, [points, width, height, scale, data]);

  return (
    <div ref={wrap} className="relative w-full overflow-hidden rounded border bg-[repeating-linear-gradient(0deg,#f8fafc,#f8fafc_24px,#f1f5f9_24px,#f1f5f9_25px)]" style={{ height }}>
      {showPage && pageUrl && (
        <iframe title="Page preview" src={pageUrl} sandbox="allow-same-origin" className="pointer-events-none absolute left-0 top-0 origin-top-left border-0 opacity-60" style={{ width: LAYOUT_WIDTH, height: height / scale, transform: `scale(${scale})` }} />
      )}
      <canvas ref={canvas} className="absolute inset-0" style={{ width, height }} aria-label={`${points.length} heatmap cells`} />
      {!points.length && <p className="absolute inset-0 flex items-center justify-center text-[13px] text-muted-foreground">No {kind} data for this page and device.</p>}
    </div>
  );
}

export default function HeatmapsPage() {
  const { current, rangeLabel, websites } = useFilters();
  const pages = useStats('/heatmaps');
  const [sel, setSel] = useState(null);
  const [device, setDevice] = useState('desktop');
  const [kind, setKind] = useState('click');
  const [showPage, setShowPage] = useState(false);
  const page = sel || pages.data?.[0];
  const data = useStats('/heatmaps/data', { path: page?.path, device }, { enabled: Boolean(page) });
  const site = websites.find((w) => w.id === page?.websiteId);
  const heatmapsOn = websites.some((w) => w.settings?.heatmaps);

  return (
    <>
      <PageHeader title="Heatmaps" description={`Click, rage-click and dead-click density with scroll reach · ${current ? current.name : 'All websites'} · ${rangeLabel}`} actions={<RangePicker />} />
      {!heatmapsOn && (
        <p className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">Heatmaps are optional because they add data volume. Turn them on per website in <Link className="underline" href="/websites">Websites → Settings</Link>. Keystrokes are never recorded.</p>
      )}
      {pages.error ? <Card><ErrorState error={pages.error} onRetry={pages.refetch} /></Card> : pages.isLoading ? <Skeleton className="h-96" /> : !pages.data?.length ? <Card><EmptyState icon={Flame} title="No heatmap data yet" /></Card> : (
        <div className="grid gap-4 xl:grid-cols-4">
          <Panel title="Pages" bodyClassName="max-h-[720px] overflow-y-auto">
            <ul className="divide-y">
              {pages.data.map((p) => (
                <li key={`${p.websiteId}${p.path}`}>
                  <button onClick={() => setSel(p)} className={cn('w-full px-3 py-2 text-left text-[13px] hover:bg-slate-50', page?.path === p.path && page?.websiteId === p.websiteId && 'bg-[hsl(213_70%_95%)] font-semibold text-primary')}>
                    <span className="flex items-center gap-1.5"><span className="truncate">{p.path}</span>{websites.length > 1 && <WebsiteTag website={websites.find((w) => w.id === p.websiteId)} />}</span>
                    <span className="block text-[11px] font-normal text-muted-foreground">{num(p.clicks)} clicks{p.rage ? ` · ${p.rage} rage` : ''}{p.dead ? ` · ${p.dead} dead` : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
          <div className="space-y-4 xl:col-span-3">
            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-center gap-2 border-b bg-[hsl(214_25%_97%)] px-3 py-1.5">
                <h3 className="mr-auto truncate text-[12px] font-semibold uppercase tracking-wide text-slate-600">{page?.path}</h3>
                <div className="flex gap-1">{KINDS.map(([k, l]) => <button key={k} onClick={() => setKind(k)} className={cn('rounded px-2 py-0.5 text-[11px] font-medium', kind === k ? 'bg-white text-primary ring-1 ring-slate-200' : 'text-slate-500')}>{l}</button>)}</div>
                <Select className="h-7 w-28 text-[12px]" value={device} onChange={(e) => setDevice(e.target.value)} aria-label="Device"><option value="desktop">Desktop</option><option value="tablet">Tablet</option><option value="mobile">Mobile</option></Select>
                <label className="flex items-center gap-1.5 text-[12px] text-slate-600"><Switch checked={showPage} onCheckedChange={setShowPage} />Show page</label>
              </div>
              <div className="p-3">
                {data.isLoading && !data.data ? <Skeleton className="h-96" /> : data.data && <HeatCanvas data={data.data} kind={kind} showPage={showPage} pageUrl={site ? `https://${site.domain}${page.path}` : null} />}
                <p className="mt-2 text-[11px] text-muted-foreground">Darker = more {kind === 'click' ? 'clicks' : `${kind} clicks`}. Positions are relative to page width; the live page preview only loads if the site allows framing.</p>
              </div>
            </Card>
            <div className="grid gap-4 md:grid-cols-2">
              <Panel title="Popular elements">
                {!data.data?.elements?.length ? <p className="px-3 py-8 text-center text-[13px] text-muted-foreground">—</p> : (
                  <ul className="divide-y text-[12px]">
                    {data.data.elements.map((e) => (
                      <li key={e.selector} className="flex items-center gap-2 px-3 py-1.5">
                        <code className="min-w-0 flex-1 truncate text-slate-700" title={e.selector}>{e.selector}</code>
                        <span className="tabular-nums">{num(e.clicks)}</span>
                        {e.rage > 0 && <span className="rounded-sm bg-amber-50 px-1 text-[10px] font-semibold text-amber-800 ring-1 ring-amber-200">{e.rage} rage</span>}
                        {e.dead > 0 && <span className="rounded-sm bg-slate-100 px-1 text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200">{e.dead} dead</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
              <Panel title={`Scroll reach · ${num(data.data?.scroll?.pageviews)} views`}>
                <ul className="space-y-1 px-3 py-2">
                  {(data.data?.scroll?.reach || []).map((r) => (
                    <li key={r.depth} className="flex items-center gap-2 text-[12px]">
                      <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">{r.depth}%</span>
                      <div className="h-4 flex-1 overflow-hidden rounded-sm bg-slate-100"><div className="h-full bg-[#194173]" style={{ width: `${r.pct}%` }} /></div>
                      <span className="w-12 shrink-0 text-right tabular-nums">{pct(r.pct, 0)}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
