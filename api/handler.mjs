import worker from '../dist/server/index.js';
import { createSnapshotRuntime } from '../server/snapshot-runtime.mjs';
import { blobSnapshots } from '../server/blob-snapshots.mjs';

const handle = createSnapshotRuntime(worker, blobSnapshots, process.env.SESSION_KEY);

export default async function handler(req, res) {
  const origin = 'https://' + req.headers.host;
  const incoming = new URL(req.url, origin);
  const route = incoming.searchParams.get('__bsr_route');
  const target = new URL(route ? '/api/' + route : incoming.pathname, origin);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  let body;
  if (!['GET', 'HEAD'].includes(req.method)) {
    if (req.body !== undefined) {
      body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    } else {
      const chunks = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      body = Buffer.concat(chunks);
    }
  }
  const response = await handle(new Request(target, { method: req.method, headers, body }));
  res.statusCode = response.status;
  for (const [key, value] of response.headers) res.setHeader(key, value);
  res.end(Buffer.from(await response.arrayBuffer()));
}
