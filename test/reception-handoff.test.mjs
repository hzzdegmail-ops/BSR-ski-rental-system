import test from 'node:test';
import assert from 'node:assert/strict';
import {localRuntime,sqliteBinding} from '../local.mjs';
import {dbFor} from '../server/data.js';
import {ensureMetricSchema} from '../server/operations-repository.js';

async function setup(t) {
  const app=await localRuntime(':memory:');t.after(()=>app.sqlite.close());const cookies={};let seq=0;
  async function call(route,body={},role='n',status=200) {
    const r=await app.fetch(new Request('http://localhost/api/'+route,{method:'POST',headers:{'content-type':'application/json',cookie:cookies[role]||''},body:JSON.stringify(body)}));
    const data=await r.json();assert.equal(r.status,status,route+JSON.stringify(data));
    if(route==='login')cookies[role]=r.headers.get('set-cookie').split(';')[0];return data;
  }
  for(const [role,username] of [['n','north.staff'],['s','south.staff'],['m','manager'],['r','repair']])await call('login',{username,password:'BSR-demo-2026'},role);
  const fit={height_cm:160,weight_kg:50,foot_length_mm:238,skill_level:'初级'};
  const range={start:new Date(Date.now()-60000).toISOString(),end:new Date(Date.now()+86400000).toISOString()};
  async function rental(pickup=1,returnStore=1) {
    const {task}=await call('enqueue',{name:'流程核对',phone:'00000993'+String(++seq).padStart(3,'0')});
    await call('begin',{taskId:task.task_id});
    const rec=await call('recommend',{taskId:task.task_id,...range,fit,categories:['SKI'],pickup,returnStore,system:'Alpine'});
    const unit=rec.candidates.find(c=>c.current_store_id===pickup);
    const result=await call('confirm',{token:rec.token,equipmentIds:[unit.equipment_id],confirm:true,scenario:'success'});
    return {result,task,unit};
  }
  return {app,db:app.sqlite,call,rental,fit,range};
}

test('the designated pickup store can deliver a different store rental exactly once',async t=>{
  const {db,call,rental}=await setup(t);const {result,task}=await rental(2);
  await call('pickup',{contractId:result.contract.contract_id,confirm:true},'n',403);
  await call('pickup',{contractId:result.contract.contract_id,confirm:true},'m',403);
  const delivered=await call('pickup',{contractId:result.contract.contract_id,confirm:true},'s');
  assert.equal(delivered.contract.status,'租出');assert.equal(delivered.contract.task_store_id,1);
  assert.equal(db.prepare('SELECT status FROM service_task WHERE task_id=?').get(task.task_id).status,'已完成');
  assert.equal((await call('queue')).length,0);
  await call('pickup',{contractId:result.contract.contract_id,confirm:true},'s',409);
  assert.equal(db.prepare("SELECT count(*) n FROM payment_request WHERE request_type='收费'").get().n,1);
  assert.equal(db.prepare("SELECT event_store_id FROM audit_event WHERE event_type='装备交付'").get().event_store_id,2);
});

test('paid pickup can be fitted and exchanged on the original contract without a fitting stage or a new queue number',async t=>{
  const {call,db,rental,fit}=await setup(t);const {result,task,unit}=await rental();
  const id=result.contract.contract_id;
  assert.equal(result.contract.task_status,'办理中');
  const second=(await call('enqueue',{name:'下一位',phone:'00000993999'})).task;
  await call('begin',{taskId:second.task_id});
  await call('reception-stage',{taskId:task.task_id,stage:'试装中'},'n',404);
  const queue=await call('queue');assert.equal(queue[0].queue_no,task.queue_no);assert.equal(queue[0].current_stage,'待取件');
  await call('pickup',{contractId:id,confirm:true});
  const body={contractId:id,oldId:unit.equipment_id,fit,reasonType:'尺码不合适',condition:'完好',reason:'取件后试装不合适'};
  const choices=await call('exchange-choices',body);assert.ok(choices.candidates.length);
  const changed=await call('exchange',{...body,newId:choices.candidates[0].equipment_id,token:choices.token,confirm:true,scenario:'success'});
  assert.equal(changed.contract.contract_id,id);assert.equal(changed.contract.contract_no,result.contract.contract_no);
  assert.equal(changed.price.adjustments.at(-1).type,'换装');
  assert.equal(db.prepare('SELECT queue_no FROM service_task WHERE task_id=?').get(task.task_id).queue_no,task.queue_no);
  assert.equal(db.prepare('SELECT count(*) n FROM service_task').get().n,2);
  assert.equal(db.prepare("SELECT count(*) n FROM payment_request WHERE request_type='收费'").get().n,1);
});

