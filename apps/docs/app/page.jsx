import Link from 'next/link';
import { PAGES } from '@/lib/content';

const BLURBS = {
  'getting-started': 'Create a website, paste one script, see visitors in seconds.',
  tracker: 'Script attributes, form attributes, the JavaScript API and privacy behaviour.',
  events: 'Every automatic event, its properties, and how custom events work.',
  api: 'Event ingestion (browser and server-side), authentication and the dashboard REST API.',
  privacy: 'What is and is not collected, retention, erasure, consent and security controls.',
  architecture: 'Components, data model, rollups and scaling.',
  deployment: 'Docker, nginx, MongoDB, Redis and production checklist.',
};

export default function Home() {
  return (
    <div className="rounded border bg-white px-6 py-5">
      <h1 className="text-[22px] font-semibold text-slate-900">RMW Analytics documentation</h1>
      <p className="mt-1 text-[13px] text-slate-600">One script on any website → events to the central API → one dashboard for every property.</p>
      <ul className="mt-5 grid gap-3 sm:grid-cols-2">
        {PAGES.map((p) => (
          <li key={p.slug}>
            <Link href={`/${p.slug}/`} className="block rounded border border-l-[3px] border-l-[#194173] px-4 py-3 hover:bg-slate-50">
              <span className="block text-[14px] font-semibold text-slate-900">{p.title}</span>
              <span className="block text-[12px] text-slate-600">{BLURBS[p.slug]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
