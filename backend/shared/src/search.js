import { redactText } from './privacy.js';

/** Lower-case, collapse whitespace and strip punctuation so "3 BHK  Noida!" groups with "3 bhk noida". */
export function normalizeQuery(q) {
  return redactText(String(q || ''))
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s.+#&/-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/** URL parameters that commonly carry a site-search query. */
export const SEARCH_PARAMS = ['q', 's', 'search', 'query', 'keyword', 'keywords', 'term', 'k'];
