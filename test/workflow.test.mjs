import assert from 'node:assert/strict';
import test from 'node:test';
import { localRuntime, sqliteBinding } from '../local.mjs';
import { dbFor } from '../server/data.js';
import { enqueue } from '../server/reception.js';
import { expandDemoInventory } from '../server/seed.js';
import { rankEquipment } from '../server/domain.js';
import { normalizeModelSizing } from '../server/sizing.js';

async function setup(t) {
  const app=await localRuntime(':memory:');
  t.after(()=>app.sqlite.close());
  const cookies=new Map();
  async function call(role,route,data={},status=200) {
    const response=await app.fetch(new Request('http://localhost/api/'+route,{
      method:'POST',headers:{'content-type':'application/json',cookie:cookies.get(role)||''},body:JSON.stringify(data)
    }));
    const result=await response.json();
    assert.equal(response.status,status,route+': '+JSON.stringify(result));
    if (route==='login') cookies.set(role,response.headers.get('set-cookie').split(';')[0]);
    return result;
  }
  for (const [role,username] of [['north','north.staff'],['south','south.staff'],['manager','manager'],['repair','repair']]) {
    await call(role,'login',{username,password:'BSR-demo-2026'});
  }
  async function rental({scenario='success',start=new Date().toISOString(),equipmentId=6}={}) {
    const {task}=await call('north','enqueue',{customerId:1});
    await call('north','begin',{taskId:task.task_id});
    const {token}=await call('north','recommend',{taskId:task.task_id,start,
      end:new Date(Date.parse(start)+86400000*2).toISOString(),
      fit:{height_cm:168,weight_kg:60,foot_length_mm:255,shoe_size:40,skill_level:'中级'},
      categories:['SKI'],pickup:1,returnStore:1});
    return call('north','confirm',{token,equipmentIds:[equipmentId],confirm:true,scenario});
  }
  const equipmentStatus=id=>app.sqlite.prepare('SELECT status FROM equipment WHERE equipment_id=?').get(id).status;
  return {call,rental,equipmentStatus,sqlite:app.sqlite,sweepPaymentHolds:app.sweepPaymentHolds};
}

test('concurrent check-in returns one active task and one audit event',async t=>{
  const {sqlite,call}=await setup(t);
  const db=dbFor(sqliteBinding(sqlite));
  const read=db.one;
  let release,reads=0;
  const barrier=new Promise(resolve=>{release=resolve;});
  db.one=async(sql,...values)=>{
    const result=await read(sql,...values);
    if (sql.includes('customer_id=? AND store_id=?') && ++reads<=2) {
      if (reads===2) release();
      await barrier;
    }
    return result;
  };
  const user=sqlite.prepare("SELECT * FROM user_account WHERE username='north.staff'").get();
  const [a,b]=await Promise.all([enqueue(db,user,{customerId:3}),enqueue(db,user,{customerId:3})]);
  assert.equal(a.task.task_id,b.task.task_id);
  assert.equal((await call('north','queue')).length,1);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM audit_event WHERE event_type='接待登记'").get().n,1);
});

test('queue uses arrival date even after service begins after midnight',async t=>{
  const {call,sqlite}=await setup(t);
  const {task:old}=await call('north','enqueue',{customerId:1});
  const {task:olderSecond}=await call('north','enqueue',{customerId:2});
  sqlite.prepare('UPDATE service_task SET enqueued_at=? WHERE task_id=?').run('2020-01-01T15:58:00.000Z',old.task_id);
  sqlite.prepare('UPDATE service_task SET enqueued_at=? WHERE task_id=?').run('2020-01-01T15:59:00.000Z',olderSecond.task_id);
  await call('north','begin',{taskId:old.task_id});
  const {task:current}=await call('north','enqueue',{customerId:3});
  assert.equal(current.queue_no,1);
  assert.deepEqual((await call('north','queue')).map(task=>task.task_id),[old.task_id,olderSecond.task_id,current.task_id]);
  await call('north','cancel-reception',{taskId:old.task_id,confirm:true});
  assert.deepEqual((await call('north','queue')).map(task=>task.task_id),[olderSecond.task_id,current.task_id]);
});

