import { rid, store } from './util.js';

export const SESSION_IDLE_MS = 30 * 60 * 1000;
const VK = 'rmwa_vid';
const SK = 'rmwa_sess';
const VID_RE = /^v_[a-z0-9]{8,40}$/;
const SID_RE = /^s_[a-z0-9_]{6,48}$/;

/**
 * Pseudonymous first-party identifiers.
 * mode: 'local'  – visitor + session in localStorage (default once allowed)
 *       'session'– per-tab sessionStorage only (cookieless)
 *       'memory' – nothing persisted (before consent / after denial)
 * Existing values are read at start-up, but nothing is written until setMode() is called.
 */
export function createIds(win) {
  const ls = store(win, 'localStorage');
  const ss = store(win, 'sessionStorage');
  let mode = 'memory';
  let vid = (ls && ls.get(VK)) || (ss && ss.get(VK)) || '';
  let visitorNew = false;
  if (!VID_RE.test(vid)) { vid = `v_${rid(16)}`; visitorNew = true; }
  const parse = (raw) => {
    try {
      const s = JSON.parse(raw || 'null');
      return s && SID_RE.test(s.id) && typeof s.last === 'number' ? s : null;
    } catch (e) { return null; }
  };
  const target = () => (mode === 'local' ? ls : mode === 'session' ? ss : null);
  const read = () => target() && parse(target().get(SK));
  let sess = parse((ls && ls.get(SK)) || (ss && ss.get(SK)));
  let lastSave = 0;

  const save = () => {
    const t = target();
    if (!t) return;
    t.set(VK, vid);
    if (sess) t.set(SK, JSON.stringify(sess));
  };

  return {
    get vid() { return vid; },
    get sid() { return sess ? sess.id : null; },
    get visitorNew() { return visitorNew; },
    get mode() { return mode; },
    consumeVisitorNew() { const v = visitorNew; visitorNew = false; return v; },
    setMode(m) {
      mode = m;
      if (m !== 'local' && ls) { ls.del(VK); ls.del(SK); }
      if (m === 'memory' && ss) { ss.del(VK); ss.del(SK); }
      save();
    },
    /** Advance the session clock; returns the session id and whether a new session started. */
    touch(t) {
      const shared = read(); // another tab may have extended or rotated the session
      if (shared && (!sess || shared.last > sess.last)) sess = shared;
      let isNew = false;
      if (!sess || t - sess.last > SESSION_IDLE_MS) {
        sess = { id: `s_${t.toString(36)}_${rid(8)}`, last: t };
        isNew = true;
      }
      if (t > sess.last) sess.last = t;
      if (isNew || t - lastSave > 5000) { lastSave = t; save(); }
      return { sid: sess.id, isNew };
    },
    /** New visitor id (e.g. on logout). */
    reset() {
      vid = `v_${rid(16)}`;
      visitorNew = true;
      sess = null;
      save();
    },
  };
}
