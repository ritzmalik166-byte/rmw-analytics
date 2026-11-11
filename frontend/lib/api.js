export class ApiError extends Error {
  constructor(message, { status, errorCode, details } = {}) {
    super(message);
    this.status = status;
    this.errorCode = errorCode;
    this.details = details;
  }
}

export const ORG_KEY = 'rmwa:org';

function orgHeader() {
  try { const v = localStorage.getItem(ORG_KEY); return v ? { 'X-Org-Id': v } : {}; } catch { return {}; }
}

/** Fetch wrapper for the analytics API. Same-origin (/api/v1 is proxied), cookies included, JSON in and out. */
export async function api(path, { method = 'GET', body, signal, raw = false } = {}) {
  let res;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      credentials: 'include',
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...orgHeader() },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
      cache: 'no-store',
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('Network error. Check your connection and try again.', { status: 0, errorCode: 'NETWORK' });
  }
  if (raw && res.ok) return res;
  const json = await res.json().catch(() => null);
  const outage = res.status === 502 || res.status === 504 || (res.status === 503 && (!json || json.errorCode === 'MAINTENANCE'));
  if (outage && typeof window !== 'undefined') {
    window.__appMaintenance = { message: json?.message };
    window.dispatchEvent(new CustomEvent('app:maintenance', { detail: { message: json?.message } }));
  }
  if (!res.ok || json?.success === false) {
    const err = new ApiError(json?.message || `Request failed (${res.status})`, { status: res.status, errorCode: json?.errorCode, details: json?.details });
    if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/')) window.dispatchEvent(new CustomEvent('rmwa:unauthorized'));
    throw err;
  }
  return json?.data ?? null;
}

/** Download a file endpoint (CSV/XLSX/JSON) through the authenticated session. */
export async function download(path, fallbackName) {
  const res = await api(path, { raw: true });
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') || '';
  const name = /filename="([^"]+)"/.exec(cd)?.[1] || fallbackName;
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const apiMessage = (err) => err?.message || 'Something went wrong';
