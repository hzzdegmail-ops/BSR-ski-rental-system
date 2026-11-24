import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localRuntime } from '../local.mjs';
import { createSnapshotRuntime } from '../server/snapshot-runtime.mjs';
import worker from '../dist/server/index.js';

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'bsr-snapshot-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = join(directory, 'test.sqlite');
  const original = await localRuntime(filename);
  await original.fetch(new Request('https://example.test/api/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'north.staff', password: 'BSR-demo-2026' })
  }));
  original.sqlite.close();
  let bytes = await readFile(filename);
  let version = 0;
  const store = {
    async read() {
      return { bytes: Buffer.from(bytes), etag: String(version) };
    },
    async write(next, etag) {
      if (etag !== String(version)) return false;
      bytes = Buffer.from(next);
      version++;
      return true;
    }
  };
  const runtime = createSnapshotRuntime(worker, store, 'x'.repeat(64));
  return async function call(route, body = {}, cookie = '') {
    return runtime(new Request('https://example.test/api/' + route, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body)
    }));
  };
}
test('a successful snapshot write survives a new request', async t => {
  const call = await setup(t);
  const login = await call('login', { username: 'north.staff', password: 'BSR-demo-2026' });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const profile = await call('bootstrap', {}, cookie);
  assert.equal(profile.status, 200);
  assert.equal((await profile.json()).user.username, 'north.staff');
});
test('two requests with the same snapshot cannot both overwrite it', async t => {
  const call = await setup(t);
  const credentials = { username: 'north.staff', password: 'BSR-demo-2026' };
  const result = await Promise.all([call('login', credentials), call('login', credentials)]);
  assert.deepEqual(result.map(r => r.status).sort(), [200, 409]);
  const failed = result.find(r => r.status === 409);
  assert.equal(failed.headers.get('set-cookie'), null);
  assert.equal((await call('login', credentials)).status, 200);
});
