import { MongoMemoryReplSet } from 'mongodb-memory-server';

/**
 * Boots an in-memory MongoDB replica set and the Express app. Env vars are set before any
 * application module is imported (config/env.js validates on import).
 */
export async function setup() {
  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  Object.assign(process.env, {
    NODE_ENV: 'test',
    MONGODB_URI: mongo.getUri(),
    MONGODB_DB: `test_${Date.now()}`,
    SESSION_SECRET: 'x'.repeat(40),
    PII_ENCRYPTION_KEY: 'y'.repeat(40),
    IDENTITY_HASH_SECRET: 'z'.repeat(40),
    DASHBOARD_ORIGINS: 'http://dash.test',
    PUBLIC_API_URL: 'http://api.test',
    RUN_JOBS_IN_PROCESS: 'false',
    INGEST_ALLOW_MISSING_ORIGIN: 'false',
    REDIS_URL: '',
  });
  const db = await import('../src/config/db.js');
  await db.connectDb();
  const { createApp } = await import('../src/app.js');
  const app = createApp();
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;

  const teardown = async () => {
    server.close();
    await db.closeDb();
    await mongo.stop();
  };
  return { base, db, teardown };
}

/** Minimal cookie-jar client for the dashboard API. */
export function client(base, origin = 'http://dash.test') {
  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(`${base}/api/v1${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    const json = type.includes('json') ? await res.json() : null;
    return { status: res.status, json, data: json?.data, res };
  };
  return {
    get: (p, h) => call('GET', p, undefined, h),
    post: (p, b, h) => call('POST', p, b || {}, h),
    patch: (p, b) => call('PATCH', p, b),
    del: (p) => call('DELETE', p),
    cookie: () => cookie,
  };
}

let seq = 0;
export const id = (prefix) => `${prefix}_${Date.now().toString(36)}${(seq += 1).toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const UA_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

export function batch(siteId, events, ctx = {}) {
  return {
    siteId,
    v: 1,
    sentAt: Date.now(),
    ctx: { vid: ctx.vid || 'v_testvisitor01', sid: ctx.sid || 's_testsession01', lang: 'en-IN', tz: 'Asia/Kolkata', sw: 1920, sh: 1080, vw: 1440, vh: 800, ...ctx },
    events: events.map((e) => ({ id: e.id || id('e'), n: e.n, t: e.t || Date.now(), p: e.p || { u: 'https://example.com/', pa: '/', ti: 'Home' }, ...(e.pr ? { pr: e.pr } : {}) })),
  };
}

export async function sendBatch(base, body, { origin = 'https://example.com', ua = UA_CHROME, headers = {}, raw } = {}) {
  const res = await fetch(`${base}/api/v1/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', 'User-Agent': ua, ...(origin ? { Origin: origin } : {}), ...headers },
    body: raw || JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}
