import test from 'node:test';
import assert from 'node:assert/strict';
import {localRuntime} from '../local.mjs';
import {waitingStatistics,rentalTotals} from '../server/period-statistics.js';

async function setup(t) {
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-22T02:00:00.000Z')});
  const app=await localRuntime(':memory:');t.after(()=>app.sqlite.close());const cookies={};let number=0;
  async function call(route,body={},role='n') {
    const r=await app.fetch(new Request('http://localhost/api/'+route,{method:'POST',headers:{'content-type':'application/json',cookie:cookies[role]||''},body:JSON.stringify(body)}));
    const data=await r.json();assert.equal(r.status,200,route+JSON.stringify(data));
    if(route==='login')cookies[role]=r.headers.get('set-cookie').split(';')[0];return data;
  }
  for(const [role,username] of [['n','north.staff'],['s','south.staff'],['m','manager']])await call('login',{username,password:'BSR-demo-2026'},role);
  async function charge(pickup=1) {
    const {task}=await call('enqueue',{name:'经营统计核对',phone:'00000996'+String(++number).padStart(3,'0')});
    await call('begin',{taskId:task.task_id});
    const choices=await call('recommend',{taskId:task.task_id,start:new Date(Date.now()-3600000).toISOString(),end:new Date(Date.now()+3600000).toISOString(),fit:{height_cm:160,weight_kg:50,foot_length_mm:238,skill_level:'初级'},categories:['SKI'],pickup,returnStore:1,system:'Alpine'});
    const unit=choices.candidates.find(c=>c.current_store_id===pickup);
    const d=await call('confirm',{token:choices.token,equipmentIds:[unit.equipment_id],confirm:true,scenario:'success'});
    return {d,task,unit};
  }
  return {call,charge,db:app.sqlite};
}

test('delivered metrics exclude deposits and uncollected/cancelled orders and count the first delivery once',async t=>{
  const {call,charge,db}=await setup(t);const first=await charge();const id=first.d.contract.contract_id;
  assert.equal((await call('operations',{},'m')).summary.rentalCount,0);
  await call('pickup',{contractId:id,confirm:true});
  const pending=await charge();await charge(2);
  await call('cancel-uncollected',{contractId:pending.d.contract.contract_id,confirm:true,scenario:'success'});
  const oldDay='2026-11-21T02:00:00.000Z';
  db.prepare('UPDATE rental_contract SET start_at=? WHERE contract_id=?').run(oldDay,id);
  const event=db.prepare("INSERT INTO audit_event(actor_user_id,event_type,occurred_at,result,event_store_id) VALUES(1,'装备交付',?,'成功',1)").run(new Date().toISOString());
  db.prepare("INSERT INTO audit_event_target(audit_event_id,entity_type,entity_id) VALUES(?,'rental_contract',?)").run(event.lastInsertRowid,id);
  const before=db.prepare('SELECT * FROM audit_event ORDER BY audit_event_id').all();
  const current=(await call('operations',{from:'2026-11-22',to:'2026-11-22'},'m')).summary;
  assert.equal(current.rentalCount,1);assert.equal(current.rentalRent,first.d.price.rent);assert.notEqual(current.rentalRent,first.d.price.total);
  const prior=(await call('operations',{from:'2026-11-21',to:'2026-11-21'},'m')).summary;assert.equal(prior.rentalCount,0);
  assert.deepEqual(db.prepare('SELECT * FROM audit_event ORDER BY audit_event_id').all(),before);
});

test('delivery attribution follows the pickup store and return deposits do not reduce the agreed rent',async t=>{
  const {call,charge}=await setup(t);const {d,unit}=await charge(2);const id=d.contract.contract_id;
  await call('pickup',{contractId:id,confirm:true},'s');
  const body={contractId:id,storeId:1,equipmentIds:[unit.equipment_id],inspections:{[unit.equipment_id]:{condition:'完好',fee:0}}};
  const preview=await call('preview-return',body);await call('return',{...body,token:preview.token,confirm:true,scenario:'success'});
  const north=(await call('operations',{storeId:1},'m')).summary,south=(await call('operations',{storeId:2},'m')).summary;
  assert.equal(north.rentalCount,0);assert.equal(south.rentalCount,1);assert.equal(south.rentalRent,d.price.rent);
});

test('waiting averages retain long same-day waits while cross-day and missing timestamps require review without mutation',()=>{
  const from='2026-11-21T16:00:00.000Z',to='2026-11-22T15:59:59.999Z',cutoff=to;
  const base={task_type:'现场接待',assigned_user_id:1,name:'样例',store_name:'一店',arrived_at:'2026-11-22T00:00:00.000Z'};
  const rows=[{...base,task_id:1,started_at:'2026-11-22T00:20:00.000Z'},
    {...base,task_id:2,started_at:'2026-11-22T08:00:00.000Z'},
    {...base,task_id:3,assigned_user_id:null,started_at:'2026-11-22T00:30:00.000Z'},
    {...base,task_id:4,task_type:'提前预订',started_at:'2026-11-22T00:30:00.000Z'}];
  const good=waitingStatistics(rows,from,to,cutoff);assert.equal(good.samples,2);assert.equal(good.average,250);
  rows.push({...base,task_id:5,arrived_at:'2026-11-21T15:59:00.000Z',started_at:'2026-11-21T16:01:00.000Z'},
    {...base,task_id:6,arrived_at:null,started_at:'2026-11-22T01:00:00.000Z'});
  const before=JSON.stringify(rows),review=waitingStatistics(rows,from,to,cutoff);
  assert.equal(review.average,null);assert.equal(review.samples,4);assert.equal(review.review.length,2);assert.equal(review.review[0].minutes,2);
  assert.equal(review.observedAverage,167.3);assert.equal(JSON.stringify(rows),before);
});

test('empty and incomplete rental amounts are distinct from real zero rent',()=>{
  assert.deepEqual(rentalTotals([]),{count:0,rent:0,missingRent:0});
  assert.deepEqual(rentalTotals([{rent:0}]),{count:1,rent:0,missingRent:0});
  assert.deepEqual(rentalTotals([{rent:100},{rent:null}]),{count:2,rent:null,missingRent:1});
  assert.equal(waitingStatistics([],'2026-11-21','2026-11-23','2026-11-23').average,null);
});
