'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bell, LogOut, Menu, X, Loader2, LayoutDashboard, Radio, Users2, Timer, MapPin, MonitorSmartphone, Globe2, FileText, MousePointerClick,
  Search, Route, Flame, Share2, Megaphone, ClipboardList, Inbox, Filter, Server, BellRing, FileSpreadsheet, Settings, ChevronDown, Check, Building2, KeyRound,
  Video, Link2, LogIn, LogOut as ExitIcon, Zap, Pointer, Download, Target, Percent, ChevronRight, Compass,
} from 'lucide-react';
import { useAuth } from '@/providers/AuthProvider';
import { FiltersProvider, useFilters, withView } from '@/providers/FiltersProvider';
import { FilterBar } from '@/components/analytics/FilterBar';
import { api } from '@/lib/api';
import { cn, timeAgo, toQuery } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/controls';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PageSkeleton, Skeleton } from '@/components/ui/feedback';
import { WebsiteDot } from '@/components/analytics/WebsiteDot';
import { isMpfSite } from '@/lib/mpfLandingPages';

/**
 * Navigation follows the questions a website owner asks: who visits (Visitors), where from (Traffic),
 * what they look at (Content), what they do (Engagement) and whether they convert (Conversions).
 * Specialist tools stay one click away under "More tools" (collapsed).
 */
export const NAV = [
  { items: [
    { href: '/overview', label: 'Overview', icon: LayoutDashboard },
    { href: '/explore', label: 'Explore', icon: Compass },
  ] },
  { title: 'Visitors', items: [
    { href: '/users', label: 'Users', icon: Users2 },
    { href: '/sessions', label: 'Sessions', icon: Timer },
    { href: '/devices', label: 'Devices', icon: MonitorSmartphone },
  ] },
  { title: 'Traffic', items: [
    { href: '/sources', label: 'Sources', icon: Share2 },
    { href: '/campaigns', label: 'Campaigns', icon: Megaphone },
    { href: '/referrals', label: 'Referrals', icon: Link2 },
  ] },
  { title: 'Content', items: [
    { href: '/pages', label: 'Pages', icon: FileText },
    { href: '/landing-pages', label: 'Landing pages', icon: LogIn, mpfOnly: true },
    { href: '/exit-pages', label: 'Exit pages', icon: ExitIcon },
  ] },
  { title: 'Engagement', items: [
    { href: '/events', label: 'Events', icon: Zap },
    { href: '/clicks', label: 'Clicks', icon: Pointer },
    { href: '/forms', label: 'Forms', icon: ClipboardList },
    { href: '/downloads', label: 'Downloads', icon: Download },
  ] },
  { title: 'Conversions', items: [
    { href: '/leads', label: 'Leads', icon: Inbox, perm: 'leads:read' },
    { href: '/goals', label: 'Goals', icon: Target },
    { href: '/conversions', label: 'Conversion rate', icon: Percent },
  ] },
  { items: [
    { href: '/realtime', label: 'Realtime', icon: Radio, live: true },
    { href: '/reports', label: 'Reports', icon: FileSpreadsheet },
  ] },
  { title: 'More tools', collapsible: true, items: [
    { href: '/searches', label: 'Site search', icon: Search },
    { href: '/geography', label: 'Locations', icon: MapPin },
    { href: '/browsers', label: 'Browsers', icon: Globe2 },
    { href: '/journeys', label: 'User journeys', icon: Route },
    { href: '/funnels', label: 'Funnels', icon: Filter },
    { href: '/heatmaps', label: 'Heatmaps', icon: Flame },
    { href: '/recordings', label: 'Recordings', icon: Video, perm: 'visitors:read' },
    { href: '/visitors', label: 'Visitor profiles', icon: MousePointerClick, perm: 'visitors:read' },
    { href: '/alerts', label: 'Alerts', icon: BellRing },
  ] },
  { title: 'Manage', items: [
    { href: '/websites', label: 'Websites', icon: Server },
    { href: '/settings', label: 'Settings', icon: Settings },
  ] },
];

/** Reports whose numbers respect the filter bar (device, country, source…). */
// Explorations are left out: they carry their own segments and dates.
const FILTERABLE = ['/overview', '/users', '/devices', '/sources', '/campaigns', '/referrals', '/pages', '/landing-pages', '/exit-pages', '/events', '/clicks', '/forms', '/downloads', '/conversions', '/geography', '/browsers', '/searches', '/journeys'];
/** Pages that aren't tied to the selected website / dates, so links to them stay plain. */
const PLAIN = ['/websites', '/settings', '/alerts'];

