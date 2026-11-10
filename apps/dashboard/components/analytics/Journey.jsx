import { FileText, Search, MousePointerClick, ClipboardList, CheckCircle2, Play, ExternalLink, Download, AlertTriangle, Sparkles, UserCheck, Flame } from 'lucide-react';
import { cn, formatHm, formatDate } from '@/lib/utils';

const ICON = {
  page_view: FileText, search: Search, click: MousePointerClick, outbound_click: ExternalLink, file_download: Download,
  form_view: ClipboardList, form_start: ClipboardList, form_submit: CheckCircle2, form_error: AlertTriangle, lead: CheckCircle2, conversion: Sparkles,
  video_play: Play, video_complete: Play, js_error: AlertTriangle, rage_click: Flame, identify: UserCheck,
};
const TONE = { form_submit: 'text-emerald-600 bg-emerald-50', lead: 'text-emerald-600 bg-emerald-50', conversion: 'text-emerald-600 bg-emerald-50', search: 'text-blue-600 bg-blue-50', js_error: 'text-red-600 bg-red-50', form_error: 'text-amber-600 bg-amber-50', rage_click: 'text-amber-600 bg-amber-50' };

function describe(e) {
  const p = e.props || {};
  switch (e.name) {
    case 'page_view': return { title: e.page?.title || e.page?.path, sub: e.page?.path };
    case 'search': return { title: `Search: “${p.query}”`, sub: [p.category, p.results != null ? `${p.results} results` : null].filter(Boolean).join(' · ') || e.page?.path };
    case 'click': return { title: `Clicked ${p.text ? `“${p.text}”` : p.tag || 'element'}`, sub: e.page?.path };
    case 'outbound_click': return { title: `Outbound link to ${p.domain || p.href}`, sub: e.page?.path };
    case 'file_download': return { title: `Downloaded ${String(p.href || '').split('/').pop()}`, sub: e.page?.path };
    case 'form_submit': return { title: `Submitted ${p.formName || p.form || 'form'}`, sub: e.page?.path };
    case 'form_start': return { title: `Started ${p.formName || p.form || 'form'}`, sub: e.page?.path };
    case 'form_view': return { title: `Saw ${p.formName || p.form || 'form'}`, sub: e.page?.path };
    case 'form_error': return { title: `Form error${p.field ? ` on “${p.field}”` : ''}`, sub: e.page?.path };
    case 'lead': return { title: 'Lead submitted', sub: e.page?.path };
    case 'conversion': return { title: `Conversion: ${p.goal || ''}${p.value ? ` (${p.value} ${p.currency || ''})` : ''}`, sub: e.page?.path };
    case 'session_start': return { title: p.isNew ? 'First visit' : 'New session', sub: e.page?.path };
    case 'js_error': return { title: 'JavaScript error', sub: p.msg };
    default: return { title: e.label || e.name, sub: [e.page?.path, Object.keys(p).length ? JSON.stringify(p).slice(0, 120) : null].filter(Boolean).join(' · ') };
  }
}

/** Chronological journey grouped by day: "11:32 Homepage → 11:36 Search: “3 BHK Noida” → …" */
export function Journey({ events }) {
  if (!events?.length) return <p className="px-3 py-10 text-center text-[13px] text-muted-foreground">No activity recorded.</p>;
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
