import { redactText } from '@rmw-analytics/shared/privacy';
import { safe, clip } from '../core/util.js';

const MAX_PER_PAGE = 10;

/** Uncaught errors and unhandled promise rejections (message redacted, script URL without query). */
export function installErrors(t) {
  const { win } = t;
  let count = 0;
  t.on('pv', () => { count = 0; });
  const report = (msg, src, line, col) => {
    if (!t.cfg.trackErrors || t.disabled.errors || count >= MAX_PER_PAGE || !msg) return;
    count++;
    const p = { msg: clip(redactText(String(msg)), 300) };
    if (src) p.src = clip(String(src).split(/[?#]/)[0], 300);
    if (line) p.line = line;
    if (col) p.col = col;
    t.track('js_error', p);
  };
  win.addEventListener('error', safe((e) => {
    if (e.target && e.target !== win && e.target.tagName) return; // resource load errors
    report(e.message || (e.error && e.error.message), e.filename, e.lineno, e.colno);
  }));
  win.addEventListener('unhandledrejection', safe((e) => {
    const r = e.reason;
    report(`Unhandled rejection: ${r && r.message ? r.message : String(r)}`);
  }));
}
