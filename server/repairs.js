import { activeStore,audit,dateAfter,day,guard,inList,inventorySQL,iso,now,pageRows,positiveId,requireRule,textField,uid } from './data.js';
import { repairOrderSQL } from './repair-repository.js';

const findOrder = (db,id) => db.one(repairOrderSQL+' WHERE r.repair_order_id=?',positiveId(id,'维修工单'));
export const inventory = db => db.all(inventorySQL+' ORDER BY e.current_store_id,e.asset_no');

export async function repairList(db,user,filter={}) {
  const scope = user.role_type==='contractor'?user.contractor_id:null;
  const sql = repairOrderSQL+' WHERE (?=0 OR r.contractor_id=?)';
  const params = [Number(user.role_type==='contractor'),scope];
  const order = '(r.completed_at IS NULL) DESC,r.opened_at DESC,r.repair_order_id DESC';
  if (filter.page===undefined && filter.key===undefined && !filter.status && !filter.storeId) {
    return db.all(sql+' ORDER BY '+order+' LIMIT 150',...params);
  }
  const key = textField(filter.key,'维修查询关键词',80,true)?.toLowerCase()??null;
  const status = filter.status ? inList(filter.status,['待分配','待接收','维修中','待验收','待确认退役','已关闭','已退役'],'工单状态') : null;
  const store = filter.storeId ? await activeStore(db,filter.storeId) : null;
  return pageRows(db,sql+` AND (? IS NULL OR instr(lower(r.ticket_no),?)>0 OR instr(lower(e.asset_no),?)>0 OR instr(lower(e.legacy_asset_no),?)>0)
    AND (? IS NULL OR r.status=?) AND (? IS NULL OR r.responsible_store_id=?)`,
    [...params,key,key,key,key,status,status,store,store],order,filter.page);
}
export async function repairDetail(db,user,id) {
  const order = await findOrder(db,id);
  requireRule(order,'工单不存在',404);
  requireRule(user.role_type!=='contractor' || order.contractor_id===user.contractor_id,'工单未分配给当前承包商',403);
  const updates = await db.all(`SELECT u.*,a.display_name FROM repair_update u JOIN user_account a ON a.user_id=u.submitted_by_user_id
    WHERE u.repair_order_id=? ORDER BY u.created_at,u.repair_update_id`,order.repair_order_id);
  const inspections = await db.all('SELECT * FROM safety_inspection WHERE repair_order_id=? ORDER BY inspected_at',order.repair_order_id);
  return { order,updates,inspections };
}
export async function submitRepair(db,user,body) {
  const asset = await db.one(inventorySQL+' WHERE e.equipment_id=?',positiveId(body.equipmentId,'故障装备'));
  requireRule(asset && asset.retired_at===null,'装备不存在或已经退役');
  if (asset.open_ticket) {
    const order = await db.one('SELECT repair_order_id FROM repair_order WHERE ticket_no=?',asset.open_ticket);
    return repairDetail(db,user,order.repair_order_id);
  }
  requireRule(!['租出','已预留','临时锁定','调拨中'].includes(asset.status),'该装备有租赁占用或正在调拨，请先处理归还、换装或合同',409);
  const store = await activeStore(db,body.storeId);
  requireRule(store===asset.current_store_id && store===user.store_id,'请在装备当前所在门店登记送修');
  const note = textField(body.fault,'故障描述',500);
  const severity = inList(body.severity,['低','中','高'],'严重程度');
  const contractor = body.contractorId?positiveId(body.contractorId,'承包商'):null;
  if (contractor) requireRule(await db.one('SELECT 1 FROM repair_contractor WHERE contractor_id=? AND active=1',contractor),'承包商已停用');
  const t=now(), no=uid('BSR-RP'), status=contractor?'待接收':'待分配';
  await db.batch([
    guard(db,'equipment','equipment_id',asset.equipment_id,asset.version),
    db.q(`INSERT INTO repair_order(ticket_no,equipment_id,contractor_id,created_by_user_id,status,fault_description,opened_at,responsible_store_id,severity)
      VALUES(?,?,?,?,?,?,?,?,?)`,no,asset.equipment_id,contractor,user.user_id,status,note,t,store,severity),
    db.q(`INSERT INTO repair_update(repair_order_id,submitted_by_user_id,progress_status,note,created_at)
      VALUES((SELECT repair_order_id FROM repair_order WHERE ticket_no=?),?,?,?,?)`,no,user.user_id,status,
      '严重程度：'+severity+'；责任门店：'+asset.store_name,t),
    db.q("UPDATE equipment SET status='维修中' WHERE equipment_id=?",asset.equipment_id),
    ...audit(db,user,'提交维修工单',asset.status,'维修中',[['equipment',asset.equipment_id]]),
    db.q(`INSERT INTO audit_event_target(audit_event_id,entity_type,entity_id)
      SELECT (SELECT max(audit_event_id) FROM audit_event),'repair_order',repair_order_id FROM repair_order WHERE ticket_no=?`,no)
  ]);
  const order = await db.one('SELECT repair_order_id FROM repair_order WHERE ticket_no=?',no);
  return repairDetail(db,user,order.repair_order_id);
}
const repairGuard = (db,o) => guard(db,'repair_order','repair_order_id',o.repair_order_id,o.version);
function addUpdate(db,user,o,status,note) {
  return db.q('INSERT INTO repair_update(repair_order_id,submitted_by_user_id,progress_status,note,created_at) VALUES(?,?,?,?,?)',
    o.repair_order_id,user.user_id,status,note,now());
}
export async function assignRepair(db,user,body) {
  const o = await findOrder(db,body.orderId);
  requireRule(o?.status==='待分配' && o.responsible_store_id===user.store_id,'只有责任门店可以分配待分配工单');
  const id = positiveId(body.contractorId,'承包商');
  const contractor = await db.one('SELECT * FROM repair_contractor WHERE contractor_id=? AND active=1',id);
  requireRule(contractor,'承包商不可用');
  await db.batch([
    repairGuard(db,o),
    db.q("UPDATE repair_order SET contractor_id=?,status='待接收' WHERE repair_order_id=?",id,o.repair_order_id),
    addUpdate(db,user,o,'待接收','分配至 '+contractor.name),
    ...audit(db,user,'分配维修工单',o.status,'待接收',[['repair_order',o.repair_order_id]])
  ]);
  return repairDetail(db,user,o.repair_order_id);
}
export async function updateRepair(db,user,body) {
  const o = await findOrder(db,body.orderId);
  requireRule(o && o.contractor_id===user.contractor_id,'工单未分配给当前承包商',403);
  requireRule(['待接收','维修中'].includes(o.status),'工单已关闭或等待门店验收，无法提交进度',409);
  const next = inList(body.status,['维修中','待验收','待确认退役'],'维修结果');
  const note = textField(body.note,'处理说明及维修结果',500);
  const submittedEstimate = body.estimatedCompletionAt
    ? iso(body.estimatedCompletionAt,'预计完成时间') : null;
  const estimate = submittedEstimate ?? o.estimated_completion_at;
  const changed = estimate !== o.estimated_completion_at;
  requireRule(!changed || (next==='维修中' && estimate>now()),'调整预计完成时间时请填写将来的时间并选择继续维修');
  requireRule(next!=='维修中' || estimate,'接单或继续维修时，请填写预计完成时间');
  const estimateLabel = changed ? new Intl.DateTimeFormat('zh-CN',{
    timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'short',hour12:false
  }).format(new Date(estimate)) : '';
  const historyNote = changed ? note+' · 预计完成时间：'+estimateLabel : note;
  await db.batch([
    repairGuard(db,o),
    db.q('UPDATE repair_order SET status=?,estimated_completion_at=? WHERE repair_order_id=?',next,estimate,o.repair_order_id),
    addUpdate(db,user,o,next,historyNote),
    ...audit(db,user,'更新维修进度',o.status,next,[['repair_order',o.repair_order_id],['equipment',o.equipment_id]],'成功',o.responsible_store_id)
  ]);
  return repairDetail(db,user,o.repair_order_id);
}
export async function inspectRepair(db,user,body) {
  const o = await findOrder(db,body.orderId);
  requireRule(o && o.responsible_store_id===user.store_id,'请在工单责任门店办理验收',403);
  requireRule(['待验收','待确认退役'].includes(o.status),'工单尚未进入验收或退役确认环节',409);
  const choices = o.status==='待验收'?['合格','不合格']:['确认退役','退回维修'];
  const result = inList(body.result,choices,'验收结果');
  const note = textField(body.note,'验收说明',500);
  const pass = result==='合格', retire = result==='确认退役';
  const next = pass?'已关闭':retire?'已退役':'维修中';
  const at=now();
  const unit = await db.one(inventorySQL+' WHERE e.equipment_id=?',o.equipment_id);
  await db.batch([
    repairGuard(db,o),
    guard(db,'equipment','equipment_id',o.equipment_id,o.equipment_version),
    db.q('UPDATE repair_order SET status=?,completed_at=? WHERE repair_order_id=?',next,pass||retire?at:null,o.repair_order_id),
    db.q('UPDATE equipment SET status=?,retired_at=? WHERE equipment_id=?',pass?'可租':retire?'退役':'维修中',retire?day(at):null,o.equipment_id),
    db.q(`INSERT INTO safety_inspection(equipment_id,repair_order_id,inspector_user_id,result,inspected_at,valid_until,note)
      VALUES(?,?,?,?,?,?,?)`,o.equipment_id,o.repair_order_id,user.user_id,result,at,
      pass?day(dateAfter(unit.safety_interval_days,at)):null,note),
    addUpdate(db,user,o,next,result+' · '+note),
    ...audit(db,user,'维修安全验收',o.status,next,[['repair_order',o.repair_order_id],['equipment',o.equipment_id]])
  ]);
  return repairDetail(db,user,o.repair_order_id);
}
export async function inspectAsset(db,user,body) {
  const id = positiveId(body.equipmentId,'装备');
  const unit = await db.one(inventorySQL+' WHERE e.equipment_id=?',id);
  requireRule(unit && unit.current_store_id===user.store_id,'请在装备当前门店办理检查',403);
  requireRule(['可租','待检查'].includes(unit.status) && !unit.open_ticket,'该装备需先处理合同或维修工单');
  const result = inList(body.result,['合格','不合格'],'检查结果');
  const note = textField(body.note,'检查说明',500);
  const at=now(), next=result==='合格'?'可租':'待检查';
  await db.batch([
    guard(db,'equipment','equipment_id',id,unit.version),
    db.q('UPDATE equipment SET status=? WHERE equipment_id=?',next,id),
    db.q(`INSERT INTO safety_inspection(equipment_id,inspector_user_id,result,inspected_at,valid_until,note)
      VALUES(?,?,?,?,?,?)`,id,user.user_id,result,at,result==='合格'?day(dateAfter(unit.safety_interval_days,at)):null,note),
    ...audit(db,user,'装备安全检查',unit.status,next,[['equipment',id]])
  ]);
  return { equipment:await db.one(inventorySQL+' WHERE e.equipment_id=?',id) };
}