/** Pages whose content doesn't depend on the website filter keep their own URL without ?site. */
const isPlainClick = (e) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

function LogoutDialog({ open, onOpenChange }) {
  const { logout, loggingOut } = useAuth();
  return (
    <Dialog open={open} onOpenChange={(v) => !loggingOut && onOpenChange(v)}>
      <DialogContent className="max-w-sm text-center sm:text-center">
        <DialogHeader className="items-center">
          <span className="mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600"><LogOut className="h-5 w-5" /></span>
          <DialogTitle>Log out of RMW Analytics?</DialogTitle>
          <DialogDescription>You will need to sign in again to view your analytics.</DialogDescription>
        </DialogHeader>
        <DialogFooter className="sm:justify-center">
          <Button variant="outline" disabled={loggingOut} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" loading={loggingOut} onClick={logout}>{loggingOut ? 'Logging out…' : 'Log out'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WebsiteSwitcher() {
  const { site, setSite, websites, current, websitesLoading } = useFilters();
  if (websitesLoading) return <Skeleton className="h-7 w-36 bg-white/20" />;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex h-8 max-w-[220px] items-center gap-2 rounded border border-white/25 bg-white/10 px-2.5 text-[12px] font-medium hover:bg-white/15" aria-label="Select website">
          {current ? <WebsiteDot website={current} /> : <Globe2 className="h-3.5 w-3.5" />}
          <span className="truncate">{current ? current.name : 'All websites'}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Website</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => setSite('all')}>
          <Globe2 /><span className="flex-1">All websites</span>{site === 'all' && <Check className="text-primary" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {websites.map((w) => (
          <DropdownMenuItem key={w.id} onSelect={() => setSite(w.id)}>
            <WebsiteDot website={w} />
            <span className="min-w-0 flex-1"><span className="block truncate">{w.name}</span><span className="block truncate text-[11px] text-muted-foreground">{w.domain}</span></span>
            {site === w.id && <Check className="text-primary" />}
          </DropdownMenuItem>
        ))}
        {!websites.length && <p className="px-2 py-3 text-xs text-muted-foreground">No websites yet.</p>}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild><Link href="/websites?new=1"><Server />Add website</Link></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LiveCount() {
  const { query } = useFilters();
  const { data } = useQuery({ queryKey: ['live-count', query.site], queryFn: () => api(`/realtime${toQuery({ site: query.site })}`), refetchInterval: 30_000 });
  const n = data?.active ?? null;
  return (
    <Link href={`/realtime${toQuery({ site: query.site === 'all' ? undefined : query.site })}`} className="hidden items-center gap-1.5 rounded px-2 py-1 text-[12px] hover:bg-white/10 sm:flex" title="Visitors active in the last 5 minutes">
      <span className={cn('h-2 w-2 rounded-full', n ? 'animate-pulse bg-emerald-400' : 'bg-white/40')} />
      <span className="tabular-nums">{n ?? '–'}</span><span className="text-white/70">live</span>
    </Link>
  );
}

function AlertBell() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['alert-events', 'bell'], queryFn: () => api('/alerts/events?limit=8'), refetchInterval: 60_000 });
  const markAll = useMutation({ mutationFn: () => api('/alerts/events/read', { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['alert-events'] }) });
  const unread = data?.unread || 0;
  return (
    <DropdownMenu onOpenChange={(o) => { if (!o && unread) markAll.mutate(); }}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Alerts${unread ? `, ${unread} unread` : ''}`}>
          <Bell />
          {unread > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">{unread > 99 ? '99+' : unread}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="border-b px-3 py-2 text-sm font-semibold">Alerts</div>
        <div className="max-h-96 overflow-y-auto">
          {!data?.rows?.length && <p className="px-3 py-8 text-center text-sm text-muted-foreground">No alerts have fired.</p>}
          {data?.rows?.map((n) => (
            <div key={n.id} className="border-b px-3 py-2.5 last:border-0">
              <div className="flex items-start gap-2">
                {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-600" />}
                <div className={cn('min-w-0', n.read && 'pl-4')}>
                  <p className="text-[13px] font-medium">{n.name}</p>
                  <p className="line-clamp-2 text-xs text-muted-foreground">{n.message}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{timeAgo(n.ts)}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="border-t p-1"><DropdownMenuItem asChild className="justify-center text-xs"><Link href="/alerts">Manage alerts</Link></DropdownMenuItem></div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Shell({ children }) {
  const { me, can, switchOrg } = useAuth();
  const pathname = usePathname();
  const { linkQuery, current } = useFilters();
  const mpf = isMpfSite(current);
  const [open, setOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [pendingHref, setPendingHref] = useState(null);
  const inMore = NAV.find((g) => g.collapsible)?.items.some((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));
  const [moreOpen, setMoreOpen] = useState(Boolean(inMore));
  useEffect(() => { setPendingHref(null); if (inMore) setMoreOpen(true); }, [pathname, inMore]);
  // Keep the selected website, dates and filters when moving between reports.
  const hrefFor = (href) => (PLAIN.includes(href) ? href : withView(href, linkQuery));
  const navigate = (href) => (e) => { setOpen(false); if (isPlainClick(e) && href !== pathname) setPendingHref(href); };
  const showFilters = FILTERABLE.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  const sidebar = (
    <nav className="flex h-full flex-col bg-white">
      <div className="flex-1 overflow-y-auto py-2">
        {NAV.map((group, gi) => (
          <div key={group.title || `g${gi}`} className={cn('mb-1', !group.title && gi > 0 && 'mt-2 border-t pt-1')}>
            {group.title && (group.collapsible ? (
              <button onClick={() => setMoreOpen((v) => !v)} className="flex w-full items-center gap-1 px-4 pb-1 pt-3 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500 hover:text-slate-700" aria-expanded={moreOpen}>
                <ChevronRight className={cn('h-3 w-3 transition-transform', moreOpen && 'rotate-90')} />{group.title}
              </button>
            ) : <p className="px-4 pb-1 pt-3 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">{group.title}</p>)}
            <ul hidden={group.collapsible && !moreOpen}>
              {group.items.filter((i) => (!i.perm || can(i.perm)) && (!i.mpfOnly || mpf)).map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.href}>
                    <Link href={hrefFor(item.href)} onClick={navigate(item.href)} className={cn('relative flex items-center gap-2.5 px-4 py-[7px] text-[13px] transition-colors',
                      active ? 'bg-[hsl(213_70%_95%)] font-semibold text-[hsl(var(--primary))] before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-[hsl(var(--primary))]' : 'text-slate-700 hover:bg-slate-50')}>
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.live && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t px-4 py-2 text-[10px] text-slate-400">RMW Analytics · {me?.org?.name}</div>
    </nav>
  );

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 bg-[hsl(var(--primary))] text-white">
        <div className="flex h-12 items-center gap-3 px-3 sm:px-4">
          <button className="rounded p-1 hover:bg-white/10 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
          <Link href="/overview" className="flex items-center gap-2">
            <img src="/rmw-mark.png" alt="Ritz Media World" className="h-8 w-8 rounded-sm bg-white object-contain p-0.5" />
            <span className="hidden leading-tight sm:block">
              <span className="block text-[13px] font-semibold">RMW Analytics</span>
              <span className="block text-[10px] text-white/70">Ritz Media World Group · Visitor Intelligence</span>
            </span>
          </Link>
          <div className="ml-2 sm:ml-4"><WebsiteSwitcher /></div>
          <div className="ml-auto flex items-center gap-1.5 [&_button]:text-white [&_button:hover]:bg-white/10">
            <LiveCount />
            <AlertBell />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded px-1.5 py-1">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15 text-[11px] font-semibold ring-1 ring-white/30">{(me?.user?.fullName || '?').split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase()}</span>
                  <span className="hidden text-left leading-tight md:block">
                    <span className="block text-[12px] font-medium">{me?.user?.fullName}</span>
                    <span className="block text-[10px] text-white/70">{me?.roleLabel || me?.role}</span>
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel className="font-normal">
                  <p className="text-sm font-medium">{me?.user?.fullName}</p>
                  <p className="truncate text-xs text-muted-foreground">{me?.user?.email}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{me?.roleLabel || me?.role} · {me?.org?.name}</p>
                </DropdownMenuLabel>
                {me?.organizations?.length > 1 && (
                  <>
                    <DropdownMenuSeparator />
                    {me.organizations.map((o) => (
                      <DropdownMenuItem key={o.id} onSelect={() => o.id !== me.org.id && switchOrg(o.id)}><Building2 /><span className="flex-1 truncate">{o.name}</span>{o.id === me.org.id && <Check className="text-primary" />}</DropdownMenuItem>
                    ))}
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild><Link href="/settings"><Settings />Settings</Link></DropdownMenuItem>
                <DropdownMenuItem asChild><Link href="/settings?tab=account"><KeyRound />Change password</Link></DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setLogoutOpen(true)}><LogOut />Log out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="h-[3px] bg-[hsl(var(--saffron))]" />
      </header>

      <aside className="fixed bottom-0 left-0 top-[51px] z-20 hidden w-56 border-r lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 shadow-xl">
            <div className="flex h-12 items-center justify-between bg-[hsl(var(--primary))] px-4 text-white">
              <span className="text-[13px] font-semibold">RMW Analytics</span>
              <button onClick={() => setOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button>
            </div>
            <div className="h-[calc(100%-3rem)]">{sidebar}</div>
          </aside>
        </div>
      )}
      <div className="lg:pl-56">
        <main className="mx-auto max-w-[1500px] p-4 sm:p-6">
          {showFilters && !pendingHref && <FilterBar />}
          {pendingHref ? (pendingHref.startsWith('/overview') ? <DashboardSkeleton /> : <PageSkeleton />) : children}
        </main>
      </div>
      <LogoutDialog open={logoutOpen} onOpenChange={setLogoutOpen} />
    </div>
  );
}

/** Placeholder for the whole app frame (header, sidebar, dashboard) while the session loads. */
function ShellSkeleton() {
  return (
    <div className="min-h-screen bg-background" aria-busy="true" aria-label="Loading">
      <div className="flex h-12 items-center gap-3 bg-[hsl(var(--primary))] px-4">
        <Skeleton className="h-7 w-7 rounded bg-white/20" />
        <Skeleton className="h-4 w-32 bg-white/20" />
        <Skeleton className="ml-4 hidden h-7 w-40 bg-white/20 md:block" />
        <div className="ml-auto flex items-center gap-3"><Skeleton className="h-6 w-6 rounded-full bg-white/20" /><Skeleton className="hidden h-4 w-24 bg-white/20 sm:block" /></div>
      </div>
      <div className="flex">
        <aside className="hidden w-56 shrink-0 space-y-2 border-r bg-white p-3 lg:block">
          {Array.from({ length: 14 }).map((_, i) => <Skeleton key={i} className={i % 5 === 0 ? 'mt-3 h-3 w-20' : 'h-5'} />)}
        </aside>
        <main className="mx-auto w-full max-w-[1500px] p-4 sm:p-6"><DashboardSkeleton /></main>
      </div>
    </div>
  );
}

/** Dashboard-shaped placeholder: header, KPI tiles, trend chart, panels. */
export function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2"><Skeleton className="h-6 w-40" /><Skeleton className="h-4 w-72 max-w-full" /></div>
        <div className="flex gap-2"><Skeleton className="h-8 w-36" /><Skeleton className="h-8 w-24" /></div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="rounded border border-l-[3px] bg-card px-3 py-2.5"><Skeleton className="h-3 w-20" /><Skeleton className="mt-2 h-6 w-16" /><Skeleton className="mt-1.5 h-3 w-24" /></div>
        ))}
      </div>
      <div className="rounded border bg-card p-3"><div className="mb-3 flex gap-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-6 w-20" />)}</div><Skeleton className="h-[240px] w-full" /></div>
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded border bg-card"><div className="border-b px-3 py-2.5"><Skeleton className="h-3 w-28" /></div><div className="space-y-2 p-3">{Array.from({ length: 6 }).map((__, j) => <Skeleton key={j} className="h-6" />)}</div></div>
        ))}
      </div>
    </div>
  );
}

/** Requires sign-in; the API enforces the same rules independently. */
export function AppShell({ children }) {
  const { me, loading, loggingOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (!loading && !me && !loggingOut) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [loading, me, loggingOut, router, pathname]);
  if (loggingOut) {
    return <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-sm text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" />Logging out…</div>;
  }
  if (loading || !me) return <ShellSkeleton />;
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <FiltersProvider><Shell>{children}</Shell></FiltersProvider>
    </Suspense>
  );
}
