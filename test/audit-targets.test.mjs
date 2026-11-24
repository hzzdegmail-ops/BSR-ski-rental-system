import assert from 'node:assert/strict';
import test from 'node:test';
import {localRuntime} from '../local.mjs';

async function setup(t) {
  const app=await localRuntime(':memory:');t.after(()=>app.sqlite.close());const cookies={};
  async function call(role,route,body={},expected=200) {
    const r=await app.fetch(new Request('http://localhost/api/'+route,{method:'POST',
      headers:{'content-type':'application/json',cookie:cookies[role]||''},body:JSON.stringify(body)}));
    const data=await r.json();assert.equal(r.status,expected,route+': '+JSON.stringify(data));
    if(route==='login') cookies[role]=r.headers.get('set-cookie').split(';')[0];return data;
  }
  for(const name of ['manager','north.staff','repair']) await call(name,'login',{username:name,password:'BSR-demo-2026'});
  return {sql:app.sqlite,call};
}

test('manager audit uses business labels and searchable object codes while preserving immutable events and filters',async t=>{
  const {sql,call}=await setup(t);
  const at=new Date().toISOString();
  const eventId=Number(sql.prepare("INSERT INTO audit_event(actor_user_id,event_type,from_status,to_status,result,occurred_at,event_store_id) VALUES(3,'审计关联核对','待接收','维修中','成功',?,2)").run(at).lastInsertRowid);
  for(const [type,id] of [['equipment',4],['repair_order',1],['customer',1],['service_reservation',1],['store',2],['equipment_model',1],['repair_contractor',1],['equipment',99999],['legacy_unknown',123]])
    sql.prepare('INSERT INTO audit_event_target(audit_event_id,entity_type,entity_id) VALUES(?,?,?)').run(eventId,type,id);
  const before=sql.prepare('SELECT * FROM audit_event').all();
  const targets=sql.prepare('SELECT * FROM audit_event_target').all();
  const result=await call('manager','operations',{storeId:2,auditKey:'审计关联核对'});
  assert.deepEqual(result.missing,[]);
  const event=result.events.find(e=>e.audit_event_id===eventId);assert.ok(event);
  assert.ok(event.targets.includes('装备：SKI-145-04')&&event.targets.includes('维修工单：BSR-RP-001'));
  assert.ok(event.targets.includes('顾客：林雪'));
  assert.ok(!event.targets.includes('equipment#')&&!event.targets.includes('repair_order#')&&!event.targets.includes('legacy_unknown'));
  assert.equal(event.targetObjects.length,9);
  assert.equal(event.targetObjects.find(x=>x.entityId===99999).available,false);
  assert.equal(event.targetObjects.find(x=>x.entityType==='legacy_unknown').available,false);
  assert.ok((await call('manager','operations',{storeId:2,auditKey:'SKI-145-04'})).events.some(e=>e.audit_event_id===eventId));
  assert.ok(!(await call('manager','operations',{storeId:1,auditKey:'SKI-145-04'})).events.some(e=>e.audit_event_id===eventId));
  const ownLogin=(await call('manager','operations',{auditKey:'manager'})).events.find(e=>e.event_type==='工作会话登录'&&e.actor_user_id===4);
  assert.equal(ownLogin.targetObjects[0].label,'账号：值班经理（manager）');
  for(const target of event.targetObjects.filter(x=>x.available)) {
    const d=await call('manager','audit-target',{auditEventId:eventId,entityType:target.entityType,entityId:target.entityId});
    assert.equal(d.target.label,target.label);
  }
  const details=await call('manager','audit-target',{auditEventId:ownLogin.audit_event_id,entityType:'user_account',entityId:4});
  assert.ok(details.fields.some(x=>x.label==='登录账号'&&x.value==='manager'));
  assert.ok(!/SESSION_KEY|password|token/i.test(JSON.stringify(details)));
  await call('north.staff','audit-target',{auditEventId:eventId,entityType:'equipment',entityId:4},403);
  await call('repair','audit-target',{auditEventId:eventId,entityType:'equipment',entityId:4},403);
  await call('manager','audit-target',{auditEventId:eventId,entityType:'user_account',entityId:4},404);
  await call('manager','audit-target',{auditEventId:eventId,entityType:'legacy_unknown',entityId:123},404);
  await call('manager','audit-target',{auditEventId:eventId,entityType:'equipment',entityId:99999},404);
  await call('manager','repair-update',{orderId:1,status:'维修中'},403);
  assert.deepEqual(sql.prepare('SELECT * FROM audit_event').all(),before);
  assert.deepEqual(sql.prepare('SELECT * FROM audit_event_target').all(),targets);
});

test('audit contract and payment targets open their original business record without creating a new transaction',async t=>{
  const {sql,call}=await setup(t);
  const {task}=await call('north.staff','enqueue',{customerId:1});await call('north.staff','begin',{taskId:task.task_id});
  const now=Date.now();
  const r=await call('north.staff','recommend',{taskId:task.task_id,start:new Date(now-1000).toISOString(),end:new Date(now+86400000).toISOString(),
    fit:{height_cm:168,weight_kg:60,foot_length_mm:255,skill_level:'中级'},categories:['SKI'],pickup:1,returnStore:1});
  const contract=await call('north.staff','confirm',{token:r.token,equipmentIds:[r.candidates.find(e=>e.current_store_id===1).equipment_id],confirm:true,scenario:'success'});
  const events=(await call('manager','operations',{auditKey:contract.contract.contract_no})).events;
  const e=events.find(e=>e.targetObjects.some(x=>x.entityType==='rental_contract'));assert.ok(e);
  const before=sql.prepare('SELECT * FROM payment_transaction').all();
  const d=await call('manager','audit-target',{auditEventId:e.audit_event_id,entityType:'rental_contract',entityId:contract.contract.contract_id});
  assert.equal(d.contract.contract.contract_id,contract.contract.contract_id);
  assert.equal(d.contract.contract.customer_name,'林雪');
  const p=events.find(e=>e.targetObjects.some(x=>x.entityType==='payment_request'));assert.ok(p);
  const target=p.targetObjects.find(x=>x.entityType==='payment_request');
  const payment=await call('manager','audit-target',{auditEventId:p.audit_event_id,entityType:target.entityType,entityId:target.entityId});
  assert.ok(payment.fields.some(x=>x.label==='合同号'&&x.value===contract.contract.contract_no));
  assert.deepEqual(sql.prepare('SELECT * FROM payment_transaction').all(),before);
});
