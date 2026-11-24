import { audit, activeStore, iso, now, positiveId, requireRule, textField, uid } from './data.js';
import { categories, fitProfile, rentalDates } from './domain.js';
import { recommend } from './equipment-repository.js';

const legacySlotCapacity = 4;
export async function refreshReservationStates(db) {
  const at=now();
  const rows=await db.all(`SELECT r.*,EXISTS(SELECT 1 FROM service_task t
    WHERE t.reservation_id=r.reservation_id AND t.task_type='现场接待' AND t.status<>'已取消') AS has_reception
    FROM service_reservation r WHERE r.status='待接待' AND (
      julianday(r.requested_end_at)<=julianday(?) OR EXISTS(SELECT 1 FROM service_task t
      WHERE t.reservation_id=r.reservation_id AND t.task_type='现场接待' AND t.status<>'已取消'))`,at);
  if (!rows.length) return;
  const queries=[];
  for (const r of rows) {
    const next=r.has_reception?'已接待':'已过期';
    queries.push(db.q(`UPDATE service_reservation SET version=CASE WHEN status='待接待' AND version=? THEN version+1 ELSE NULL END,status=?
      WHERE reservation_id=?`,r.version,next,r.reservation_id),
      ...audit(db,null,'预约状态校正','待接待',next,[['service_reservation',r.reservation_id]],
        r.has_reception?'已有明确关联的有效接待任务':'预约租期已结束，未关联有效接待任务',r.store_id));
  }
  await db.batch(queries);
}
export function pendingReservations(db,user) {
  return db.all(`SELECT sr.reservation_id,sr.reservation_no,sr.appointment_at,sr.requested_start_at,sr.requested_end_at,c.name
    FROM service_reservation sr JOIN customer c USING(customer_id)
    WHERE sr.status IN ('待接待','待支付','已预订') AND sr.store_id=? AND julianday(sr.requested_end_at)>julianday(?)
      AND NOT EXISTS(SELECT 1 FROM service_task t WHERE t.reservation_id=sr.reservation_id AND t.task_type='现场接待' AND t.status<>'已取消')
    ORDER BY coalesce(sr.appointment_at,sr.requested_start_at),sr.reservation_id LIMIT 8`,user.store_id,now());
}
export const reservationMigration = [
  'ALTER TABLE service_reservation ADD COLUMN appointment_at TIMESTAMP',
  "ALTER TABLE service_reservation ADD COLUMN requirements TEXT",
  "ALTER TABLE service_reservation ADD COLUMN preparation TEXT",
  'ALTER TABLE service_reservation ADD COLUMN version INTEGER NOT NULL DEFAULT 0',
  ...['INSERT','UPDATE'].map(action=>`CREATE TRIGGER reservation_capacity_${action.toLowerCase()} BEFORE ${action} ON service_reservation
    WHEN NEW.appointment_at IS NOT NULL AND NEW.status IN ('待接待','已接待')
    BEGIN SELECT CASE WHEN (SELECT count(*) FROM service_reservation WHERE store_id=NEW.store_id
      AND appointment_at=NEW.appointment_at AND status IN ('待接待','已接待') AND reservation_id<>NEW.reservation_id)>=${legacySlotCapacity}
      THEN RAISE(ABORT,'RESERVATION_SLOT_FULL') END; END`),
  `CREATE UNIQUE INDEX reservation_customer_slot ON service_reservation(customer_id,store_id,appointment_at)
    WHERE appointment_at IS NOT NULL AND status IN ('待接待','已接待')`
];
export async function ensureReservationSchema(db) {
  const columns=await db.all('PRAGMA table_info(service_reservation)');
  if (columns.some(c=>c.name==='appointment_at')) return;
  await db.batch([...reservationMigration.map(sql=>db.q(sql)),db.q('PRAGMA user_version=6')]);
}
const parse = row => ({...row,requirements:row.requirements?JSON.parse(row.requirements):null,
  preparation:row.preparation?JSON.parse(row.preparation):null});
