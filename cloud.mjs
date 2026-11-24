import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localRuntime } from './local.mjs';

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const dataDirectory = resolve(process.env.BSR_DATA_DIR || resolve(sourceDirectory, '../BSR独立服务器数据'));
await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
const keyFile = resolve(dataDirectory, '.session-key');
if (!process.env.SESSION_KEY) {
  try {
    await writeFile(keyFile, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  process.env.SESSION_KEY = (await readFile(keyFile, 'utf8')).trim();
}
if (process.env.SESSION_KEY.length < 32) throw new Error('会话密钥至少需要 32 个字符');

let publicOrigin = '';
if (process.env.PUBLIC_ORIGIN) {
  const configured = new URL(process.env.PUBLIC_ORIGIN);
  if (!['http:', 'https:'].includes(configured.protocol) || configured.username || configured.password ||
      configured.pathname !== '/' || configured.search || configured.hash) {
    throw new Error('PUBLIC_ORIGIN 必须是完整的网站访问地址，不含路径或登录信息');
  }
  publicOrigin = configured.origin;
}
const app = await localRuntime(resolve(dataDirectory, 'bsr.sqlite'));
const server = createServer(async (req, res) => {
  try {
    if (!req.url.startsWith('/') || req.url.startsWith('//')) {
      req.resume();
      res.writeHead(400).end('Invalid request');
      return;
    }
    const url = new URL((publicOrigin || 'http://' + req.headers.host) + req.url);
    if (req.method === 'GET' && url.pathname === '/healthz') {
      app.sqlite.prepare('SELECT 1').get();
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end('{"status":"ok"}');
      return;
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size <= 100000) chunks.push(chunk);
    }
    if (size > 100000) {
      res.writeHead(413, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: '请求数据过大' }));
      return;
    }
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const response = await app.fetch(new Request(url, { method: req.method, headers: req.headers, body }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error('Request failed:', error.name);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: '服务暂时不可用，请稍后重试' }));
  }
});
server.requestTimeout = 30000;
server.headersTimeout = 10000;
let sweeping = false;
const timer = setInterval(async () => {
  if (sweeping) return;
  sweeping = true;
  try { await app.sweepPaymentHolds(); }
  catch (error) { console.error('Payment hold cleanup failed:', error.name); }
  finally { sweeping = false; }
}, 60000).unref();

const port = Number(process.env.PORT || 8080);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT 配置无效');
server.listen(port, process.env.HOST || '0.0.0.0', () => {
  console.log('BSR_SERVER_READY ' + JSON.stringify({ port: server.address().port, dataDirectory }));
});
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  server.close(() => { app.sqlite.close(); process.exit(0); });
});
