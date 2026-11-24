import assert from 'node:assert/strict';
import test from 'node:test';
import {localRuntime,sqliteBinding} from '../local.mjs';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {dbFor} from '../server/data.js';
import {seed} from '../server/seed.js';
import {ensureAdvanceSchema} from '../server/advance-booking.js';

async function setup(t){
 const app=await localRuntime(':memory:');t.after(()=>app.sqlite.close());const cookies={};let number=0;
 const call=async(route,body={},status=200,role='n')=>{
  const res=await app.fetch(new Request('http://localhost/api/'+route,{method:'POST',headers:{'content-type':'application/json',cookie:cookies[role]||''},body:JSON.stringify(body)}));
  const data=await res.json();if(Array.isArray(status))assert.ok(status.includes(res.status),route+':'+JSON.stringify(data));else assert.equal(res.status,status,route+':'+JSON.stringify(data));
  if(route==='login')cookies[role]=res.headers.get('set-cookie').split(';')[0];return data;
 };
 await call('login',{username:'north.staff',password:'BSR-demo-2026'});
 await call('login',{username:'manager',password:'BSR-demo-2026'},200,'m');
 const create=async({offset=0,foot=238,categories=['SKI','BOOT'],duration=1,height=160,weight=50,skill='初级'}={})=>{
  const start=Date.now()+offset*86400000-60000;
  return call('reservation-save',{name:'提前预订测试',phone:'000000886'+String(++number).padStart(2,'0'),source:'电话',
   appointmentAt:new Date(Date.now()+Math.max(offset*86400000,600000)).toISOString(),start:new Date(start).toISOString(),end:new Date(start+duration*86400000).toISOString(),
   fit:{height_cm:height,weight_kg:weight,foot_length_mm:foot,skill_level:skill},categories,system:'Alpine',returnStore:1});
 };
 const choose=async r=>{const choices=await call('reservation-choices',{reservationId:r.reservation_id});const pool=[...choices.candidates,...choices.alternatives];
  return {choices,equipmentIds:r.requirements.categories.map(category=>pool.find(c=>c.category===category).equipment_id)};};
 const book=async(r,scenario='success')=>{const {choices,equipmentIds}=await choose(r);return call('confirm',{token:choices.token,equipmentIds,confirm:true,scenario});};
 return {call,create,choose,book,sqlite:app.sqlite};
}

test('prebooking reserves and charges without creating an arrival or queue statistics; confirmation is idempotent',async t=>{
 const {call,create,choose,sqlite}=await setup(t);const r=await create({offset:1});const {choices,equipmentIds}=await choose(r);
 const selected={token:choices.token,equipmentIds,confirm:true,scenario:'success'};const c=await call('confirm',selected);
 assert.equal(c.contract.status,'已确认');assert.ok(c.price.advanceBooking);assert.equal(c.contract.task_type,'提前预订');
 const task=sqlite.prepare('SELECT * FROM service_task WHERE task_id=?').get(c.contract.service_task_id);
 assert.equal(task.queue_no,0);assert.equal(task.enqueued_at,null);assert.equal((await call('queue')).length,0);
 assert.equal((await call('reservation',{reservationId:r.reservation_id})).status,'已预订');
 assert.equal((await call('operations',{},200,'m')).current.waiting,0);
 assert.equal(sqlite.prepare("SELECT coalesce(sum(metric_value),0) n FROM vw_operating_metric WHERE metric_code='reception_count'").get().n,0);
 assert.equal((await call('confirm',selected)).contract.contract_id,c.contract.contract_id);
 assert.equal(sqlite.prepare("SELECT count(*) n FROM payment_request WHERE request_type='收费'").get().n,1);
 await call('pickup',{contractId:c.contract.contract_id,confirm:true},409);
 await call('begin',{taskId:task.task_id},409);
});