test('removed fitting stages restore active tasks without changing original queue, assignments, timing or historical tasks',async t=>{
  const {call,db,rental}=await setup(t);const {task}=await rental();
  db.prepare("UPDATE service_task SET current_stage='待复核' WHERE task_id=?").run(task.task_id);
  const before=db.prepare('SELECT * FROM service_task WHERE task_id=?').get(task.task_id);
  const managerBefore=db.prepare('SELECT * FROM audit_event ORDER BY audit_event_id').all();
  const ops=await call('operations',{},'m');assert.ok(!ops.stages.some(s=>['试装中','待复核'].includes(s.label)));
  assert.deepEqual(db.prepare('SELECT * FROM audit_event ORDER BY audit_event_id').all(),managerBefore);
  const restored=(await call('queue'))[0];assert.equal(restored.current_stage,'待取件');
  const after=db.prepare('SELECT * FROM service_task WHERE task_id=?').get(task.task_id);
  for(const key of Object.keys(before))if(key!=='current_stage')assert.deepEqual(after[key],before[key],key);
  assert.equal(db.prepare("SELECT count(*) n FROM audit_event WHERE event_type='接待环节回退'").get().n,1);
  await call('queue');assert.equal(db.prepare("SELECT count(*) n FROM audit_event WHERE event_type='接待环节回退'").get().n,1);
});

test('same-store actual return is distinct from changed agreed return and real cross-store movement',async t=>{
  const {call,db,rental}=await setup(t);
  for(const [agreed,actual,expected] of [[2,1,false],[1,2,true]]) {
    const {result,unit}=await rental(1,agreed);const id=result.contract.contract_id;
    await call('pickup',{contractId:id,confirm:true});
    const body={contractId:id,storeId:actual,equipmentIds:[unit.equipment_id],inspections:{[unit.equipment_id]:{condition:'完好',fee:0}}};
    const role=actual===2?'s':'n';const preview=await call('preview-return',body,role);
    assert.equal(preview.crossStore,expected);assert.equal(preview.changedReturnStore,true);
    await call('return',{...body,token:preview.token,confirm:true,scenario:'success'},role);
    const move=db.prepare('SELECT * FROM equipment_location_history WHERE contract_id=?').get(id);
    assert.equal(move.movement_type,expected?'跨店归还':'归还');
  }
  assert.equal(db.prepare("SELECT sum(metric_value) n FROM vw_operating_metric WHERE metric_code='cross_store_returns'").get().n,1);
});

test('reservation reminders use estimated arrival for both intent and paid booking without adding to the queue',async t=>{
  const {call,fit}=await setup(t);const arrival=new Date(Date.now()+3600000).toISOString();
  const r=await call('reservation-save',{name:'预约核对',phone:'00000993777',appointmentAt:arrival,start:new Date(Date.now()+5*3600000).toISOString(),end:new Date(Date.now()+29*3600000).toISOString(),fit,categories:['SKI'],system:'Alpine',returnStore:1,source:'电话'});
  let ops=await call('operations',{},'m');let todo=ops.todos.find(x=>x.key.startsWith(r.reservation_no));
  assert.equal(todo.at,arrival);assert.equal(todo.deadline,new Date(Date.parse(arrival)+20*60000).toISOString());
  const ch=await call('reservation-choices',{reservationId:r.reservation_id});
  await call('confirm',{token:ch.token,equipmentIds:[ch.candidates[0].equipment_id],confirm:true,scenario:'success'});
  ops=await call('operations',{},'m');todo=ops.todos.find(x=>x.key.startsWith(r.reservation_no));
  assert.equal(todo.status,'已预订');assert.equal(todo.at,arrival);assert.equal((await call('queue')).length,0);
});

test('leaving ends only an uncontracted visit and preserves its audit and original queue number',async t=>{
  const {call,db,rental}=await setup(t);const {task}=await call('enqueue',{name:'离店顾客',phone:'00000993666'});
  await call('cancel-reception',{taskId:task.task_id,confirm:true,reason:'离店未办理'});
  const old=db.prepare('SELECT * FROM service_task WHERE task_id=?').get(task.task_id);
  assert.equal(old.current_stage,'离店未办理');assert.equal(old.queue_no,task.queue_no);assert.equal(old.status,'已取消');
  assert.ok(db.prepare("SELECT 1 FROM audit_event WHERE event_type='离店未办理'").get());
  const paid=await rental();await call('cancel-reception',{taskId:paid.task.task_id,confirm:true,reason:'离店未办理'},'n',409);
});

test('version 9 corrects the statistics view without rewriting historical rows and remains idempotent',async t=>{
  const {db}=await setup(t);db.exec('PRAGMA user_version=8');
  const before=db.prepare('SELECT * FROM audit_event ORDER BY audit_event_id').all();
  await ensureMetricSchema(dbFor(sqliteBinding(db)));await ensureMetricSchema(dbFor(sqliteBinding(db)));
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,9);
  assert.deepEqual(db.prepare('SELECT * FROM audit_event ORDER BY audit_event_id').all(),before);
  assert.match(db.prepare("SELECT sql FROM sqlite_master WHERE name='vw_operating_metric'").get().sql,/from_store_id<>to_store_id/);
  assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().n,20);
});
