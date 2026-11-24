import {inventorySQL,positiveId,requireRule,textField} from './data.js';
import {contractDetail} from './contract-repository.js';
import {repairDetail} from './repairs.js';

const definitions={
  user_account:{title:'账号',sql:`SELECT u.user_id AS id,'账号：'||u.display_name||'（'||u.username||'）' AS label,
    u.display_name,u.username,CASE u.role_type WHEN 'staff' THEN '门店员工' WHEN 'contractor' THEN '维修承包商' ELSE '经理' END AS role_name,
    coalesce(s.name,'不限定门店') AS store_name,CASE u.active WHEN 1 THEN '启用' ELSE '停用' END AS status
    FROM user_account u LEFT JOIN store s USING(store_id)`,
    fields:[['姓名或称呼','display_name'],['登录账号','username'],['角色','role_name'],['所属门店','store_name'],['账号状态','status']]},
  equipment:{title:'装备',sql:`SELECT equipment_id AS id,'装备：'||asset_no||' · '||brand||' '||model_name AS label,
    asset_no,brand||' '||model_name AS model,category_name,size_spec,status,store_name,inspection_result,valid_until
    FROM (${inventorySQL})`,
    fields:[['装备编号','asset_no'],['品牌与型号','model'],['品类','category_name'],['尺寸规格','size_spec'],['当前状态','status'],
      ['当前门店','store_name'],['最近检查结论','inspection_result'],['检查有效期','valid_until']]},
  repair_order:{title:'维修工单',sql:`SELECT r.repair_order_id AS id,'维修工单：'||r.ticket_no||' · '||e.asset_no AS label,
    r.ticket_no FROM repair_order r JOIN equipment e USING(equipment_id)`},
  rental_contract:{title:'租赁合同',sql:`SELECT r.contract_id AS id,'租赁合同：'||r.contract_no||' · '||c.name AS label,
    r.contract_no FROM rental_contract r JOIN customer c USING(customer_id)`},
  customer:{title:'顾客',sql:`SELECT customer_id AS id,'顾客：'||name AS label,name,phone,email FROM customer`,
    fields:[['顾客姓名','name'],['联系电话','phone'],['电子邮箱','email']]},
  service_reservation:{title:'预约',sql:`SELECT r.reservation_id AS id,'预约：'||r.reservation_no||' · '||c.name AS label,
    r.reservation_no,c.name,r.status,s.name AS store_name,r.source_type,r.appointment_at,r.requested_start_at,r.requested_end_at
    FROM service_reservation r JOIN customer c USING(customer_id) JOIN store s USING(store_id)`,
    fields:[['预约号','reservation_no'],['顾客','name'],['状态','status'],['预约门店','store_name'],['来源','source_type'],
      ['预计到店','appointment_at','date'],['租赁开始','requested_start_at','date'],['计划结束','requested_end_at','date']]},
  service_task:{title:'办理任务',sql:`SELECT t.task_id AS id,'办理任务：'||c.name||' · '||
    CASE WHEN t.task_type='提前预订' THEN '提前预订' ELSE '到店排队'||t.queue_no||'号' END AS label,
    c.name,s.name AS store_name,t.task_type,CASE WHEN t.task_type='提前预订' THEN '尚未到店取号' ELSE CAST(t.queue_no AS TEXT) END AS queue_no,
    t.current_stage,t.status,t.enqueued_at,t.started_at,t.finished_at,
    coalesce(u.display_name,'尚未分配') AS assigned_name
    FROM service_task t JOIN customer c USING(customer_id) JOIN store s USING(store_id)
    LEFT JOIN user_account u ON u.user_id=t.assigned_user_id`,
    fields:[['顾客','name'],['办理门店','store_name'],['任务类型','task_type'],['排队号','queue_no'],['当前环节','current_stage'],
      ['状态','status'],['负责员工','assigned_name'],['到店时间','enqueued_at','date'],['开始办理','started_at','date'],['结束办理','finished_at','date']]},
  payment_request:{title:'模拟支付请求',sql:`SELECT p.payment_request_id AS id,'模拟支付：'||p.request_no||' · '||p.request_type AS label,
    p.request_no,p.request_type,p.status,p.amount,p.created_at,r.contract_no,c.name
    FROM payment_request p JOIN rental_contract r USING(contract_id) JOIN customer c USING(customer_id)`,
    fields:[['支付请求号','request_no'],['类型','request_type'],['状态','status'],['金额','amount','money'],['合同号','contract_no'],
      ['顾客','name'],['发起时间','created_at','date']]},
  store:{title:'门店',sql:`SELECT store_id AS id,'门店：'||name AS label,store_code,name,address,
    CASE active WHEN 1 THEN '营业' ELSE '停用' END AS status FROM store`,
    fields:[['门店名称','name'],['门店编号','store_code'],['地址','address'],['状态','status']]},
  equipment_model:{title:'装备型号',sql:`SELECT m.model_id AS id,'装备型号：'||m.brand||' '||m.model_name||' · '||m.size_spec AS label,
    m.brand,m.model_name,m.size_spec,m.skill_level,c.name AS category_name FROM equipment_model m JOIN equipment_category c USING(category_id)`,
    fields:[['品牌','brand'],['型号','model_name'],['品类','category_name'],['尺寸规格','size_spec'],['技能等级','skill_level']]},
  repair_contractor:{title:'维修承包商',sql:`SELECT contractor_id AS id,'维修承包商：'||name AS label,name,contractor_code,contact_phone,
    CASE active WHEN 1 THEN '启用' ELSE '停用' END AS status FROM repair_contractor`,
    fields:[['名称','name'],['编号','contractor_code'],['联系电话','contact_phone'],['状态','status']]}
};

export const auditTargetLookupSQL=Object.entries(definitions).map(([type,d])=>
  `SELECT '${type}' AS entity_type,id AS entity_id,label FROM (${d.sql})`).join('\nUNION ALL\n');
export const missingAuditTargetSQL='CASE t.entity_type '+Object.entries(definitions).map(([type,d])=>
  `WHEN '${type}' THEN '${d.title}（记录已不可用）'`).join(' ')+" ELSE '历史业务记录（暂不可查看）' END";

export async function auditTargetDetail(db,user,body) {
  const eventId=positiveId(body.auditEventId,'审计事件'),id=positiveId(body.entityId,'关联记录');
  const type=textField(body.entityType,'关联对象类型',40);
  requireRule(await db.one('SELECT 1 FROM audit_event_target WHERE audit_event_id=? AND entity_type=? AND entity_id=?',eventId,type,id),
    '该对象不属于所选审计事件，请刷新后查看',404);
  requireRule(Object.hasOwn(definitions,type),'该历史业务记录暂不可查看',404);
  const d=definitions[type],record=await db.one(`SELECT * FROM (${d.sql}) WHERE id=?`,id);
  requireRule(record,'关联记录已不可用，原审计事件仍保留',404);
  const target={entityType:type,entityId:id,label:record.label};
  if(type==='rental_contract') return {target,contract:await contractDetail(db,id)};
  if(type==='repair_order') return {target,repair:await repairDetail(db,user,id)};
  return {target,fields:d.fields.map(([label,key,format])=>({label,value:record[key]??null,format:format||'text'}))};
}