test('paid reservation joins the real arrival queue after walk-ins and picks up the original contract without a second charge',async t=>{
 const {call,create,book,sqlite}=await setup(t);const r=await create();const c=await book(r);
 const walk=await call('enqueue',{name:'现场先到顾客',phone:'00000088701'});
 const arrival=await call('enqueue',{customerId:r.customer_id,reservationId:r.reservation_id});
 assert.equal(arrival.task.task_id,c.contract.service_task_id);assert.equal(arrival.task.queue_no,walk.task.queue_no+1);
 assert.deepEqual((await call('queue')).map(q=>q.task_id),[walk.task.task_id,arrival.task.task_id]);
 assert.equal((await call('enqueue',{customerId:r.customer_id,reservationId:r.reservation_id})).task.task_id,arrival.task.task_id);
 await call('pickup',{contractId:c.contract.contract_id,confirm:true},409);
 await call('begin',{taskId:arrival.task.task_id},409);
 await call('begin',{taskId:walk.task.task_id});
 const begun=await call('begin',{taskId:arrival.task.task_id});assert.equal(begun.task.prebookedContractId,c.contract.contract_id);
 const result=await call('pickup',{contractId:c.contract.contract_id,confirm:true});assert.equal(result.contract.status,'租出');
 assert.equal((await call('reservation',{reservationId:r.reservation_id})).status,'已完成');
 assert.equal(sqlite.prepare('SELECT foot_length_mm FROM customer_fit_profile WHERE customer_id=?').get(r.customer_id).foot_length_mm,238);
 assert.equal(sqlite.prepare('SELECT count(*) n FROM rental_contract').get().n,1);
 assert.equal(sqlite.prepare("SELECT count(*) n FROM payment_request WHERE request_type='收费'").get().n,1);
 assert.deepEqual((await call('queue')).map(q=>q.task_id),[walk.task.task_id]);
});

test('the same equipment accepts nonoverlapping rental periods and cancellation retains the other reservation',async t=>{
 const {call,create,choose}=await setup(t);const a=await create({offset:1,categories:['SKI']});const x=await choose(a),unit=x.equipmentIds[0];
 const ca=await call('confirm',{token:x.choices.token,equipmentIds:[unit],confirm:true,scenario:'success'});
 const b=await create({offset:3,categories:['SKI']});const y=await choose(b);assert.ok(y.choices.candidates.some(c=>c.equipment_id===unit));
 const cb=await call('confirm',{token:y.choices.token,equipmentIds:[unit],confirm:true,scenario:'success'});
 const overlap=await create({offset:1,categories:['SKI']});const z=await choose(overlap);assert.ok(!z.choices.candidates.some(c=>c.equipment_id===unit));
 await call('cancel-uncollected',{contractId:ca.contract.contract_id,confirm:true,scenario:'success'});
 assert.equal((await call('inventory')).find(e=>e.equipment_id===unit).status,'已预留');
 assert.equal((await call('contract',{contractId:cb.contract.contract_id})).contract.status,'已确认');
});

test('competing prebooking quotes cannot charge the same equipment for overlapping periods',async t=>{
 const {call,create,choose,sqlite}=await setup(t);const a=await create({offset:1,categories:['SKI']}),b=await create({offset:1,categories:['SKI']});
 const x=await choose(a),y=await choose(b),unit=x.equipmentIds[0];
 await call('confirm',{token:x.choices.token,equipmentIds:[unit],confirm:true,scenario:'success'});
 await call('confirm',{token:y.choices.token,equipmentIds:[unit],confirm:true,scenario:'success'},409);
 assert.equal(sqlite.prepare("SELECT count(*) n FROM payment_request WHERE request_type='收费' AND status='成功'").get().n,1);
 assert.equal((await call('reservation',{reservationId:b.reservation_id})).status,'待接待');
});

test('simultaneous overlapping reservations commit only one rental and one charge',async t=>{
 const {call,create,choose,sqlite}=await setup(t);const a=await create({offset:1,categories:['SKI']}),b=await create({offset:1,categories:['SKI']});
 const x=await choose(a),y=await choose(b),unit=x.equipmentIds[0];
 const results=await Promise.all([x,y].map(v=>call('confirm',{token:v.choices.token,equipmentIds:[unit],confirm:true,scenario:'success'},[200,409])));
 assert.equal(results.filter(v=>v.contract?.status==='已确认').length,1);
 assert.equal(sqlite.prepare("SELECT count(*) n FROM payment_request WHERE request_type='收费' AND status='成功'").get().n,1);
 assert.equal(sqlite.prepare("SELECT count(*) n FROM rental_contract WHERE status='已确认'").get().n,1);
});

test('payment timeout releases only its reservation, permits a new attempt, and never becomes an arrival',async t=>{
 const {call,create,choose,book,sqlite}=await setup(t);const a=await create({offset:1,categories:['SKI']}),ca=await book(a);
 const unit=ca.items[0].equipment_id,b=await create({offset:3,categories:['SKI']}),x=await choose(b);
 const cb=await call('confirm',{token:x.choices.token,equipmentIds:[unit],confirm:true,scenario:'timeout'});
 sqlite.prepare("UPDATE payment_request SET created_at='2020-01-01T00:00:00.000Z' WHERE contract_id=?").run(cb.contract.contract_id);
 await call('inventory');assert.equal((await call('reservation',{reservationId:b.reservation_id})).status,'待接待');
 assert.equal((await call('inventory')).find(e=>e.equipment_id===unit).status,'已预留');assert.equal((await call('queue')).length,0);
 const retry=await book(await call('reservation',{reservationId:b.reservation_id}));assert.equal(retry.contract.status,'已确认');
});