test('expired charge is read-only for manager and releases on staff refresh without a second charge',async t=>{
  const {call,rental,equipmentStatus,sqlite}=await setup(t);
  const c=await rental({scenario:'timeout'});
  const requestNo=c.payments[0].request_no;
  sqlite.prepare("UPDATE payment_request SET created_at='2020-01-01T00:00:00.000Z' WHERE request_no=?").run(requestNo);
  const manager=await call('manager','operations');
  assert.ok(manager.todos.some(todo=>todo.key===requestNo && todo.status.includes('锁定到期')));
  assert.equal(equipmentStatus(6),'临时锁定');
  await call('north','inventory');
  const retry=await call('north','retry',{requestNo,scenario:'success'});
  assert.equal(retry.contract.status,'已取消');
  assert.equal(retry.payments[0].response_code,'DEMO_CHARGE_EXPIRED');
  assert.equal(equipmentStatus(6),'可租');
  assert.equal((await call('north','queue')).length,0);
});

test('future pickup is blocked and an early cancellation keeps a single refund request',async t=>{
  const {call,rental,equipmentStatus}=await setup(t);
  const c=await rental({start:new Date(Date.now()+86400000*7).toISOString()});
  const contractId=c.contract.contract_id;
  await call('north','pickup',{contractId,confirm:true},409);
  assert.equal(equipmentStatus(6),'已预留');
  const pending=await call('north','cancel-uncollected',{contractId,confirm:true,scenario:'timeout'});
  const refund=pending.payments.find(p=>p.request_type==='退款');
  const result=await call('north','retry',{requestNo:refund.request_no,scenario:'success'});
  assert.equal(result.contract.status,'已取消');
  assert.equal(result.payments.filter(p=>p.request_type==='退款').length,1);
  assert.equal(equipmentStatus(6),'可租');
});

test('expired exchange releases replacement while keeping the original available for return',async t=>{
  const {call,rental,equipmentStatus,sqlite}=await setup(t);
  const c=await rental({equipmentId:9});
  const contractId=c.contract.contract_id;
  await call('north','pickup',{contractId,confirm:true});
  const args={contractId,oldId:9,reasonType:'偏好调整',condition:'完好'};
  const preview=await call('north','exchange-choices',args);
  const pending=await call('north','exchange',{...args,newId:6,token:preview.token,confirm:true,scenario:'timeout'});
  sqlite.prepare("UPDATE payment_request SET created_at='2020-01-01T00:00:00.000Z' WHERE request_no=?")
    .run(pending.price.pending.requestNo);
  const ret={contractId,storeId:1,equipmentIds:[9],inspections:{9:{condition:'完好'}}};
  const quote=await call('north','preview-return',ret);
  assert.equal(equipmentStatus(6),'可租');
  assert.equal(equipmentStatus(9),'租出');
  await call('north','return',{...ret,token:quote.token,confirm:true});
  assert.equal(equipmentStatus(9),'可租');
});

