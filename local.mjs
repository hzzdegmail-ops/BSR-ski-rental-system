import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from './build.mjs';

export function sqliteBinding(sqlite) {
  return {
    prepare(sql) {
      return {
        bind(...values) {
          const statement=()=>sqlite.prepare(sql);
          return {
            first:async()=>statement().get(...values)??null,
            all:async()=>({results:statement().all(...values)}),
            run:()=>{ const result=statement().run(...values); return {meta:{last_row_id:Number(result.lastInsertRowid),changes:Number(result.changes)}}; }
          };
        }
      };
    },
    async batch(stmts) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const result=stmts.map(stmt=>stmt.run());
        sqlite.exec('COMMIT');
        return result;
      } catch(error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    }
  };
}
export async function localRuntime(path) {
  const sqlite=new DatabaseSync(path);
  sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
  const journal=JSON.parse(await readFile(new URL('./drizzle/meta/_journal.json',import.meta.url),'utf8'));
  let applied=sqlite.prepare('PRAGMA user_version').get().user_version;
  if (!applied && sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='customer'").get()) applied=1;
  for (const entry of journal.entries.slice(applied)) {
    const migration=await readFile(new URL('./drizzle/'+entry.tag+'.sql',import.meta.url),'utf8');
    sqlite.exec('BEGIN IMMEDIATE;');
    try {
      sqlite.exec(migration);
      sqlite.exec('PRAGMA user_version='+(entry.idx+1)+'; COMMIT;');
    } catch (error) {
      sqlite.exec('ROLLBACK;');
      throw error;
    }
  }
  const target=pathToFileURL(await mkdtemp(join(tmpdir(),'bsr-worker-'))+sep);
  await import('node:fs/promises').then(fs=>fs.writeFile(new URL('package.json',target),'{"type":"module"}'));
  const worker=(await import((await build(target)).href)).default;
  const env={DB:sqliteBinding(sqlite),SESSION_KEY:process.env.SESSION_KEY||randomBytes(32).toString('hex'),DEMO_PASSWORD:process.env.DEMO_PASSWORD};
  return {sqlite,fetch:request=>worker.fetch(request,env),sweepPaymentHolds:()=>worker.scheduled(null,env)};
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href===import.meta.url) {
  const path=process.env.BSR_DB_PATH||join(tmpdir(),'bsr-rental-4.sqlite');
  const app=await localRuntime(path);
  const port=Number(process.env.PORT||8765);
  let sweeping=false;
  setInterval(async()=>{
    if (sweeping) return;
    sweeping=true;
    try { await app.sweepPaymentHolds(); }
    catch (error) { console.error('Payment hold cleanup failed:',error.message); }
    finally { sweeping=false; }
  },60000).unref();
  createServer(async(req,res)=>{
    try {
      const chunks=[];
      for await (const chunk of req) chunks.push(chunk);
      const url=new URL(req.url,'http://'+req.headers.host);
      const data=chunks.length?Buffer.concat(chunks):undefined;
      const response=await app.fetch(new Request(url,{method:req.method,headers:req.headers,body:data}));
      res.writeHead(response.status,Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch(error) {
      console.error(error);
      res.writeHead(500).end('Local server error');
    }
  }).listen(port,'127.0.0.1',()=>console.log('BSR http://127.0.0.1:'+port));
}
