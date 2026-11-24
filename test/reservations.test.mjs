import assert from 'node:assert/strict';
import test from 'node:test';
import { localRuntime,sqliteBinding } from '../local.mjs';
import { dbFor } from '../server/data.js';
import { ensureReservationSchema } from '../server/reservations.js';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { seed } from '../server/seed.js';

test('version 5 cloud database migrates atomically before statements use the new columns',async t=>{
  const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());sqlite.exec('PRAGMA foreign_keys=ON');
  const journal=JSON.parse(await readFile(new URL('../drizzle/meta/_journal.json',import.meta.url),'utf8'));
  for(const entry of journal.entries.slice(0,5)) sqlite.exec(await readFile(new URL('../drizzle/'+entry.tag+'.sql',import.meta.url),'utf8'));
  sqlite.exec('PRAGMA user_version=5');const db=dbFor(sqliteBinding(sqlite));await seed(db);
  const rows=sqlite.prepare('SELECT * FROM service_reservation').all();
  await ensureReservationSchema(db);await ensureReservationSchema(db);
  assert.equal(sqlite.prepare('PRAGMA user_version').get().user_version,6);
  for(const row of rows) {const current=sqlite.prepare('SELECT * FROM service_reservation WHERE reservation_id=?').get(row.reservation_id);for(const key of Object.keys(row)) assert.equal(current[key],row[key]);}
  assert.equal(sqlite.prepare("SELECT count(*) n FROM sqlite_master WHERE name IN ('reservation_capacity_insert','reservation_capacity_update','reservation_customer_slot')").get().n,3);
  assert.equal(sqlite.prepare('PRAGMA foreign_key_check').all().length,0);
});

async function setup(t) {
  const app=await localRuntime(':memory:');t.after(()=>app.sqlite.close());const cookies={};
  async function call(role,route,body={},status=200) {
    const response=await app.fetch(new Request('http://localhost/api/'+route,{method:'POST',headers:{'content-type':'application/json',cookie:cookies[role]||''},body:JSON.stringify(body)}));
    const result=await response.json(); assert.equal(response.status,status,route+':'+JSON.stringify(result));
    if(route==='login') cookies[role]=response.headers.get('set-cookie').split(';')[0];return result;
  }
  for(const [role,username] of [['n','north.staff'],['s','south.staff'],['m','manager']]) await call(role,'login',{username,password:'BSR-demo-2026'});
  const date=new Date(Date.now()+8*3600000+86400000).toISOString().slice(0,10);
  const booking=(phone='00000088101')=>({name:'预约测试',phone,source:'电话',appointmentAt:date+'T02:00:00.000Z',start:date+'T02:00:00.000Z',end:date+'T08:00:00.000Z',
    fit:{height_cm:160,weight_kg:50,foot_length_mm:238,shoe_size:36,skill_level:'初级'},categories:['SKI','BOOT'],system:'Touring',returnStore:1});
  return {call,booking,sqlite:app.sqlite,date};
}
test('booking preparation keeps equipment available and check-in reuses requirements while walk-ins remain supported',async t=>{
  const {call,booking,sqlite}=await setup(t);
  const r=await call('n','reservation-save',booking());
  assert.equal((await call('n','queue')).length,0);
  const before=sqlite.prepare('SELECT equipment_id,status,version FROM equipment').all();
  const prepared=await call('n','reservation-prepare',{reservationId:r.reservation_id,version:r.version,note:'已联系顾客，到店试穿'});
  assert.equal(prepared.preparation.status,'方案已准备');assert.equal(prepared.preparation.choices.length,2);
  assert.deepEqual(sqlite.prepare('SELECT equipment_id,status,version FROM equipment').all(),before);
  const a=await call('n','enqueue',{customerId:r.customer_id,reservationId:r.reservation_id});
  const repeated=await call('n','enqueue',{customerId:r.customer_id,reservationId:r.reservation_id});assert.equal(a.task.task_id,repeated.task.task_id);
  const task=await call('n','task',{taskId:a.task.task_id});assert.equal(task.reservation.status,'已接待');assert.equal(task.reservation.requirements.fit.foot_length_mm,238);
  await call('n','begin',{taskId:task.task_id});
  const recommendations=await call('n','recommend',{...task.reservation.requirements,taskId:task.task_id,start:r.requested_start_at,end:r.requested_end_at});
  assert.ok(recommendations.hasCompletePlan);
  const w=await call('n','enqueue',{name:'现场测试',phone:'00000088102'});assert.equal(w.task.reservation_id,null);
  assert.equal((await call('n','queue')).length,2);
  await call('s','reservation',{reservationId:r.reservation_id},404);
  await call('m','reservations',{},403);
});
test('same estimated arrival time has no headcount cap and is not restricted to half-hour slots',async t=>{
  const {call,booking,sqlite}=await setup(t);let first;
  for(let i=0;i<8;i++) first=await call('n','reservation-save',booking('0000008820'+i));
  await call('n','reservation-save',{...booking('00000088209'),appointmentAt:booking().appointmentAt.replace('T02:00','T01:17')});
  await call('n','reservation-end',{reservationId:first.reservation_id,version:first.version,status:'已取消',confirm:true});
  assert.equal(sqlite.prepare("SELECT count(*) n FROM sqlite_master WHERE type='trigger' AND name LIKE 'reservation_capacity_%'").get().n,0);
});
test('rescheduling clears preparation and stale updates cannot replace it',async t=>{
  const {call,booking}=await setup(t);const payload=booking();
  const r=await call('n','reservation-save',payload);
  const p=await call('n','reservation-prepare',{reservationId:r.reservation_id,version:r.version});
  await call('n','reservation-save',{...payload,reservationId:r.reservation_id,version:r.version},409);
  const changed=await call('n','reservation-save',{...payload,appointmentAt:payload.appointmentAt.replace('T02:','T01:'),reservationId:r.reservation_id,version:p.version});
  assert.equal(changed.preparation,null);
  await call('n','reservation-end',{reservationId:r.reservation_id,version:changed.version,status:'未到店',confirm:true},400);
});
test('legacy appointments are preserved and arrival cannot silently relink a walk-in task',async t=>{
  const {call,sqlite}=await setup(t);const old=sqlite.prepare('SELECT * FROM service_reservation WHERE reservation_id=1').get();
  await ensureReservationSchema(dbFor(sqliteBinding(sqlite)));
  assert.deepEqual(sqlite.prepare('SELECT * FROM service_reservation WHERE reservation_id=1').get(),old);
  const w=await call('n','enqueue',{customerId:1});
  await call('n','enqueue',{customerId:1,reservationId:1},409);
  assert.equal((await call('n','task',{taskId:w.task.task_id})).reservation_id,null);
  await call('n','cancel-reception',{taskId:w.task.task_id,confirm:true});
  await call('n','enqueue',{customerId:1,reservationId:1});
});

