import { notFound } from 'next/navigation';
import { PAGES, renderPage } from '@/lib/content';

export const dynamicParams = false;
export function generateStaticParams() {
  return PAGES.map((p) => ({ slug: p.slug }));
}
export async function generateMetadata({ params }) {
  const { slug } = await params;
  return { title: PAGES.find((p) => p.slug === slug)?.title };
}

export default async function DocPage({ params }) {
  const { slug } = await params;
  const page = renderPage(slug);
  if (!page) notFound();
  return (
    <div className="flex gap-6">
      <article className="prose min-w-0 flex-1 rounded border bg-white px-6 py-5" dangerouslySetInnerHTML={{ __html: page.html }} />
      {page.headings.length > 2 && (
        <aside className="sticky top-[70px] hidden h-fit w-48 shrink-0 text-[12px] xl:block">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">On this page</p>
          <ul className="space-y-1">{page.headings.map((h) => <li key={h.id} className={h.depth === 3 ? 'pl-3' : ''}><a className="text-slate-600 hover:text-slate-900" href={`#${h.id}`}>{h.text}</a></li>)}</ul>
        </aside>
      )}
    </div>
  );
}
