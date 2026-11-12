'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn, toQuery } from '@/lib/utils';
import { download, apiMessage } from '@/lib/api';
import { useFilters, withView } from '@/providers/FiltersProvider';
import { useAuth } from '@/providers/AuthProvider';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/controls';
import { ErrorState } from '@/components/ui/feedback';

/** Card with the CRM panel header strip; optional tabs, "view all" link and actions. */
export function Panel({ title, subtitle, tabs, tab, onTab, href, hrefLabel = 'View all', actions, children, className, bodyClassName, error, onRetry }) {
  const { linkQuery } = useFilters() || {};
  const link = href ? withView(href, linkQuery) : null;
  return (
    <Card className={cn('flex flex-col overflow-hidden', className)}>
      <div className="flex min-h-[38px] items-center justify-between gap-2 border-b bg-[hsl(214_25%_97%)] px-3 py-1.5">
        <div className="min-w-0">
          <h3 className="text-[12px] font-semibold uppercase tracking-wide text-slate-600">{title}</h3>
          {subtitle && <p className="truncate text-[11px] text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-1">
          {tabs?.map((t) => (
            <button key={t.key} onClick={() => onTab(t.key)} className={cn('rounded px-2 py-0.5 text-[11px] font-medium', tab === t.key ? 'bg-white text-[hsl(var(--primary))] ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800')}>{t.label}</button>
          ))}
          {actions}
          {link && <Link href={link} className="ml-1 text-[11px] text-muted-foreground hover:text-foreground">{hrefLabel}</Link>}
        </div>
      </div>
      <div className={cn('flex-1', bodyClassName)}>{error ? <ErrorState error={error} onRetry={onRetry} /> : children}</div>
    </Card>
  );
}

/** CSV / Excel export for a report type, using the current website + date range. */
export function ExportButton({ type, label = 'Export' }) {
  const { query } = useFilters();
  const { can } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!can('reports:export')) return null;
  const run = async (format) => {
    setBusy(true);
    try { await download(`/reports/${type}${toQuery({ ...query, format })}`, `${type}.${format}`); } catch (e) { toast.error(apiMessage(e)); } finally { setBusy(false); }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Download />}{label}</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => run('csv')}>CSV (.csv)</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run('xlsx')}>Excel (.xlsx)</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
