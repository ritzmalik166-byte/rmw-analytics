import Link from 'next/link';
import { PAGES } from '@/lib/content';
import './globals.css';

export const metadata = { title: { default: 'RMW Analytics Docs', template: '%s · RMW Analytics Docs' }, description: 'Install the tracker, send events, and run the platform.' };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <header className="sticky top-0 z-10 bg-[#194173] text-white">
          <div className="flex h-12 items-center gap-2 px-4">
            <span className="leading-tight">
              <span className="block text-[13px] font-semibold">RMW Analytics · Docs</span>
              <span className="block text-[10px] text-white/70">Tracker SDK · HTTP API · Self-hosting</span>
            </span>
          </div>
          <div className="h-[3px] bg-[#f38a1c]" />
        </header>
        <div className="mx-auto flex max-w-6xl gap-6 px-4 py-6">
          <nav className="sticky top-[70px] hidden h-fit w-52 shrink-0 rounded border bg-white py-2 md:block">
            <p className="px-4 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">Documentation</p>
            <ul>{PAGES.map((p) => <li key={p.slug}><Link className="block px-4 py-[7px] text-[13px] text-slate-700 hover:bg-slate-50" href={`/${p.slug}/`}>{p.title}</Link></li>)}</ul>
          </nav>
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
