const KEY = 'rmwa_consent';
const OPT_OUT = 'rmwa_optout';

/** Persisted consent choice + opt-out flag (storing the choice itself is always permitted). */
export function createConsent(ls) {
  return {
    stored: () => (ls ? ls.get(KEY) : null),
    save: (v) => { if (ls) ls.set(KEY, v); },
    optedOut: () => Boolean(ls && ls.get(OPT_OUT) === '1'),
    setOptOut: (on) => { if (ls) { if (on) ls.set(OPT_OUT, '1'); else ls.del(OPT_OUT); } },
  };
}

/** Do-Not-Track or Global Privacy Control signalled by the browser. */
export function privacySignal(win) {
  const n = win.navigator || {};
  return n.doNotTrack === '1' || win.doNotTrack === '1' || n.globalPrivacyControl === true;
}