test('active contracts survive history volume and history can be filtered and paged',async t=>{
  const {call,rental,sqlite}=await setup(t);
  const c=await rental();
  await call('north','pickup',{contractId:c.contract.contract_id,confirm:true});
  const task=sqlite.prepare(`INSERT INTO service_task(customer_id,store_id,queue_no,current_stage,status,started_at)
    VALUES(1,1,99,'合同确认完成','已完成','2020-01-01T00:00:00Z')`);
  const row=sqlite.prepare(`INSERT INTO rental_contract(contract_no,service_task_id,customer_id,pickup_store_id,
    start_at,end_at,status,amount_due,price_snapshot)
    VALUES(?,?,1,1,'2020-01-01T00:00:00Z','2020-01-02T00:00:00Z','已归还',0,'{}')`);
  for (let i=0;i<110;i++) row.run('HISTORY-'+i,task.run().lastInsertRowid);
  const active=await call('north','contracts',{scope:'rental'});
  assert.deepEqual(active.rows.map(x=>x.contract_id),[c.contract.contract_id]);
  assert.ok((await call('north','contracts')).some(x=>x.contract_id===c.contract.contract_id));
  const first=await call('north','contracts',{scope:'history'});
  const second=await call('north','contracts',{scope:'history',page:2});
  assert.equal(first.rows.length,25);
  assert.ok(first.hasMore && second.rows[0].contract_id<first.rows.at(-1).contract_id);
  const match=await call('north','contracts',{scope:'history',key:'history-109'});
  assert.deepEqual(match.rows.map(x=>x.contract_no),['HISTORY-109']);
});

test('repair audit stays at the responsible store after equipment moves',async t=>{
  const {call,rental}=await setup(t);
  const {order}=await call('north','repair-submit',{equipmentId:6,storeId:1,fault:'测试故障',severity:'中',contractorId:1});
  const orderId=order.repair_order_id;
  await call('repair','repair-update',{orderId,status:'待验收',note:'已修理'});
  await call('north','repair-inspect',{orderId,result:'合格',note:'已核对'});
  const c=await rental();
  const contractId=c.contract.contract_id;
  await call('north','pickup',{contractId,confirm:true});
  const ret={contractId,storeId:2,equipmentIds:[6],inspections:{6:{condition:'完好'}}};
  const quote=await call('south','preview-return',ret);
  await call('south','return',{...ret,token:quote.token,confirm:true});
  const isRepairUpdate=e=>e.event_type==='更新维修进度' && e.targetObjects.some(t=>t.entityType==='repair_order'&&t.entityId===orderId);
  assert.ok((await call('manager','operations',{storeId:1})).events.some(isRepairUpdate));
  assert.ok(!(await call('manager','operations',{storeId:2})).events.some(isRepairUpdate));
  await call('manager','repair',{orderId});
  await call('manager','repair-update',{orderId,status:'待验收',note:'越权测试'},403);
});

test('waiting metrics distinguish started work from cancellations in the queue',async t=>{
  const initial=Date.parse('2026-11-14T04:00:00.000Z');
  t.mock.timers.enable({apis:['Date'],now:initial});
  const {call}=await setup(t);
  const at=minutes=>t.mock.timers.setTime(initial+minutes*60000);
  const started=(await call('north','enqueue',{customerId:1})).task;
  at(10);
  const cancelled=(await call('north','enqueue',{customerId:3})).task;
  at(20);
  await call('north','begin',{taskId:started.task_id});
  at(40);
  await call('north','cancel-reception',{taskId:cancelled.task_id,confirm:true});
  const stats=async()=> (await call('manager','operations')).summary;
  assert.equal((await stats()).waiting,20);
  assert.equal((await stats()).cancelledWaiting,30);
  await call('north','cancel-reception',{taskId:started.task_id,confirm:true});
  assert.equal((await stats()).waiting,20);
  assert.equal((await stats()).cancelledWaiting,30);
});

