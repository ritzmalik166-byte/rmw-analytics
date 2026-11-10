import fs from 'node:fs';
import path from 'node:path';
import { marked } from 'marked';

const ROOT = path.resolve(process.cwd(), '../..');

/** Docs pages are rendered from markdown in the repo so they never drift from the code. */
export const PAGES = [
  { slug: 'getting-started', title: 'Getting started', file: 'apps/docs/content/getting-started.md' },
  { slug: 'tracker', title: 'Tracker SDK', file: 'packages/tracker/README.md' },
  { slug: 'events', title: 'Event reference', file: 'apps/docs/content/events.md' },
  { slug: 'api', title: 'HTTP API', file: 'apps/docs/content/api.md' },
  { slug: 'privacy', title: 'Privacy & security', file: 'apps/docs/content/privacy.md' },
  { slug: 'architecture', title: 'Architecture', file: 'docs/ARCHITECTURE.md' },
  { slug: 'deployment', title: 'Deployment', file: 'infrastructure/DEPLOYMENT.md' },
];

export function renderPage(slug) {
  const page = PAGES.find((p) => p.slug === slug);
  if (!page) return null;
  const md = fs.readFileSync(path.join(ROOT, page.file), 'utf8');
  const headings = [];
  const renderer = new marked.Renderer();
  renderer.heading = ({ tokens, depth }) => {
    const text = tokens.map((t) => t.raw).join('');
    const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (depth === 2 || depth === 3) headings.push({ id, text: text.replace(/`/g, ''), depth });
    return `<h${depth} id="${id}">${marked.parseInline(text)}</h${depth}>`;
  };
  return { ...page, html: marked.parse(md, { renderer, gfm: true }), headings };
}
