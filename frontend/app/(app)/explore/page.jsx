'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { MoreVertical, Plus, Search, Table2, Filter, Route, LayoutTemplate, Copy, Pencil, Trash2, ExternalLink, ChevronDown } from 'lucide-react';
import { api, apiMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useFilters } from '@/providers/FiltersProvider';
import { PageHeader, EmptyState, TableSkeleton } from '@/components/ui/feedback';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/controls';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TECHNIQUES, TEMPLATES, lastModified } from '@/components/explore/shared';

const TYPE_ICON = { freeform: Table2, funnel: Filter, path: Route };

/** Little drawings for the "Start a new exploration" cards (same idea as GA's thumbnails). */
function Thumb({ kind }) {
  if (kind === 'blank') {
    return <div className="flex h-full items-center justify-center"><span className="relative block h-12 w-12"><span className="absolute left-[21px] top-0 h-12 w-[6px] rounded bg-[#ea4335]" /><span className="absolute left-0 top-[21px] h-[6px] w-12 rounded bg-[#4285f4]" /><span className="absolute left-[21px] top-[27px] h-[21px] w-[6px] rounded-b bg-[#34a853]" /><span className="absolute left-[27px] top-[21px] h-[6px] w-[21px] rounded-r bg-[#fbbc04]" /></span></div>;
  }
  if (kind === 'freeform') {
    return (
      <div className="grid h-full grid-cols-4 gap-1 p-4">
        {Array.from({ length: 24 }).map((_, i) => <span key={i} className={cn('rounded-sm', i % 4 === 0 ? 'bg-slate-200' : 'bg-[#aecbfa]')} style={{ opacity: i % 4 === 0 ? 1 : 0.35 + ((i * 37) % 60) / 100 }} />)}
      </div>
    );
  }
  if (kind === 'funnel') {
    return <div className="flex h-full items-end gap-2 px-6 pb-5 pt-4">{[100, 78, 56, 40, 28, 16].map((h) => <span key={h} className="flex-1 rounded-t bg-[#8ab4f8]" style={{ height: `${h}%` }} />)}</div>;
  }
  return (
    <svg viewBox="0 0 200 110" className="h-full w-full p-3" aria-hidden>
      <rect x="10" y="8" width="8" height="94" fill="#8ab4f8" /><rect x="90" y="8" width="8" height="70" fill="#8ab4f8" /><rect x="90" y="84" width="8" height="18" fill="#8ab4f8" />
      <rect x="170" y="8" width="8" height="30" fill="#8ab4f8" /><rect x="170" y="44" width="8" height="22" fill="#8ab4f8" /><rect x="170" y="72" width="8" height="10" fill="#8ab4f8" />
      <path d="M18 8 C55 8 55 8 90 8 L90 78 C55 78 55 94 18 94 Z" fill="#d2e3fc" /><path d="M18 94 C55 94 55 84 90 84 L90 102 C55 102 55 102 18 102 Z" fill="#e8f0fe" />
      <path d="M98 8 C135 8 135 8 170 8 L170 38 C135 38 135 30 98 30 Z" fill="#d2e3fc" /><path d="M98 30 C135 30 135 44 170 44 L170 66 C135 66 135 54 98 54 Z" fill="#e8f0fe" /><path d="M98 54 C135 54 135 72 170 72 L170 82 C135 82 135 78 98 78 Z" fill="#f1f6fe" />
    </svg>
  );
}