test('repair and audit searches reach older pages while preserving role and store filters',async t=>{
  const {call,sqlite}=await setup(t);
  const today=new Date().toISOString();
  const repair=sqlite.prepare(`INSERT INTO repair_order(ticket_no,equipment_id,contractor_id,created_by_user_id,
    status,fault_description,opened_at,completed_at,responsible_store_id) VALUES(?,1,?,1,'已关闭','测试',?,?,1)`);
  const event=sqlite.prepare(`INSERT INTO audit_event(actor_user_id,event_type,result,occurred_at,event_store_id)
    VALUES(1,?,'成功',?,?)`);
  const oldestRepair=Number(repair.run('OLDEST-REPAIR',1,today,today).lastInsertRowid);
  const oldestAudit=Number(event.run('历史盘点',today,1).lastInsertRowid);
  for (let i=0;i<151;i++) repair.run('HISTORY-'+i,i===0?null:1,today,today);
  for (let i=0;i<101;i++) event.run('历史盘点',today,1);
  event.run('历史盘点',today,2);

  const first=await call('north','repairs',{page:1});
  const last=await call('north','repairs',{page:7});
  assert.equal(first.total,153);
  assert.equal(first.rows.length,25);
  assert.ok(last.rows.some(row=>row.repair_order_id===oldestRepair));
  assert.deepEqual((await call('north','repairs',{key:'oldest-repair'})).rows.map(row=>row.repair_order_id),[oldestRepair]);
  assert.equal((await call('repair','repairs',{key:'HISTORY-0'})).total,0);
  assert.equal((await call('north','repairs',{key:'HISTORY-0'})).total,1);

  const before=sqlite.prepare('SELECT count(*) AS n FROM audit_event').get().n;
  const scope={storeId:1,auditKey:'历史盘点'};
  const firstAudit=await call('manager','operations',scope);
  const lastAudit=await call('manager','operations',{...scope,auditPage:5});
  assert.deepEqual(firstAudit.auditPagination,{total:102,page:1,pages:5});
  assert.equal(firstAudit.events.length,25);
  assert.equal(lastAudit.events.at(-1).audit_event_id,oldestAudit);
  assert.ok(lastAudit.events.every(row=>row.resolved_store_id===1));
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM audit_event').get().n,before);
});

test('phone lookup and reception reuse normalized numbers and identify ambiguous legacy entries',async t=>{
  const {call,sqlite}=await setup(t);
  await call('north','enqueue',{name:'格式校验',phone:'-------'},400);
  const first=await call('north','enqueue',{name:'格式校验',phone:'139 0000-8888'});
  const repeated=await call('north','enqueue',{name:'格式校验',phone:'13900008888'});
  assert.equal(first.task.task_id,repeated.task.task_id);
  assert.equal((await call('north','lookup',{key:'１３９ ００００８８８８'})).customer.phone,'13900008888');

  const add=sqlite.prepare("INSERT INTO customer(phone,name,created_at) VALUES(?,'旧档案',?)");
  const at=new Date().toISOString();
  const legacy=Number(add.run('139 0000 9999',at).lastInsertRowid);
  assert.equal((await call('south','enqueue',{name:'旧档案',phone:'13900009999'})).task.customer_id,legacy);
  add.run('139-0000-9999',at);
  await call('north','lookup',{key:'13900009999'},409);
  await call('north','enqueue',{name:'旧档案',phone:'13900009999'},409);
  assert.equal((await call('north','lookup',{key:String(legacy)})).customer.customer_id,legacy);
});

test('scheduled payment cleanup releases an expired lock without a staff request',async t=>{
  const {rental,call,sqlite,equipmentStatus,sweepPaymentHolds}=await setup(t);
  const detail=await rental({scenario:'timeout'});
  const no=detail.payments[0].request_no;
  sqlite.prepare("UPDATE payment_request SET created_at='2020-01-01T00:00:00.000Z' WHERE request_no=?").run(no);
  assert.equal(await sweepPaymentHolds(),1);
  assert.equal(await sweepPaymentHolds(),0);
  assert.equal(equipmentStatus(6),'可租');
  const result=await call('manager','contract',{contractId:detail.contract.contract_id});
  assert.equal(result.contract.status,'已取消');
  assert.equal(result.payments[0].response_code,'DEMO_CHARGE_EXPIRED');
});

