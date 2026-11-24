import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sqliteBinding } from '../local.mjs';

export const snapshotPath = 'bsr-report-v10/database.sqlite';

export function createSnapshotRuntime(worker, store, sessionKey) {
  return async function handle(request) {
    const directory = await mkdtemp(join(tmpdir(), 'bsr-request-'));
    const filename = join(directory, 'database.sqlite');
    let database;
    try {
      const snapshot = await store.read();
      if (!snapshot) return Response.json({ error: '业务数据库尚未准备完成' }, { status: 503 });
      await writeFile(filename, snapshot.bytes);
      database = new DatabaseSync(filename);
      database.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE;');
      const response = await worker.fetch(request, {
        DB: sqliteBinding(database),
        SESSION_KEY: sessionKey,
        DEMO_PASSWORD: process.env.DEMO_PASSWORD
      });
      // No response or session cookie is sent before the complete request is durable.
      database.close();
      database = null;
      const bytes = await readFile(filename);
      if (!bytes.equals(snapshot.bytes)) {
        const saved = await store.write(bytes, snapshot.etag);
        if (!saved) {
          return Response.json({
            error: '业务记录已被其他操作更新，请刷新详情后继续'
          }, { status: 409, headers: { 'cache-control': 'no-store' } });
        }
      }
      return response;
    } catch (error) {
      console.error('Persistent request failed:', error.name);
      return Response.json({
        error: '保存或查询暂时失败，请刷新详情核对后继续'
      }, { status: 503, headers: { 'cache-control': 'no-store' } });
    } finally {
      database?.close();
      await rm(directory, { recursive: true, force: true });
    }
  };
}
