import {pathToFileURL} from 'node:url';
import {copyFile,rename,rm,access} from 'node:fs/promises';
import {localRuntime,sqliteBinding} from '../local.mjs';
import {audit,dbFor} from '../server/data.js';

const batchLabel='课程样例 20261121';
const legacyCustomers=[
  ['13900000018','云端联测顾客','宋远'],
  ['00000088005','演示·松风','李明'],
  ['00000088004','演示·云岭','王浩'],
  ['00000088003','演示·白桦','张悦'],
  ['00000088001','演示·雪松','赵宁'],
  ['00000088002','演示·山茶','刘晨'],
  ['00000088919','演示·备用站点验证','孙楠'],
  ['00000077620','演示·尺码验收','吴桐'],
  ['00000088320','演示·预约云端验收','许晴'],
  ['00000088420','演示·装备命名验收','郑宇'],
  ['00000088820','演示·提前预订云端验收','何川']
];
const people=[
  ['赵晨',176,70,270,'中级'],['许悦',162,50,240,'初级'],
  ['顾然',172,65,260,'初级'],['唐可',182,82,280,'中级'],
  ['沈瑶',158,48,235,'初级'],['苏航',180,76,275,'中级'],
  ['陆川',170,65,255,'初级'],['程雨',165,54,245,'初级'],
  ['叶青',168,58,250,'初级'],['温宁',174,66,265,'中级']
].map(([name,height_cm,weight_kg,foot_length_mm,skill_level],i)=>({
  name,phone:'000000891'+String(i+1).padStart(2,'0'),
  fit:{height_cm,weight_kg,foot_length_mm,skill_level,equipment_preference:''}
}));