test('an expired old booking is removed after an unrelated walk-in without relinking or changing that visit',async t=>{
 const {call,sqlite}=await setup(t);
 const {task}=await call('n','enqueue',{customerId:1});await call('n','begin',{taskId:task.task_id});
 sqlite.prepare("UPDATE service_task SET status='已完成',finished_at=? WHERE task_id=?").run(new Date().toISOString(),task.task_id);
 const visit=sqlite.prepare('SELECT * FROM service_task WHERE task_id=?').get(task.task_id);
 sqlite.prepare("UPDATE service_reservation SET requested_start_at='2020-01-01T01:00:00Z',requested_end_at='2020-01-02T01:00:00Z' WHERE reservation_id=1").run();
 const boot=await call('n','bootstrap');assert.ok(!boot.reservations.some(r=>r.reservation_no==='BSR-RES-001'));
 assert.equal(sqlite.prepare('SELECT status FROM service_reservation WHERE reservation_id=1').get().status,'已过期');
 assert.deepEqual(sqlite.prepare('SELECT * FROM service_task WHERE task_id=?').get(task.task_id),visit);
 const lookup=await call('n','lookup',{key:'13000000001'});assert.equal(lookup.customer.customer_id,1);assert.equal(lookup.reservation,null);
 assert.equal((await call('n','lookup',{key:'BSR-RES-001'})).reservation.status,'已过期');
 assert.equal((await call('n','reservations',{date:'2020-01-01'})).rows.find(r=>r.reservation_id===1).status,'已过期');
 assert.ok(!(await call('n','reservations')).rows.some(r=>r.reservation_id===1));
 await call('n','bootstrap');assert.equal(sqlite.prepare("SELECT count(*) n FROM audit_event WHERE event_type='预约状态校正'").get().n,1);
});

test('pending bookings with an explicit reception link are corrected and repeated check-in reuses the task',async t=>{
 const {call,sqlite}=await setup(t);const {task}=await call('n','enqueue',{customerId:1,reservationId:1});
 sqlite.prepare("UPDATE service_reservation SET status='待接待',version=version+1 WHERE reservation_id=1").run();
 assert.ok(!(await call('n','bootstrap')).reservations.some(r=>r.reservation_no==='BSR-RES-001'));
 assert.equal(sqlite.prepare('SELECT status FROM service_reservation WHERE reservation_id=1').get().status,'已接待');
 assert.equal((await call('n','enqueue',{customerId:1,reservationId:1})).task.task_id,task.task_id);
 assert.equal(sqlite.prepare("SELECT count(*) n FROM audit_event WHERE event_type='接待登记'").get().n,1);
});

test('a valid future appointment stays pending for a separate walk-in and legacy appointments obey the date filter',async t=>{
 const {call,date,booking}=await setup(t);const r=await call('n','reservation-save',booking('00000088501'));
 await call('n','enqueue',{customerId:r.customer_id});
 assert.ok((await call('n','bootstrap')).reservations.some(v=>v.reservation_id===r.reservation_id));
 assert.equal((await call('n','reservation',{reservationId:r.reservation_id})).status,'待接待');
 assert.ok(!(await call('n','reservations',{date})).rows.some(v=>v.reservation_id===1));
});
