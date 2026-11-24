import { inventorySQL, pageRows } from './data.js';
import { repairOrderSQL } from './repair-repository.js';
import { equipmentUtilization } from './utilization-repository.js';
import {deliveredRentals} from './period-statistics.js';
import {auditTargetLookupSQL,missingAuditTargetSQL} from './audit-targets.js';

async function auditHistory(db,store,from,to,{key,page}) {
  const sql = `WITH target_lookup AS (${auditTargetLookupSQL}),resolved_targets AS (
    SELECT t.*,coalesce(l.label,${missingAuditTargetSQL}) AS label,l.entity_id IS NOT NULL AS available
    FROM audit_event_target t LEFT JOIN target_lookup l ON l.entity_type=t.entity_type AND l.entity_id=t.entity_id
  ),scoped_audit AS (
    SELECT a.*,u.display_name,coalesce(a.event_store_id,u.store_id,(
      SELECT r.responsible_store_id FROM audit_event_target x JOIN repair_order r ON r.repair_order_id=x.entity_id
      WHERE x.audit_event_id=a.audit_event_id AND x.entity_type='repair_order' ORDER BY x.entity_id LIMIT 1
    )) AS resolved_store_id
    FROM audit_event a LEFT JOIN user_account u ON u.user_id=a.actor_user_id
    WHERE a.occurred_at BETWEEN ? AND ?
      AND (? IS NULL OR instr(lower(a.event_type),?)>0 OR instr(lower(u.display_name),?)>0 OR instr(lower(u.username),?)>0
        OR EXISTS(SELECT 1 FROM resolved_targets t WHERE t.audit_event_id=a.audit_event_id AND instr(lower(t.label),?)>0))
  )
  SELECT a.*,s.name AS event_store_name,(SELECT json_group_array(json_object(
      'entityType',t.entity_type,'entityId',t.entity_id,'label',t.label,'available',json(CASE WHEN t.available THEN 'true' ELSE 'false' END)))
    FROM (SELECT * FROM resolved_targets x WHERE x.audit_event_id=a.audit_event_id ORDER BY x.audit_target_id) t) AS target_json
    FROM scoped_audit a LEFT JOIN store s ON s.store_id=a.resolved_store_id
    WHERE (? IS NULL OR a.resolved_store_id=?)`;
  const result=await pageRows(db,sql,[from,to,key,key,key,key,key,store,store],'a.occurred_at DESC,a.audit_event_id DESC',page);
  return {...result,rows:result.rows.map(({target_json,...event})=>{
    const targetObjects=JSON.parse(target_json||'[]');
    if(key) targetObjects.sort((a,b)=>Number(b.label.toLowerCase().includes(key))-Number(a.label.toLowerCase().includes(key)));
    return {...event,targetObjects,targets:targetObjects.map(t=>t.label).join('、')};
  })};
}