async function presentReservations(db,rows) {
  const result=rows.map(parse);
  const contracts=await db.all(`SELECT c.contract_id,c.status,t.reservation_id FROM rental_contract c JOIN service_task t ON t.task_id=c.service_task_id
    ORDER BY c.contract_id DESC`);
  for (const r of result) {
    const contract=contracts.find(c=>c.reservation_id===r.reservation_id&&c.status!=='已取消');
    if(contract){r.contractId=contract.contract_id;r.contractStatus=contract.status;}
  }
  if (result.some(r=>r.preparation)) {
    const units=await db.all('SELECT equipment_id,asset_no FROM equipment');
    for (const r of result) for (const choice of r.preparation?.choices||[])
      choice.asset=units.find(u=>u.equipment_id===choice.equipmentId)?.asset_no||choice.asset;
  }
  return result;
}
export async function reservationDetail(db,user,id) {
  const row=await db.one(`SELECT sr.*,c.name,c.phone FROM service_reservation sr JOIN customer c USING(customer_id)
    WHERE reservation_id=? AND sr.store_id=?`,positiveId(id,'预约'),user.store_id);
  requireRule(row,'预约不存在或属于另一家门店',404);
  return (await presentReservations(db,[row]))[0];
}
export async function reservationList(db,user,body={}) {
  const date=body.date||new Date(Date.now()+8*3600000).toISOString().slice(0,10);
  requireRule(/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date)),'请选择有效的预约日期');
  const rows=await db.all(`SELECT sr.*,c.name,c.phone FROM service_reservation sr JOIN customer c USING(customer_id)
    WHERE sr.store_id=? AND date(coalesce(sr.appointment_at,sr.requested_start_at),'+8 hours')=?
    ORDER BY coalesce(sr.appointment_at,sr.requested_start_at),sr.reservation_id`,user.store_id,date);
  return {date,rows:await presentReservations(db,rows)};
}
function appointment(value) {
  const at=iso(value,'预计到店时间');
  requireRule(at>now(),'到店时间须晚于当前时间');
  return at;
}
export async function saveReservation(db,user,body) {
  const old=body.reservationId?await reservationDetail(db,user,body.reservationId):null;
  requireRule(!old||old.status==='待接待','只能修改尚未到店的预约',409);
  const at=appointment(body.appointmentAt),range=rentalDates(body.start,body.end);
  requireRule(at<range.end,'预计到店时间须早于租赁结束时间');
  const fit=fitProfile(body.fit),selected=body.categories;
  requireRule(Array.isArray(selected)&&selected.length>0&&selected.length<=4&&new Set(selected).size===selected.length&&selected.every(c=>Object.hasOwn(categories,c)),'请选择所需装备类别');
  requireRule(['Alpine','Touring'].includes(body.system),'请选择固定器与雪靴接口');
  const returnStore=await activeStore(db,body.returnStore);
  const source=textField(body.source,'预约来源',20);
  requireRule(['电话','微信','当面'].includes(source),'请选择预约来源');
  const name=textField(body.name,'顾客姓名',100),phone=textField(body.phone,'手机号',30).replace(/[^\d+]/g,'');
  requireRule(/^\+?\d{7,15}$/.test(phone),'请填写 7 至 15 位数字的手机号');
  const customer=await db.one('SELECT * FROM customer WHERE phone=?',phone);
  requireRule(!old||customer?.customer_id===old.customer_id,'改期时请保留原顾客手机号');
  const requests=JSON.stringify({fit,categories:selected,system:body.system,pickup:user.store_id,returnStore,
    note:textField(body.note,'预约备注',500,true)});
  const queries=[];
  if (!customer) queries.push(db.q('INSERT INTO customer(phone,name,created_at) VALUES(?,?,?)',phone,name,now()));
  if (old) queries.push(db.q(`UPDATE service_reservation SET appointment_at=?,requested_start_at=?,requested_end_at=?,
    source_type=?,requirements=?,preparation=NULL,version=CASE WHEN version=? AND status='待接待' THEN version+1 ELSE NULL END WHERE reservation_id=?`,
    at,range.start,range.end,source,requests,Number(body.version),old.reservation_id));
  else queries.push(db.q(`INSERT INTO service_reservation(reservation_no,customer_id,store_id,requested_start_at,requested_end_at,
    source_type,status,created_at,appointment_at,requirements) VALUES(?,(SELECT customer_id FROM customer WHERE phone=?),?,?,?,?,'待接待',?,?,?)`,
    uid('BSR-RES'),phone,user.store_id,range.start,range.end,source,now(),at,requests));
  queries.push(...audit(db,user,old?'修改预约':'新建预约',old?.status||null,'待接待',old?[['service_reservation',old.reservation_id]]:[]));
  if (!old) queries.push(db.q(`INSERT INTO audit_event_target(audit_event_id,entity_type,entity_id)
    SELECT (SELECT max(audit_event_id) FROM audit_event),'service_reservation',max(reservation_id) FROM service_reservation`));
  await db.batch(queries);
  const saved=old||await db.one('SELECT reservation_id FROM service_reservation WHERE customer_id=(SELECT customer_id FROM customer WHERE phone=?) ORDER BY reservation_id DESC LIMIT 1',phone);
  return reservationDetail(db,user,saved.reservation_id);
}
export async function prepareReservation(db,user,body) {
  const row=await reservationDetail(db,user,body.reservationId);
  requireRule(row.status==='待接待','该预约已经接待或结束',409);
  requireRule(row.requirements,'请先补全预约资料');
  const r=row.requirements,range=rentalDates(row.requested_start_at,row.requested_end_at);
  const result=await recommend(db,r.fit,range,r.categories,row.store_id,r.system);
  const choices=r.categories.map(category=>{
    const exact=result.candidates.filter(c=>c.category===category&&c.current_store_id===row.store_id);
    const near=result.alternatives.filter(c=>c.category===category&&c.current_store_id===row.store_id);
    const c=exact[0]||near[0];
    return c?{category,equipmentId:c.equipment_id,asset:c.asset_no,size:c.size_spec,trial:!!c.requiresFitConfirmation,rent:c.rent,deposit:c.deposit}: {category,missing:true};
  });
  const preparation={at:now(),by:user.display_name,choices,
    status:choices.some(c=>c.missing)?'缺货待沟通':choices.some(c=>c.trial)?'方案已准备·需试穿':'方案已准备',
    note:textField(body.note,'准备及联系记录',500,true)};
  await db.batch([db.q(`UPDATE service_reservation SET preparation=?,version=CASE WHEN version=? AND status='待接待' THEN version+1 ELSE NULL END WHERE reservation_id=?`,
    JSON.stringify(preparation),Number(body.version),row.reservation_id),...audit(db,user,'预约方案准备',null,preparation.status,[['service_reservation',row.reservation_id]])]);
  return reservationDetail(db,user,row.reservation_id);
}
export async function endReservation(db,user,body) {
  const row=await reservationDetail(db,user,body.reservationId);
  requireRule(row.status==='待接待','预约已接待或结束，请刷新后核对',409);
  requireRule(['已取消','未到店'].includes(body.status),'请选择预约处理方式');
  requireRule(body.confirm===true,'请确认结束此预约');
  if (body.status==='未到店') requireRule(row.appointment_at&&Date.parse(now())>=Date.parse(row.appointment_at),'预计到店时间尚未到，不能标记未到店');
  await db.batch([db.q(`UPDATE service_reservation SET status=?,version=CASE WHEN version=? AND status='待接待' THEN version+1 ELSE NULL END WHERE reservation_id=?`,
    body.status,Number(body.version),row.reservation_id),
    db.q("UPDATE service_task SET status='已取消',finished_at=? WHERE reservation_id=? AND task_type='提前预订' AND status IN ('办理中','待合同确认')",now(),row.reservation_id),
    ...audit(db,user,'结束预约','待接待',body.status,[['service_reservation',row.reservation_id]])]);
  return reservationDetail(db,user,row.reservation_id);
}