function RenameDialog({ target, onClose }) {
  const qc = useQueryClient();
  const [name, setName] = useState(target?.name || '');
  const save = useMutation({
    mutationFn: () => api(`/explorations/${target.id}`, { method: 'PATCH', body: { name: name.trim() } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['explorations'] }); onClose(); },
    onError: (e) => toast.error(apiMessage(e)),
  });
  return (
    <Dialog open={Boolean(target)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Rename exploration</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) save.mutate(); }}>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          <DialogFooter className="mt-4"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" loading={save.isPending} disabled={!name.trim()}>Save</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({ target, onClose }) {
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: () => api(`/explorations/${target.id}`, { method: 'DELETE' }),
    onSuccess: () => { toast.success('Exploration deleted'); qc.invalidateQueries({ queryKey: ['explorations'] }); onClose(); },
    onError: (e) => toast.error(apiMessage(e)),
  });
  return (
    <Dialog open={Boolean(target)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Delete “{target?.name}”?</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">This removes the exploration for everyone in your organisation. Your analytics data is not affected.</p>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="destructive" loading={del.isPending} onClick={() => del.mutate()}>Delete</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ExplorationsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { site, websites } = useFilters();
  const [q, setQ] = useState('');
  const [sortDesc, setSortDesc] = useState(true);
  const [gallery, setGallery] = useState(false);
  const [renaming, setRenaming] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const { data, isLoading } = useQuery({ queryKey: ['explorations'], queryFn: () => api('/explorations') });
  const duplicate = useMutation({
    mutationFn: (id) => api(`/explorations/${id}/duplicate`, { method: 'POST' }),
    onSuccess: (d) => { qc.invalidateQueries({ queryKey: ['explorations'] }); toast.success('Duplicated', { action: { label: 'Open', onClick: () => router.push(`/explore/${d.id}`) } }); },
    onError: (e) => toast.error(apiMessage(e)),
  });
  const rows = useMemo(() => (data || [])
    .filter((e) => !q.trim() || e.name.toLowerCase().includes(q.trim().toLowerCase()) || e.owner.name.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => (sortDesc ? 1 : -1) * (new Date(b.updatedAt) - new Date(a.updatedAt))), [data, q, sortDesc]);
  const siteName = (s) => (s === 'all' ? 'All websites' : websites.find((w) => w.id === s)?.name || 'Removed website');
  const start = (kind, template) => router.push(`/explore/new?technique=${kind}${template != null ? `&template=${template}` : ''}${site && site !== 'all' ? `&site=${site}` : ''}`);

  const cards = [
    { kind: 'blank', title: 'Blank', hint: 'Create a new exploration' },
    { kind: 'freeform', title: 'Free-form', hint: 'What insights can you uncover with custom charts and tables?' },
    { kind: 'funnel', title: 'Funnel exploration', hint: 'How many visitors complete each step, and where do they drop off?' },
    { kind: 'path', title: 'Path exploration', hint: 'What do visitors do step by step on your website?' },
  ];

  return (
    <>
      <PageHeader title="Explorations" description="Build your own reports: tables, funnels and visitor paths, saved for your whole team" />
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[15px] font-medium text-slate-800">Start a new exploration</h2>
        <button onClick={() => setGallery((v) => !v)} className="inline-flex items-center gap-1 text-[13px] font-medium text-[hsl(var(--primary))] hover:underline">Template gallery<ChevronDown className={cn('h-4 w-4 transition-transform', gallery && 'rotate-180')} /></button>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((c) => (
          <button key={c.kind} onClick={() => start(c.kind === 'blank' ? 'blank' : c.kind)} className="group text-left">
            <Card className="h-36 overflow-hidden transition-shadow group-hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-ring"><Thumb kind={c.kind} /></Card>
            <p className="mt-2 text-[14px] font-medium text-slate-900">{c.title}</p>
            <p className="text-[12px] text-muted-foreground">{c.hint}</p>
          </button>
        ))}
      </div>
      {gallery && (
        <Card className="mt-4 p-3">
          <p className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-wide text-slate-500">Templates: ready-made explorations you can change</p>
          <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {TEMPLATES.map((t, i) => {
              const Icon = TYPE_ICON[t.technique];
              return (
                <button key={t.name} onClick={() => start(t.technique, i)} className="flex items-start gap-2.5 rounded-md p-2 text-left hover:bg-slate-50">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded bg-[hsl(213_70%_95%)] text-[hsl(var(--primary))]"><Icon className="h-4 w-4" /></span>
                  <span className="min-w-0"><span className="block text-[13px] font-medium text-slate-800">{t.name}</span><span className="block text-[12px] text-muted-foreground">{t.hint} · {TECHNIQUES[t.technique].label}</span></span>
                </button>
              );
            })}
          </div>
        </Card>
      )}

      <Card className="mt-6 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
          <div className="relative w-full max-w-xs"><Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" /><Input className="pl-8" placeholder="Search by name or owner" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <span className="ml-auto text-[12px] text-muted-foreground">{data ? `${data.length} exploration${data.length === 1 ? '' : 's'}` : ''}</span>
        </div>
        {isLoading ? <TableSkeleton rows={4} cols={5} /> : !rows.length ? (
          <EmptyState icon={LayoutTemplate} title={data?.length ? 'No explorations match' : 'No explorations yet'} description={data?.length ? 'Try another search.' : 'Start one above, or pick a template from the gallery. Explorations are saved automatically and shared with your team.'} action={!data?.length ? <Button onClick={() => start('freeform')}><Plus />New exploration</Button> : null} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead className="w-16">Type</TableHead><TableHead>Name</TableHead><TableHead>Owner</TableHead><TableHead className="cursor-pointer select-none" onClick={() => setSortDesc((v) => !v)}>Last modified {sortDesc ? '↓' : '↑'}</TableHead><TableHead>Website</TableHead><TableHead className="w-12" /></TableRow></TableHeader>
              <TableBody>
                {rows.map((e) => {
                  const Icon = TYPE_ICON[e.techniques[0]] || Table2;
                  return (
                    <TableRow key={e.id} className="cursor-pointer" onClick={() => router.push(`/explore/${e.id}`)}>
                      <TableCell><span title={e.techniques.map((t) => TECHNIQUES[t]?.label).join(', ')}><Icon className="h-4 w-4 text-slate-500" /></span></TableCell>
                      <TableCell className="font-medium"><Link href={`/explore/${e.id}`} onClick={(ev) => ev.stopPropagation()} className="hover:underline">{e.name}</Link>{e.tabs.length > 1 && <span className="ml-2 text-[11px] font-normal text-muted-foreground">{e.tabs.length} tabs</span>}</TableCell>
                      <TableCell className="text-[13px]">{e.owner.me ? 'You' : e.owner.name}</TableCell>
                      <TableCell className="text-[13px] tabular-nums">{lastModified(e.updatedAt)}</TableCell>
                      <TableCell className="text-[13px] text-muted-foreground">{siteName(e.site)}</TableCell>
                      <TableCell onClick={(ev) => ev.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Actions for ${e.name}`}><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => router.push(`/explore/${e.id}`)}><ExternalLink />Open</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => duplicate.mutate(e.id)}><Copy />Duplicate</DropdownMenuItem>
                            {e.canEdit && <DropdownMenuItem onSelect={() => setRenaming(e)}><Pencil />Rename</DropdownMenuItem>}
                            {e.canEdit && <><DropdownMenuSeparator /><DropdownMenuItem className="text-red-600" onSelect={() => setDeleting(e)}><Trash2 />Delete</DropdownMenuItem></>}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
      {renaming && <RenameDialog target={renaming} onClose={() => setRenaming(null)} />}
      <DeleteDialog target={deleting} onClose={() => setDeleting(null)} />
    </>
  );
}