export async function readOperations(db,store,{from,to,fromDay,toDay},cutoff,auditFilter) {
  const dataSets = ['接待记录','租赁合同','装备库存','维修工单','支付请求','经营统计','审计记录','兼容性检查','预约记录','历史装备利用率','门店对比','已交付租赁统计'];
  const queries = await Promise.allSettled([
    db.all(`SELECT t.*,c.name,s.name AS store_name,coalesce(t.enqueued_at,(SELECT min(a.occurred_at) FROM audit_event a JOIN audit_event_target x USING(audit_event_id)
      WHERE x.entity_type='service_task' AND x.entity_id=t.task_id AND a.event_type='接待登记')) AS arrived_at,
      (SELECT min(a.occurred_at) FROM rental_contract rc JOIN audit_event_target x ON x.entity_type='rental_contract' AND x.entity_id=rc.contract_id
      JOIN audit_event a USING(audit_event_id) WHERE rc.service_task_id=t.task_id AND a.event_type='装备交付') AS delivered_at
      FROM service_task t JOIN customer c USING(customer_id) JOIN store s USING(store_id)
      WHERE t.task_type='现场接待' AND (t.started_at BETWEEN ? AND ?
        OR (t.status='已取消' AND t.assigned_user_id IS NULL AND t.finished_at BETWEEN ? AND ?)
        OR t.status IN ('排队中','办理中','待合同确认'))`,from,to,from,to),
    db.all(`SELECT rc.*,s.name AS store_name FROM rental_contract rc JOIN store s ON s.store_id=rc.pickup_store_id
      WHERE ((rc.end_at>=? AND rc.start_at<=?) OR rc.status IN ('待支付','已确认','租出','处理异常'))`,from,to),
    db.all(inventorySQL),
    db.all(repairOrderSQL+` WHERE (r.completed_at IS NULL OR (r.opened_at<=? AND r.completed_at>=?))`,to,from),
    db.all(`SELECT p.*,rc.contract_no,s.name AS store_name FROM payment_request p JOIN rental_contract rc USING(contract_id)
      JOIN store s ON s.store_id=coalesce(
        (SELECT json_extract(value,'$.store') FROM json_each(rc.price_snapshot,'$.adjustments')
          WHERE json_extract(value,'$.requestNo')=p.request_no LIMIT 1),
        CASE WHEN json_extract(rc.price_snapshot,'$.pending.requestNo')=p.request_no THEN json_extract(rc.price_snapshot,'$.pending.store') END,
        rc.return_store_id,rc.pickup_store_id) WHERE (
        p.status IN ('待支付','处理中') OR (p.status='失败' AND p.request_type<>'收费' AND (
          json_extract(rc.price_snapshot,'$.pending.requestNo')=p.request_no OR EXISTS (
            SELECT 1 FROM json_each(rc.price_snapshot,'$.adjustments') a
            WHERE json_extract(a.value,'$.requestNo')=p.request_no AND coalesce(json_extract(a.value,'$.cancelled'),0)=0
          )
        ))
      )
      AND (? IS NULL OR s.store_id=?)`,store,store),
    db.all(`SELECT * FROM vw_operating_metric WHERE (? IS NULL OR store_id=?) AND metric_date BETWEEN ? AND ?
      AND metric_code IN ('reception_count','contract_count','cross_store_returns')`,store,store,fromDay,toDay),
    auditHistory(db,store,from,to,auditFilter),
    db.all(`SELECT DISTINCT x.entity_id FROM audit_event_target x JOIN audit_event a USING(audit_event_id)
      WHERE x.entity_type='equipment' AND a.event_type='部件兼容检查' AND NOT EXISTS (
      SELECT 1 FROM safety_inspection si WHERE si.equipment_id=x.entity_id AND si.inspected_at>a.occurred_at)`),
    db.all(`SELECT r.*,c.name,s.name AS store_name FROM service_reservation r
      JOIN customer c USING(customer_id) JOIN store s USING(store_id)
      WHERE (? IS NULL OR r.store_id=?) AND (coalesce(r.appointment_at,r.requested_start_at) BETWEEN ? AND ? OR r.status IN ('待接待','待支付','已预订'))`,store,store,from,to),
    equipmentUtilization(db,store,from,to,cutoff),
    db.all('SELECT store_id,name FROM store WHERE active=1 ORDER BY store_id'),
    deliveredRentals(db,store,from,to,cutoff)
  ]);
  return {dataSets,queries};
}

export async function ensureMetricSchema(db) {
  if((await db.one('PRAGMA user_version')).user_version>=9)return;
  await db.batch([db.q('DROP VIEW vw_operating_metric'),db.q("CREATE VIEW vw_operating_metric AS\n SELECT date(t.started_at,'+8 hours') metric_date,t.store_id,'reception_count' metric_code,count(*) metric_value,CURRENT_TIMESTAMP calculated_at\n FROM service_task t WHERE t.task_type='现场接待' GROUP BY date(t.started_at,'+8 hours'),t.store_id\n UNION ALL SELECT date(start_at,'+8 hours'),pickup_store_id,'contract_count',count(*),CURRENT_TIMESTAMP\n FROM rental_contract WHERE status NOT IN ('待支付','已取消') GROUP BY date(start_at,'+8 hours'),pickup_store_id\n UNION ALL SELECT date(moved_at,'+8 hours'),to_store_id,'cross_store_returns',count(*),CURRENT_TIMESTAMP\n FROM equipment_location_history WHERE movement_type='跨店归还' AND from_store_id IS NOT NULL AND from_store_id<>to_store_id GROUP BY date(moved_at,'+8 hours'),to_store_id\n UNION ALL SELECT date('now','+8 hours'),current_store_id,'rented_equipment',sum(status='租出'),CURRENT_TIMESTAMP\n FROM equipment GROUP BY current_store_id\n UNION ALL SELECT date('now','+8 hours'),current_store_id,'equipment_count',count(*),CURRENT_TIMESTAMP\n FROM equipment WHERE retired_at IS NULL GROUP BY current_store_id;"),db.q('PRAGMA user_version=9')]);
}
