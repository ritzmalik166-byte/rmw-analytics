import { FileText, Search, MousePointerClick, ClipboardList, CheckCircle2, Play, ExternalLink, Download, AlertTriangle, Sparkles, UserCheck, Flame } from 'lucide-react';
import { cn, formatHm, formatDate } from '@/lib/utils';

export const ICON = {
  page_view: FileText, search: Search, click: MousePointerClick, outbound_click: ExternalLink, file_download: Download,
  form_view: ClipboardList, form_start: ClipboardList, form_submit: CheckCircle2, form_error: AlertTriangle, lead: CheckCircle2, conversion: Sparkles,
  video_play: Play, video_complete: Play, js_error: AlertTriangle, rage_click: Flame, identify: UserCheck,
};
const TONE = { form_submit: 'text-emerald-600 bg-emerald-50', lead: 'text-emerald-600 bg-emerald-50', conversion: 'text-emerald-600 bg-emerald-50', search: 'text-blue-600 bg-blue-50', js_error: 'text-red-600 bg-red-50', form_error: 'text-amber-600 bg-amber-50', rage_click: 'text-amber-600 bg-amber-50' };

/** Human name for a form: auto ids like "form_0" become "the form on this page". */
const formName = (p) => {
  const n = String(p.formName || p.form || '').trim();
  return !n || /^form[_-]?\d+$/i.test(n) ? 'the form on this page' : `the “${n.replace(/[_-]+/g, ' ')}” form`;
};
const clean = (t, max = 60) => {
  const s = String(t || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

export function describe(e) {
  const p = e.props || {};
  const path = e.page?.path;
  switch (e.name) {
    case 'page_view': return { title: e.page?.title ? clean(e.page.title, 90) : path, sub: path };
    case 'search': return { title: `Searched for “${clean(p.query)}”`, sub: [p.category, p.results != null ? `${p.results} results` : null].filter(Boolean).join(' · ') || path };
    case 'click': return { title: p.text ? `Clicked “${clean(p.text)}”` : p.href ? `Clicked a link to ${clean(p.href)}` : 'Clicked on the page', sub: path };
    case 'outbound_click': return { title: `Left for ${p.domain || clean(p.href)}`, sub: path };
    case 'file_download': return { title: `Downloaded ${clean(String(p.href || '').split('/').pop())}`, sub: path };
    case 'form_submit': return { title: `Submitted ${formName(p)}`, sub: path };
    case 'form_start': return { title: `Started filling ${formName(p)}`, sub: path };
    case 'form_view': return { title: `Saw ${formName(p)}`, sub: path };
    case 'form_error': return { title: `Form error${p.field ? ` on “${p.field}”` : ''}`, sub: path };
    case 'lead': return { title: 'Became a lead', sub: path };
    case 'conversion': return { title: `Conversion${p.goal ? `: ${p.goal}` : ''}${p.value ? ` (${p.value} ${p.currency || ''})` : ''}`, sub: path };
    case 'session_start': return { title: p.isNew ? 'First visit' : 'New session', sub: path };
    case 'rage_click': return { title: p.text ? `Clicked “${clean(p.text)}” repeatedly (frustrated)` : 'Clicked repeatedly (frustrated)', sub: path };
    case 'dead_click': return { title: p.text ? `Clicked “${clean(p.text)}” but nothing happened` : 'Clicked something that did nothing', sub: path };
    case 'video_play': return { title: 'Played a video', sub: path };
    case 'video_complete': return { title: 'Watched a video to the end', sub: path };
    case 'js_error': return { title: 'Page error', sub: clean(p.msg, 120) };
    default: return { title: e.label || e.name, sub: path };
  }
}

/**
 * Steps worth showing on a journey: pages, real clicks, form progress, searches, leads.
 * Drops tracking noise: "saw a form", clicks on blank areas, dead clicks and repeats.
 */
export function meaningfulSteps(events) {
  const out = [];
  for (const e of events) {
    const p = e.props || {};
    if (['session_start', 'form_view', 'dead_click', 'js_error', 'video_pause', 'identify'].includes(e.name)) continue;
    if (e.name === 'click' && !p.text && !p.href) continue;
    const prev = out[out.length - 1];
    // Same step twice in a row (reload, double click, repeated form start) → keep one.
    if (prev && prev.name === e.name && prev.page?.path === e.page?.path && JSON.stringify(prev.props?.text || prev.props?.form || '') === JSON.stringify(p.text || p.form || '')) continue;
    out.push(e);
  }
  return out;
}

/** Chronological journey grouped by day: "11:32 Homepage → 11:36 Search: “3 BHK Noida” → …" */
export function Journey({ events: raw }) {
  const events = meaningfulSteps(raw || []);
  if (!events.length) return <p className="px-3 py-10 text-center text-[13px] text-muted-foreground">No activity recorded.</p>;
  let lastDay = null;
  let lastSession = null;
  return (
    <ol className="relative px-3 py-2">
      {events.map((e, i) => {
        const day = formatDate(e.ts);
        const newDay = day !== lastDay;
        const newSession = e.sessionId && e.sessionId !== lastSession && i > 0;
        lastDay = day;
        lastSession = e.sessionId;
        const Icon = ICON[e.name] || MousePointerClick;
        const d = describe(e);
        return (
          <li key={e.eventId || i}>
            {newDay && <p className="mb-1 mt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 first:mt-0">{day}</p>}
            {!newDay && newSession && <p className="my-1.5 border-t border-dashed pt-1 text-[10px] uppercase tracking-wide text-slate-400">New session</p>}
            <div className="flex items-start gap-3 py-1">
              <span className="w-11 shrink-0 pt-0.5 text-right tabular-nums text-[12px] text-muted-foreground">{formatHm(e.ts)}</span>
              <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500', TONE[e.name])}><Icon className="h-3.5 w-3.5" /></span>
              <div className="min-w-0 pt-0.5">
                <p className="truncate text-[13px] font-medium text-slate-800">{d.title}</p>
                {d.sub && <p className="truncate text-[11px] text-muted-foreground">{d.sub}</p>}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