test('manager comparison retains both stores and current queues across historical filters without writes',async t=>{
  const {call,sqlite}=await setup(t);
  await call('north','enqueue',{customerId:1});
  await call('south','enqueue',{customerId:2});
  await call('south','enqueue',{customerId:3});
  const before=sqlite.prepare('SELECT total_changes() AS n').get().n;
  const all=await call('manager','operations');
  const north=await call('manager','operations',{storeId:'1',from:'2020-01-01',to:'2020-01-02'});
  assert.equal(north.hasData,false);
  assert.equal(all.current.waiting,3);
  assert.equal(north.current.waiting,1);
  assert.equal(north.stores.length,2);
  assert.deepEqual(north.stores.map(s=>s.waiting),[1,2]);
  assert.deepEqual(north.stores,all.stores);
  assert.ok(north.todos.filter(t=>t.type==='接待').every(t=>t.store==='BSR 一店'));
  assert.equal(sqlite.prepare('SELECT total_changes() AS n').get().n,before);
  await call('north','operations',{},403);
  await call('repair','operations',{},403);
});

test('manager alerts distinguish safety action from elapsed deadlines',async t=>{
  const {call,sqlite}=await setup(t);
  const {task}=await call('north','enqueue',{customerId:1});
  sqlite.prepare('UPDATE service_task SET enqueued_at=? WHERE task_id=?')
    .run(new Date(Date.now()-50*60000).toISOString(),task.task_id);
  sqlite.prepare("UPDATE equipment SET status='待检查' WHERE equipment_id=6").run();
  const result=await call('manager','operations');
  const queue=result.todos.find(t=>t.type==='接待');
  assert.equal(queue.priority,'高');
  assert.ok(queue.overdueMinutes>=30 && queue.overdueMinutes<=31);
  assert.ok(queue.deadline);
  const inspection=result.todos.find(t=>t.type==='检查');
  assert.equal(inspection.priority,'高');
  assert.equal(inspection.deadline,null);
  assert.equal(inspection.overdueMinutes,null);
  assert.match(inspection.reason,/不可出租/);
});

test('expanded stock is idempotent and preserves existing equipment and business records',async t=>{
  const {call,sqlite}=await setup(t);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM equipment').get().n,316);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM equipment_model').get().n,79);
  sqlite.prepare("UPDATE equipment SET status='租出' WHERE legacy_asset_no='DEMO2-BOOT-T-230-1-1'").run();
  const before=sqlite.prepare('SELECT total_changes() n FROM (SELECT 1)').get().n;
  await expandDemoInventory(dbFor(sqliteBinding(sqlite)));
  assert.equal(sqlite.prepare('SELECT total_changes() n FROM (SELECT 1)').get().n,before);
  assert.equal(sqlite.prepare("SELECT status FROM equipment WHERE legacy_asset_no='DEMO2-BOOT-T-230-1-1'").get().status,'租出');
  const inventory=await call('north','inventory');
  assert.equal(inventory.filter(e=>e.legacy_asset_no?.startsWith('DEMO2-')&&e.inspection_result==='合格').length,260);
  assert.equal(sqlite.prepare(`SELECT count(*) n FROM safety_inspection si JOIN equipment e USING(equipment_id)
    JOIN equipment_model m USING(model_id) JOIN equipment_category c USING(category_id)
    WHERE m.model_code LIKE 'DEMO2-%' AND julianday(si.valid_until)-julianday(date(si.inspected_at,'+8 hours'))>c.safety_interval_days`).get().n,0);
});

test('the screenshot profile has a complete Touring rental plan in each store',async t=>{
  const {call}=await setup(t);
  const {task}=await call('north','enqueue',{customerId:1});
  await call('north','begin',{taskId:task.task_id});
  const result=await call('north','recommend',{taskId:task.task_id,start:new Date(Date.now()-60000).toISOString(),
    end:new Date(Date.now()+86400000).toISOString(),fit:{height_cm:160,weight_kg:50,foot_length_mm:238,shoe_size:36,skill_level:'初级'},
    categories:['SKI','BOOT'],pickup:1,returnStore:1,system:'Touring'});
  assert.equal(result.hasCompletePlan,true);
  assert.ok(result.storePlans.every(s=>s.complete && !s.trial.length));
  const equipmentIds=['SKI','BOOT'].map(category=>result.candidates.find(e=>e.current_store_id===1&&e.category===category).equipment_id);
  const contract=await call('north','confirm',{token:result.token,equipmentIds,confirm:true,scenario:'success'});
  assert.equal(contract.contract.status,'已确认');
  assert.equal(contract.items.length,2);
  assert.equal((await call('north','pickup',{contractId:contract.contract.contract_id,confirm:true})).contract.status,'租出');
});