test('near-size prebooking waits for a real fitting at pickup and records no earlier trial confirmation',async t=>{
 const {call,create,book,sqlite}=await setup(t);const r=await create({foot:180});const c=await book(r);
 assert.equal(c.price.fitReview.pending,true);assert.equal(c.price.fitReview.confirmedAt,undefined);
 assert.equal(sqlite.prepare("SELECT count(*) n FROM audit_event WHERE event_type='临近尺寸试穿确认'").get().n,0);
 const arrival=await call('enqueue',{customerId:r.customer_id,reservationId:r.reservation_id});await call('begin',{taskId:arrival.task.task_id});
 await call('pickup',{contractId:c.contract.contract_id,confirm:true},400);
 const done=await call('pickup',{contractId:c.contract.contract_id,confirm:true,fitConfirmed:true,fitNote:'到店实物试穿合适，已核对接口和支撑'});
 assert.equal(done.price.fitReview.pending,false);assert.ok(done.price.fitReview.confirmedAt);
});

test('cancelling a future reservation does not return unsafe equipment to available stock',async t=>{
 const {call,create,book,sqlite}=await setup(t);const r=await create({offset:1,categories:['SKI']}),c=await book(r),id=c.items[0].equipment_id;
 sqlite.prepare("UPDATE equipment SET status='待检查',version=version+1 WHERE equipment_id=?").run(id);
 await call('cancel-uncollected',{contractId:c.contract.contract_id,confirm:true,scenario:'success'});
 assert.equal((await call('inventory')).find(e=>e.equipment_id===id).status,'待检查');
 assert.equal((await call('reservation',{reservationId:r.reservation_id})).status,'已取消');
});

test('version 7 migration removes capacity rules, preserves old rows and defaults their tasks to actual reception',async t=>{
 const s=new DatabaseSync(':memory:');t.after(()=>s.close());s.exec('PRAGMA foreign_keys=ON');const journal=JSON.parse(await readFile(new URL('../drizzle/meta/_journal.json',import.meta.url),'utf8'));
 for(const entry of journal.entries.slice(0,7))s.exec(await readFile(new URL('../drizzle/'+entry.tag+'.sql',import.meta.url),'utf8'));
 s.exec('PRAGMA user_version=7');const db=dbFor(sqliteBinding(s));await seed(db);const rows=s.prepare('SELECT * FROM service_reservation').all();
 await ensureAdvanceSchema(db);await ensureAdvanceSchema(db);assert.equal(s.prepare('PRAGMA user_version').get().user_version,8);
 assert.deepEqual(s.prepare('SELECT * FROM service_reservation').all(),rows);
 assert.equal(s.prepare("SELECT count(*) n FROM sqlite_master WHERE name LIKE 'reservation_capacity_%'").get().n,0);
 assert.equal(s.prepare('PRAGMA foreign_key_check').all().length,0);
});

test('prebooking respects an exchange payment lock and cancelling a later booking preserves that lock',async t=>{
 const {call,create,book,choose}=await setup(t);
 const profile={categories:['SKI'],height:180,weight:75,skill:'高级'};
 const r=await create(profile),c=await book(r),arrival=await call('enqueue',{customerId:r.customer_id,reservationId:r.reservation_id});
 await call('begin',{taskId:arrival.task.task_id});await call('pickup',{contractId:c.contract.contract_id,confirm:true});
 const search={contractId:c.contract.contract_id,oldId:c.items[0].equipment_id,reasonType:'偏好调整',reason:'到店偏好调整',condition:'完好',fit:c.price.fit};
 const preview=await call('exchange-choices',search);const replacement=preview.candidates.find(e=>e.delta!==0);assert.ok(replacement);
 await call('exchange',{...search,token:preview.token,newId:replacement.equipment_id,confirm:true,scenario:'timeout'});
 const competing=await create(profile),x=await choose(competing);
 assert.ok(!x.choices.candidates.some(e=>e.equipment_id===replacement.equipment_id));
 const future=await create({...profile,offset:3}),y=await choose(future);assert.ok(y.choices.candidates.some(e=>e.equipment_id===replacement.equipment_id));
 const futureContract=await call('confirm',{token:y.choices.token,equipmentIds:[replacement.equipment_id],confirm:true,scenario:'success'});
 await call('cancel-uncollected',{contractId:futureContract.contract.contract_id,confirm:true,scenario:'success'});
 assert.equal((await call('inventory')).find(e=>e.equipment_id===replacement.equipment_id).status,'临时锁定');
});
