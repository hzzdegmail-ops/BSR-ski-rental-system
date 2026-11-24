import test from 'node:test';
import assert from 'node:assert/strict';
import {localRuntime} from '../local.mjs';
import {addSampleRecords} from '../scripts/sample-records.mjs';

test('sample records keep existing identities and queue order, reconcile simulated payments, and never repopulate a completed batch',async t=>{
  const app=await localRuntime(':memory:');t.after(()=>app.sqlite.close());
  await app.fetch(new Request('http://localhost/api/login',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({username:'north.staff',password:'BSR-demo-2026'})}));
  const s=app.sqlite;
  s.prepare("INSERT INTO customer(phone,name,created_at) VALUES('00000088001','演示·雪松',?)").run(new Date().toISOString());
  const old=s.prepare("SELECT * FROM customer WHERE phone='00000088001'").get();
  s.prepare("INSERT INTO customer(phone,name,created_at) VALUES('13911112222','测试名字本人',?)").run(new Date().toISOString());
  s.prepare("INSERT INTO service_task(customer_id,store_id,queue_no,current_stage,status,started_at,enqueued_at) VALUES(?,2,1,'等待接待','排队中',?,?)")
    .run(old.customer_id,new Date(Date.now()-60000).toISOString(),new Date(Date.now()-60000).toISOString());
  const oldTask=s.prepare('SELECT * FROM service_task').get();
  const result=await addSampleRecords(app);
  assert.deepEqual(result.added,{customers:10,contracts:6,reservations:4,repairs:4,queue:2});
  assert.equal(result.renamed,1);
  assert.deepEqual({...s.prepare('SELECT * FROM customer WHERE customer_id=?').get(old.customer_id)},{...old,name:'赵宁'});
  assert.equal(s.prepare("SELECT name FROM customer WHERE phone='13911112222'").get().name,'测试名字本人');
  assert.deepEqual(s.prepare('SELECT * FROM service_task WHERE task_id=?').get(oldTask.task_id),oldTask);
  assert.deepEqual(s.prepare('SELECT status,count(*) n FROM rental_contract GROUP BY status ORDER BY status').all().map(x=>[x.status,x.n]),
    [['已归还',2],['已确认',2],['租出',2]]);
  assert.equal(s.prepare("SELECT count(*) n FROM equipment_location_history WHERE movement_type='跨店归还'").get().n,2);
  for(const {id} of result.contracts) {
    const contract=s.prepare('SELECT * FROM rental_contract WHERE contract_id=?').get(id);
    const paid=s.prepare("SELECT sum(CASE WHEN request_type='退款' THEN -amount ELSE amount END) total FROM payment_request WHERE contract_id=? AND status='成功'").get(id).total;
    const price=JSON.parse(contract.price_snapshot);
    assert.equal(paid,contract.status==='已归还'?price.rent:price.total);
  }
  assert.equal(s.prepare("SELECT count(*) n FROM service_task WHERE task_type='提前预订' AND enqueued_at IS NOT NULL").get().n,0);
  assert.equal(s.prepare('PRAGMA foreign_key_check').all().length,0);
  const total=s.prepare('SELECT count(*) n FROM audit_event').get().n;
  assert.deepEqual((await addSampleRecords(app)).added,{customers:0,contracts:0,reservations:0,repairs:0,queue:0});
  assert.equal(s.prepare('SELECT count(*) n FROM audit_event').get().n,total);
});