export async function addSampleRecords(app) {
  const sql=app.sqlite,db=dbFor(sqliteBinding(sql));
  let renamed=0;
  for(const [phone,oldName,name] of legacyCustomers) {
    const customer=await db.one('SELECT * FROM customer WHERE phone=? AND name=?',phone,oldName);
    if(!customer) continue;
    await db.batch([db.q('UPDATE customer SET name=? WHERE customer_id=? AND name=?',name,customer.customer_id,oldName),
      ...audit(db,null,'顾客姓名统一',oldName,name,[['customer',customer.customer_id]])]);
    renamed++;
  }
  if(await db.one("SELECT 1 FROM audit_event WHERE event_type='课程样例补充' AND result=?",batchLabel))
    return {renamed,added:{customers:0,contracts:0,reservations:0,repairs:0,queue:0}};
  for(const person of people) if(await db.one('SELECT 1 FROM customer WHERE phone=?',person.phone))
    throw new Error('样例号码已存在；请核对该批记录，避免重复或覆盖已有顾客');
  const earliest=await db.one("SELECT task_id FROM service_task WHERE store_id=1 AND task_type='现场接待' AND status='排队中' LIMIT 1");
  if(earliest) throw new Error('一店尚有顾客等待接待；请完成现有队列后再补充该批样例，不会越过已有顾客');
  const cookies={};
  async function call(role,route,body={}) {
    const response=await app.fetch(new Request('http://localhost/api/'+route,{method:'POST',
      headers:{'content-type':'application/json',cookie:cookies[role]||''},body:JSON.stringify(body)}));
    const data=await response.json();
    if(!response.ok) throw new Error(route+': '+(data.error||response.status));
    if(route==='login') cookies[role]=response.headers.get('set-cookie').split(';')[0];
    return data;
  }
  for(const [role,username] of [['n','north.staff'],['s','south.staff'],['r','repair']])
    await call(role,'login',{username,password:process.env.DEMO_PASSWORD||'BSR-demo-2026'});
  const base=Date.now(),iso=offset=>new Date(base+offset).toISOString();
  const day=86400000,hour=3600000;
  const localDate=new Date(base+8*hour).toISOString().slice(0,10);
  const arrivalBase=Math.max(base+hour,Date.parse(localDate+'T10:00:00+08:00'));
  const choose=(result,categories,store)=>categories.map(category=>{
    const unit=result.candidates.find(c=>c.category===category&&c.current_store_id===store);
    if(!unit) throw new Error('本店无完全适配的'+category+'，未自动放宽安全或尺寸条件');
    return unit.equipment_id;
  });
  const contracts=[],reservations=[],repairs=[];
  for(let i=0;i<4;i++) {
    const person=people[i],categories=i===1?['SKI','BOOT','POLE','HELMET']:['SKI','BOOT'];
    const {task}=await call('n','enqueue',{name:person.name,phone:person.phone});
    await call('n','begin',{taskId:task.task_id});
    const result=await call('n','recommend',{taskId:task.task_id,fit:person.fit,start:iso(-60000),end:iso(day*(i%2+1)),
      pickup:1,returnStore:i===3?2:1,categories,system:'Alpine'});
    const equipmentIds=choose(result,categories,1);
    let detail=await call('n','confirm',{token:result.token,equipmentIds,confirm:true,scenario:'success'});
    detail=await call('n','pickup',{contractId:detail.contract.contract_id,confirm:true});
    if(i>=2) {
      const role=i===3?'s':'n',storeId=i===3?2:1;
      const body={contractId:detail.contract.contract_id,storeId,equipmentIds,
        inspections:Object.fromEntries(equipmentIds.map(id=>[id,{condition:'完好',fee:0}]))};
      const preview=await call(role,'preview-return',body);
      detail=await call(role,'return',{...body,token:preview.token,confirm:true,scenario:'success'});
    }
    contracts.push({id:detail.contract.contract_id,name:person.name,status:detail.contract.status});
  }
  for(let i=4;i<8;i++) {
    const person=people[i],store=i%2===0?1:2,role=store===1?'n':'s';
    const start=new Date(arrivalBase+hour*(i-4)).toISOString();
    let row=await call(role,'reservation-save',{name:person.name,phone:person.phone,source:i%2===0?'电话':'微信',
      appointmentAt:start,start,end:new Date(Date.parse(start)+day).toISOString(),fit:person.fit,categories:['SKI','BOOT'],
      system:'Alpine',returnStore:store,note:i<6?'已沟通租期与取件门店，按约定时间到店核对。':'先登记需求，到店前联系顾客确认装备方案。'});
    if(i<6) {
      const result=await call(role,'reservation-choices',{reservationId:row.reservation_id});
      const detail=await call(role,'confirm',{token:result.token,equipmentIds:choose(result,['SKI','BOOT'],store),confirm:true,scenario:'success'});
      contracts.push({id:detail.contract.contract_id,name:person.name,status:detail.contract.status});
      row=await call(role,'reservation',{reservationId:row.reservation_id});
    } else row=await call(role,'reservation-prepare',{reservationId:row.reservation_id,version:row.version,note:'已核对本店适配库存，方案供顾客到店确认；尚未付款，不锁定装备。'});
    reservations.push({id:row.reservation_id,name:person.name,status:row.status,store});
  }
  const repairSamples=[
    [1,'HELMET','头盔内衬固定扣松脱','低','待分配'],
    [1,'BOOT','雪靴搭扣锁紧不顺畅','中','维修中'],
    [2,'POLE','雪杖腕带连接件松动','中','待验收'],
    [2,'SKI','双板固定器锁扣回弹迟缓','高','已关闭']
  ];
  for(const [store,category,fault,severity,status] of repairSamples) {
    const role=store===1?'n':'s',units=await call(role,'inventory');
    const unit=units.find(e=>e.current_store_id===store&&e.category_code===category&&e.status==='可租'&&!e.open_ticket);
    if(!unit) throw new Error('无可用的维修样例装备');
    let detail=await call(role,'repair-submit',{equipmentId:unit.equipment_id,storeId:store,fault,severity,contractorId:status==='待分配'?null:1});
    const orderId=detail.order.repair_order_id;
    if(status!=='待分配') detail=await call('r','repair-update',{orderId,status:'维修中',
      estimatedCompletionAt:iso(6*hour),note:'已接收装备并完成故障定位，正在检修连接及锁紧部件。'});
    if(['待验收','已关闭'].includes(status)) detail=await call('r','repair-update',{orderId,status:'待验收',
      note:'已完成部件紧固、更换及功能复测，提交责任门店进行安全验收。'});
    if(status==='已关闭') detail=await call(role,'repair-inspect',{orderId,result:'合格',note:'锁紧、释放及连接强度复核正常，安全验收合格。'});
    repairs.push({id:orderId,asset:unit.asset_no,status:detail.order.status,store});
  }
  const queue=[];
  for(let i=8;i<10;i++) {
    const role=i===8?'n':'s';
    const {task}=await call(role,'enqueue',{name:people[i].name,phone:people[i].phone});
    queue.push({id:task.task_id,name:people[i].name,store:task.store_id});
  }
  await db.batch(audit(db,null,'课程样例补充',null,'已补充',[
    ...contracts.map(c=>['rental_contract',c.id]),...reservations.map(r=>['service_reservation',r.id]),
    ...repairs.map(r=>['repair_order',r.id]),...queue.map(t=>['service_task',t.id])
  ],batchLabel));
  return {renamed,added:{customers:people.length,contracts:contracts.length,reservations:reservations.length,repairs:repairs.length,queue:queue.length},
    contracts,reservations,repairs,queue};
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url) {
  const target=process.env.BSR_DB_PATH;
  if(!target) throw new Error('请通过 BSR_DB_PATH 明确指定已有数据库；该命令不创建或重置云端数据');
  await access(target);
  const working=target+'.sample-'+Date.now()+'.sqlite';
  const {DatabaseSync}=await import('node:sqlite');
  const original=new DatabaseSync(target);
  try {
    if(original.prepare('PRAGMA journal_mode').get().journal_mode==='wal') original.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    await copyFile(target,working);
  } finally {original.close();}
  const app=await localRuntime(working);
  try {
    const result=await addSampleRecords(app);
    if(app.sqlite.prepare('PRAGMA foreign_key_check').all().length||app.sqlite.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')
      throw new Error('样例校验未通过，原数据库未替换');
    app.sqlite.exec('PRAGMA wal_checkpoint(TRUNCATE)');app.sqlite.close();
    await rename(working,target);
    console.log(JSON.stringify(result));
  } catch(error) {
    try{app.sqlite.close();}catch{}
    await rm(working,{force:true});
    throw error;
  } finally {
    await rm(working+'-wal',{force:true});await rm(working+'-shm',{force:true});
  }
}
