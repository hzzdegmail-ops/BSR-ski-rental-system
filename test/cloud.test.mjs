import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

async function start(dataDirectory, publicOrigin = '') {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../cloud.mjs', import.meta.url))], {
    env: { ...process.env, SESSION_KEY: '', PORT: '0', HOST: '127.0.0.1', BSR_DATA_DIR: dataDirectory, PUBLIC_ORIGIN: publicOrigin },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let output = '';
  let errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  let timer;
  try {
    const ready = new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('exit', code => reject(new Error('Server exited: ' + code + ' ' + errors)));
      child.stdout.on('data', chunk => {
        output += chunk;
        const match = output.match(/BSR_SERVER_READY (\{[^\n]+\})/);
        if (match) resolve(JSON.parse(match[1]));
      });
      timer = setTimeout(() => reject(new Error('Server startup timed out: ' + errors)), 20000);
    });
    const { port } = await ready;
    return {
      url: 'http://127.0.0.1:' + port,
      async close() {
        const exited = once(child, 'exit');
        child.kill();
        await exited;
      }
    };
  } catch (error) {
    child.kill();
    throw error;
  } finally { clearTimeout(timer); }
}
const post = (server, path, data, headers = {}) => fetch(server.url + '/api/' + path, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(data)
});

test('independent server keeps data and the same session after restarting', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'bsr-server-test-'));
  let server;
  t.after(async () => { await server?.close(); await rm(directory, { recursive: true, force: true }); });
  server = await start(directory);
  assert.equal((await fetch(server.url + '/healthz')).status, 200);
  const login = await post(server, 'login', { username: 'north.staff', password: 'BSR-demo-2026' });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const created = await post(server, 'enqueue', { name: '迁移验证', phone: '00000088988' }, { cookie });
  assert.equal(created.status, 200);
  const { task } = await created.json();
  await server.close(); server = null;
  server = await start(directory);
  const queue = await post(server, 'queue', {}, { cookie });
  assert.equal(queue.status, 200);
  assert.ok((await queue.json()).some(row => row.task_id === task.task_id));
  assert.equal((await fetch(server.url + '/bsr.sqlite')).status, 404);
  assert.equal((await fetch(server.url + '/.session-key')).status, 404);
});

test('HTTPS proxy uses the configured public origin and secure session cookies', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'bsr-proxy-test-'));
  const server = await start(directory, 'https://course.example');
  t.after(async () => { await server.close(); await rm(directory, { recursive: true, force: true }); });
  const login = await post(server, 'login', { username: 'manager', password: 'BSR-demo-2026' }, { origin: 'https://course.example' });
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie'), /; Secure/);
  const rejected = await post(server, 'login', { username: 'manager', password: 'BSR-demo-2026' }, { origin: 'https://another.example' });
  assert.equal(rejected.status, 403);
});
