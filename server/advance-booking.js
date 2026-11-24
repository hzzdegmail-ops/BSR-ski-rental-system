import {audit,now,positiveId,requireRule} from './data.js';
import {demo} from './demo-config.js';
import {recommend} from './equipment-repository.js';
import {reservationDetail} from './reservations.js';

export const advanceMigration=[
 'ALTER TABLE service_task ADD COLUMN task_type VARCHAR(20) NOT NULL DEFAULT \'现场接待\'',
 'DROP TRIGGER IF EXISTS reservation_capacity_insert',
 'DROP TRIGGER IF EXISTS reservation_capacity_update',
 'DROP INDEX IF EXISTS reservation_customer_slot',
 'DROP TRIGGER IF EXISTS one_active_reception',
 ...['INSERT','UPDATE'].map(action=>`CREATE TRIGGER one_active_reception_${action.toLowerCase()} BEFORE ${action} ON service_task
 WHEN NEW.task_type='现场接待' AND NEW.status IN ('排队中','办理中','待合同确认')
 BEGIN SELECT RAISE(ABORT,'ACTIVE_RECEPTION_EXISTS') WHERE EXISTS(
  SELECT 1 FROM service_task t WHERE t.task_type='现场接待' AND t.customer_id=NEW.customer_id AND t.store_id=NEW.store_id
   AND t.status IN ('排队中','办理中','待合同确认') AND t.task_id<>NEW.task_id); END`),
 'DROP TRIGGER IF EXISTS item_reservation_guard',
 `CREATE TRIGGER item_reservation_guard BEFORE INSERT ON rental_item
 WHEN NEW.item_status IN ('待支付','已预留','租出') BEGIN
 SELECT RAISE(ABORT,'ASSET_UNAVAILABLE') WHERE NOT EXISTS(
  SELECT 1 FROM equipment e JOIN safety_inspection si ON si.inspection_id=(SELECT inspection_id FROM safety_inspection
   WHERE equipment_id=e.equipment_id ORDER BY inspected_at DESC,inspection_id DESC LIMIT 1)
  JOIN rental_contract rc ON rc.contract_id=NEW.contract_id WHERE e.equipment_id=NEW.equipment_id
   AND e.status IN ('可租','已预留','临时锁定') AND e.retired_at IS NULL AND si.result='合格'
   AND si.valid_until>=date(rc.end_at,'+8 hours') AND si.valid_until>=date('now','+8 hours'));
 SELECT RAISE(ABORT,'ASSET_CONFLICT') WHERE EXISTS(SELECT 1 FROM rental_item ri JOIN rental_contract rc USING(contract_id)
  JOIN rental_contract nc ON nc.contract_id=NEW.contract_id WHERE ri.equipment_id=NEW.equipment_id
   AND ri.item_status IN ('待支付','已预留','租出') AND ri.rented_from<nc.end_at AND rc.end_at>NEW.rented_from);
 SELECT RAISE(ABORT,'ASSET_CONFLICT') WHERE EXISTS(SELECT 1 FROM rental_contract rc
  JOIN rental_contract nc ON nc.contract_id=NEW.contract_id WHERE rc.contract_id<>NEW.contract_id
   AND json_extract(rc.price_snapshot,'$.pending.type')='换装'
   AND json_extract(rc.price_snapshot,'$.pending.replacement.equipment_id')=NEW.equipment_id
   AND json_extract(rc.price_snapshot,'$.pending.at')<nc.end_at AND rc.end_at>NEW.rented_from);
 END`,
 'DROP VIEW vw_operating_metric',
 `CREATE VIEW vw_operating_metric AS
 SELECT date(t.started_at,'+8 hours') metric_date,t.store_id,'reception_count' metric_code,count(*) metric_value,CURRENT_TIMESTAMP calculated_at
 FROM service_task t WHERE t.task_type='现场接待' GROUP BY date(t.started_at,'+8 hours'),t.store_id
 UNION ALL SELECT date(start_at,'+8 hours'),pickup_store_id,'contract_count',count(*),CURRENT_TIMESTAMP
 FROM rental_contract WHERE status NOT IN ('待支付','已取消') GROUP BY date(start_at,'+8 hours'),pickup_store_id
 UNION ALL SELECT date(moved_at,'+8 hours'),to_store_id,'cross_store_returns',count(*),CURRENT_TIMESTAMP
 FROM equipment_location_history WHERE movement_type='跨店归还' GROUP BY date(moved_at,'+8 hours'),to_store_id
 UNION ALL SELECT date('now','+8 hours'),current_store_id,'rented_equipment',sum(status='租出'),CURRENT_TIMESTAMP
 FROM equipment GROUP BY current_store_id
 UNION ALL SELECT date('now','+8 hours'),current_store_id,'equipment_count',count(*),CURRENT_TIMESTAMP
 FROM equipment WHERE retired_at IS NULL GROUP BY current_store_id`
];
export async function ensureAdvanceSchema(db) {
 if((await db.all('PRAGMA table_info(service_task)')).some(c=>c.name==='task_type'))return;
 await db.batch([...advanceMigration.map(sql=>db.q(sql)),db.q('PRAGMA user_version=8')]);
}
export async function reservationChoices(db,user,body,tokens) {
 const r=await reservationDetail(db,user,body.reservationId);
 requireRule(r.status==='待接待','只有尚未确认预订的预约可以选装；已预订请查看原合同',409);
 requireRule(r.requirements,'请先补全预约资料');requireRule(r.requested_end_at>now(),'租期已结束，请重新预约');
 const req=r.requirements,range={start:r.requested_start_at,end:r.requested_end_at};
 const result=await recommend(db,req.fit,range,req.categories,r.store_id,req.system);
 const candidates=result.candidates.filter(c=>c.current_store_id===r.store_id);
 const alternatives=result.alternatives.filter(c=>c.current_store_id===r.store_id);
 const missing=req.categories.filter(cat=>![...candidates,...alternatives].some(c=>c.category===cat));
 let task=await db.one("SELECT * FROM service_task WHERE reservation_id=? AND status<>'已取消'",r.reservation_id);
 requireRule(!task||task.task_type==='提前预订','该预约已进入到店办理',409);
 if(!task){
  await db.batch([db.q(`INSERT INTO service_task(reservation_id,customer_id,store_id,assigned_user_id,queue_no,current_stage,status,started_at,enqueued_at,task_type)
   VALUES(?,?,?,?,0,'提前选装','办理中',?,NULL,'提前预订')`,r.reservation_id,r.customer_id,r.store_id,user.user_id,now()),
   ...audit(db,user,'提前预订选装',null,'办理中',[['service_reservation',r.reservation_id]])]);
  task=await db.one("SELECT * FROM service_task WHERE reservation_id=? AND status<>'已取消'",r.reservation_id);
 }
 const pending=await db.one("SELECT 1 FROM rental_contract WHERE service_task_id=? AND status<>'已取消'",task.task_id);
 requireRule(!pending,'已有预订合同，请查看并处理原支付请求',409);
 await db.batch([db.q(`UPDATE service_task SET status=?,current_stage='提前选装',recommendation_revision=CASE
  WHEN recommendation_revision=? AND task_type='提前预订' THEN recommendation_revision+1 ELSE NULL END WHERE task_id=?`,
  missing.length?'办理中':'待合同确认',task.recommendation_revision,task.task_id)]);
 const token=await tokens.sign({kind:'quote',userId:user.user_id,taskId:task.task_id,customerId:r.customer_id,fit:req.fit,range,
  pickup:r.store_id,returnStore:req.returnStore,selected:req.categories,system:req.system,revision:task.recommendation_revision+1,
  candidateIds:[...candidates,...alternatives].map(c=>c.equipment_id),advance:true,reservationId:r.reservation_id,reservationVersion:r.version},demo.quoteMinutes);
 return {candidates,alternatives,missing,token,reservationId:r.reservation_id};
}

export const scheduledState = id => `CASE
 WHEN EXISTS(SELECT 1 FROM rental_item WHERE equipment_id=${id} AND item_status='租出') THEN '租出'
 WHEN EXISTS(SELECT 1 FROM rental_item WHERE equipment_id=${id} AND item_status='待支付') THEN '临时锁定'
 WHEN EXISTS(SELECT 1 FROM rental_contract WHERE json_extract(price_snapshot,'$.pending.type')='换装'
  AND json_extract(price_snapshot,'$.pending.replacement.equipment_id')=${id}) THEN '临时锁定'
 WHEN EXISTS(SELECT 1 FROM rental_item WHERE equipment_id=${id} AND item_status='已预留') THEN '已预留' ELSE '可租' END`;
export const releaseState = id => `CASE WHEN status IN ('可租','已预留','临时锁定','租出') THEN ${scheduledState(id)} ELSE status END`;