test('nearest sizes require trial confirmation and store the real profile and review in the contract',async t=>{
  const {call,sqlite}=await setup(t);
  const {task}=await call('north','enqueue',{customerId:1});
  await call('north','begin',{taskId:task.task_id});
  const result=await call('north','recommend',{taskId:task.task_id,start:new Date(Date.now()-60000).toISOString(),
    end:new Date(Date.now()+86400000).toISOString(),fit:{height_cm:160,weight_kg:50,foot_length_mm:180,shoe_size:36,skill_level:'初级'},
    categories:['SKI','BOOT'],pickup:1,returnStore:1,system:'Alpine'});
  assert.ok(!result.candidates.some(e=>e.category==='BOOT'));
  const boots=result.alternatives.filter(e=>e.category==='BOOT'&&e.current_store_id===1);
  assert.ok(boots.length>0 && boots.length<=3);
  assert.ok(boots.every((e,i)=>!i||e.distanceScore>=boots[i-1].distanceScore));
  const equipmentIds=[result.candidates.find(e=>e.category==='SKI'&&e.current_store_id===1).equipment_id,boots[0].equipment_id];
  const selection={token:result.token,equipmentIds};
  await call('north','quote',selection,400);
  await call('north','quote',{...selection,fitConfirmed:true,fitNote:'   '},400);
  const approved={...selection,fitConfirmed:true,fitNote:'课程演示试穿核对：已逐项确认尺寸差异及穿着贴合情况'};
  const quote=await call('north','quote',approved);
  assert.ok(quote.price.fitReview);
  sqlite.prepare("UPDATE equipment SET status='维修中' WHERE equipment_id=?").run(boots[0].equipment_id);
  await call('north','confirm',{...approved,confirm:true,scenario:'success'},409);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM rental_contract').get().n,0);
  sqlite.prepare("UPDATE equipment SET status='可租' WHERE equipment_id=?").run(boots[0].equipment_id);
  const resultContract=await call('north','confirm',{...approved,confirm:true,scenario:'success'});
  assert.equal(resultContract.contract.status,'已确认');
  assert.equal(resultContract.price.fit.foot_length_mm,180);
  assert.equal(resultContract.price.fit.shoe_size,36);
  assert.equal(resultContract.price.fitReview.note,approved.fitNote);
  assert.equal(resultContract.price.fitReview.confirmedBy,1);
  assert.ok(sqlite.prepare("SELECT 1 FROM audit_event WHERE event_type='临近尺寸试穿确认'").get());
});

test('boot matching uses measured millimetres and treats EU shoe size as optional reference',async t=>{
  const {call}=await setup(t);
  const {task}=await call('north','enqueue',{customerId:1});
  await call('north','begin',{taskId:task.task_id});
  let expected;
  for (const shoe_size of [36,55,'']) {
    const result=await call('north','recommend',{taskId:task.task_id,start:new Date().toISOString(),end:new Date(Date.now()+86400000).toISOString(),
      fit:{height_cm:160,weight_kg:50,foot_length_mm:238,shoe_size,skill_level:'初级'},categories:['BOOT'],pickup:1,returnStore:1,system:'Alpine'});
    const ids=result.candidates.map(e=>e.equipment_id);
    if (expected) assert.deepEqual(ids,expected); else expected=ids;
    assert.ok(ids.length);
    assert.ok(result.candidates.every(e=>/^雪靴适配脚长 \d+～\d+ mm$/.test(e.size_spec)));
  }
});

