import { safe, clip } from '../core/util.js';

/** <video>/<audio> play, pause and completion (capture phase: media events do not bubble). */
export function installMedia(t) {
  const doc = t.win.document;
  const plays = new WeakMap();
  const props = (el) => {
    const src = String(el.currentSrc || el.src || '').split(/[?#]/)[0];
    const dur = Number.isFinite(el.duration) ? Math.round(el.duration) : null;
    const p = { src: clip(src, 300) };
    const title = el.getAttribute('title') || el.getAttribute('aria-label');
    if (title) p.title = clip(title, 120);
    if (dur) { p.dur = dur; p.pct = Math.min(100, Math.round((el.currentTime / el.duration) * 100)); }
    return p;
  };
  const on = (type, name) => doc.addEventListener(type, safe((e) => {
    const el = e.target;
    if (!el || (el.tagName !== 'VIDEO' && el.tagName !== 'AUDIO') || !t.cfg.trackMedia || t.disabled.media) return;
    if (type === 'pause' && el.ended) return;
    if (type === 'play') {
      const n = (plays.get(el) || 0) + 1;
      plays.set(el, n);
      if (n > 5) return;
    }
    t.track(name, props(el));
  }), true);
  on('play', 'video_play');
  on('pause', 'video_pause');
  on('ended', 'video_complete');
}
