import { cn } from '@/lib/utils';

const LOGOS = { MPF: '/mpf-mark.png', RMW: '/rmw-mark.png', CT: '/ct-mark.png' };
// First three validated categorical slots (see dataviz palette); further sites fall back to slate.
const SLOTS = ['#2a78d6', '#eb6834', '#1baf7a'];

export function websiteColor(website, index = 0) {
  return website?.color || SLOTS[index % SLOTS.length] || '#64748b';
}

/** Small identity mark for a website: its logo when known, otherwise a coloured initial. */
export function WebsiteDot({ website, className }) {
  if (!website) return null;
  const logo = LOGOS[String(website.code || '').toUpperCase()];
  if (logo) return <img src={logo} alt="" aria-hidden className={cn('h-4 w-4 shrink-0 rounded-sm bg-white object-contain', className)} />;
  return (
    <span aria-hidden className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-[9px] font-bold text-white', className)} style={{ background: website.color || '#475569' }}>
      {String(website.code || website.name || '?')[0]}
    </span>
  );
}

export function WebsiteTag({ website }) {
  if (!website) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-slate-700 ring-1 ring-inset ring-slate-200">
      <WebsiteDot website={website} className="h-3.5 w-3.5" />{website.code}
    </span>
  );
}