test('size normalization is idempotent and historical receipts use current unit names without rewriting snapshots',async t=>{
  const {call,sqlite}=await setup(t);
  sqlite.prepare("UPDATE equipment_model SET size_spec='EU 38 / 240 mm',compatibility_rule=json_set(compatibility_rule,'$.shoe',json('[37,39]')) WHERE model_id=5").run();
  assert.equal(await normalizeModelSizing(dbFor(sqliteBinding(sqlite))),1);
  const model=sqlite.prepare('SELECT * FROM equipment_model WHERE model_id=5').get();
  assert.equal(model.size_spec,'雪靴适配脚长 230～244 mm');
  assert.equal(Object.hasOwn(JSON.parse(model.compatibility_rule),'shoe'),false);
  const before=sqlite.prepare('SELECT total_changes() n').get().n;
  assert.equal(await normalizeModelSizing(dbFor(sqliteBinding(sqlite))),0);
  assert.equal(sqlite.prepare('SELECT total_changes() n').get().n,before);
  const {task}=await call('north','enqueue',{customerId:1});
  await call('north','begin',{taskId:task.task_id});
  const result=await call('north','recommend',{taskId:task.task_id,start:new Date().toISOString(),end:new Date(Date.now()+86400000).toISOString(),
    fit:{height_cm:160,weight_kg:50,foot_length_mm:238,shoe_size:36,skill_level:'初级'},categories:['BOOT'],pickup:1,returnStore:1,system:'Alpine'});
  const detail=await call('north','confirm',{token:result.token,equipmentIds:[17],confirm:true,scenario:'success'});
  sqlite.prepare("UPDATE rental_contract SET price_snapshot=json_set(price_snapshot,'$.lines[0].size','EU 38 / 240 mm') WHERE contract_id=?").run(detail.contract.contract_id);
  const raw=sqlite.prepare('SELECT price_snapshot FROM rental_contract WHERE contract_id=?').get(detail.contract.contract_id).price_snapshot;
  const receipt=await call('manager','contract',{contractId:detail.contract.contract_id});
  assert.equal(receipt.price.lines[0].size,receipt.items[0].size_spec);
  assert.equal(receipt.price.lines[0].size,'雪靴适配脚长 230～244 mm');
  assert.equal(sqlite.prepare('SELECT price_snapshot FROM rental_contract WHERE contract_id=?').get(detail.contract.contract_id).price_snapshot,raw);
});

test('nearest sizing never bypasses availability, inspection, interface, skill or weight checks',()=>{
  const base={equipment_id:1,model_id:1,asset_no:'NEAR-1',category_code:'BOOT',model_name:'测试雪靴',brand:'BSR',size_spec:'240 mm',
    status:'可租',current_store_id:1,inspection_result:'合格',valid_until:'2099-01-01',compatibility_rule:JSON.stringify({foot:[230,244],shoe:[37,39],system:'Alpine'})};
  const fit={height_cm:160,weight_kg:50,foot_length_mm:225,shoe_size:36,skill_level:'初级'};
  const range={start:new Date().toISOString(),end:new Date(Date.now()+86400000).toISOString()};
  const rank=(unit,occupied=new Set())=>rankEquipment({units:[unit],occupied},fit,range,['BOOT'],1,'Alpine');
  assert.equal(rank(base).alternatives.length,1);
  for (const unit of [{...base,status:'维修中'},{...base,inspection_result:'不合格'},{...base,valid_until:'2020-01-01'},
    {...base,skill_level:'高级'},
    {...base,compatibility_rule:JSON.stringify({foot:[230,244],system:'Touring'})},
    {...base,compatibility_rule:JSON.stringify({foot:[230,244],weight:[60,90],system:'Alpine'})}]) {
    assert.equal(rank(unit).alternatives.length,0);
    assert.equal(rank(unit).candidates.length,0);
  }
  assert.equal(rank(base,new Set([1])).alternatives.length,0);
  assert.equal(rank({...base,compatibility_rule:JSON.stringify({system:'Touring'})}).excluded[0].check,false);
});
