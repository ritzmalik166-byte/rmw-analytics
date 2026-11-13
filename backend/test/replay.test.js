import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { setup, client, UA_CHROME } from './helpers.js';

let ctx;
let owner;
let site;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'replays-'));
const SID = 's_replaytest01';
const VID = 'v_replayvisitor01';

before(async () => {
  process.env.REPLAY_DIR = dir;
  ctx = await setup();
  owner = client(ctx.base);
  const reg = await owner.post('/auth/register', { fullName: 'Owner', email: 'rep@example.com', password: 'Sup3rSecretPass', organization: 'Org' });
  assert.equal(reg.status, 201, JSON.stringify(reg.json));
  const w = await owner.post('/websites', { name: 'Site', domain: 'https://www.example.com' });
  site = w.data;
});

after(async () => { await ctx?.teardown(); fs.rmSync(dir, { recursive: true, force: true }); });

const chunk = (seq, events, origin = 'https://www.example.com', gz = false) => {
  const body = JSON.stringify({ siteId: site.siteId, vid: VID, sid: SID, seq, t: Date.now(), events });
  return fetch(`${ctx.base}/api/v1/replay${gz ? '?z=1' : ''}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'text/plain', 'User-Agent': UA_CHROME }, body: gz ? zlib.gzipSync(body) : body });
};
const now = Date.now();
const snapshot = [
  { type: 4, timestamp: now, data: { href: 'https://www.example.com/pricing?x=1', width: 1280, height: 720 } },
  { type: 2, timestamp: now + 5, data: { node: { type: 0, childNodes: [] }, initialOffset: { top: 0, left: 0 } } },
];

test('replay: ignored until the website enables recordings', async () => {
  const r = await chunk(0, snapshot);
  assert.equal(r.status, 202);
  assert.equal((await r.json()).data.accepted, 0);
  assert.equal(fs.existsSync(path.join(dir, site.id)), false);
});

test('replay: chunks are stored, listed and fetched incrementally (live)', async () => {
  const on = await owner.patch(`/websites/${site.id}`, { settings: { replay: true } });
  assert.equal(on.status, 200, JSON.stringify(on.json));
  assert.equal((await fetch(`${ctx.base}/api/v1/sites/${site.siteId}/config`).then((r) => r.json())).data.replay, true);

  const bad = await chunk(0, snapshot, 'https://evil.test');
  assert.equal(bad.status, 403);
  assert.equal((await chunk(0, snapshot, undefined, true)).status, 202);
  assert.equal((await chunk(1, [{ type: 3, timestamp: now + 4000, data: { source: 1, positions: [] } }])).status, 202);

  const done = await owner.get('/replays');
  assert.equal(done.status, 200);
  assert.equal(done.data.rows.length, 0, 'in-progress recordings are hidden from the default (completed) list');
  const byVisitor = await owner.get(`/replays?status=all&visitor=${VID}`);
  assert.equal(byVisitor.data.rows.length, 1, 'visitor filter lists their recordings');

  const list = await owner.get('/replays?live=true');
  assert.equal(list.status, 200);
  const row = list.data.rows[0];
  assert.equal(row.sessionId, SID);
  assert.equal(row.live, true, 'last activity within the last minute counts as live');
  assert.deepEqual(row.pages, ['/pricing?x=1']);
  assert.equal(row.durationMs, 4000);

  // Page filter: case-insensitive "contains", regex characters treated literally.
  assert.equal((await owner.get('/replays?live=true&path=PRICING')).data.rows.length, 1, 'matches a page the recording covered');
  assert.equal((await owner.get('/replays?live=true&path=checkout')).data.rows.length, 0, 'excludes recordings that never visited the page');
  assert.equal((await owner.get(`/replays?live=true&path=${encodeURIComponent('pric.ng')}`)).data.rows.length, 0, '"." is literal, not a wildcard');
  assert.equal((await owner.get(`/replays?live=true&path_exact=true&path=${encodeURIComponent('/pricing')}`)).data.rows.length, 1, 'exact: same page with a query string matches');
  assert.equal((await owner.get(`/replays?live=true&path_exact=true&path=${encodeURIComponent('/')}`)).data.rows.length, 0, 'exact: "/" does not match every page');

  const full = await owner.get(`/replays/${site.id}/${SID}`);
  assert.equal(full.status, 200);
  assert.deepEqual(full.data.chunks.map((c) => c.seq), [0, 1]);
  assert.equal(full.data.chunks[0].events[1].type, 2);
  const tail = await owner.get(`/replays/${site.id}/${SID}?after=0`);
  assert.deepEqual(tail.data.chunks.map((c) => c.seq), [1]);

  const del = await owner.del(`/replays/${site.id}/${SID}`);
  assert.equal(del.status, 200);
  assert.equal((await owner.get(`/replays/${site.id}/${SID}`)).status, 404);
});

test('replay: malformed chunks are rejected', async () => {
  const r = await fetch(`${ctx.base}/api/v1/replay`, { method: 'POST', headers: { Origin: 'https://www.example.com', 'User-Agent': UA_CHROME }, body: JSON.stringify({ siteId: site.siteId, vid: VID, sid: '../../etc', seq: 0, events: snapshot }) });
  assert.equal(r.status, 400);
});
