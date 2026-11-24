import { activeStore, audit, BusinessError, guard, inList, integerList, now, positiveId, requireRule, snapshot, textField, uid } from './data.js';
import { exchangeDelta, fitProfile, money, returnFees, exchangedCondition } from './domain.js';
import { recommend } from './equipment-repository.js';
import { demo } from './demo-config.js';
import { cancelContractChanges, cancelPendingCharge, settleCharge } from './contracts.js';
import { contractById, contractDetail, contractItems } from './contract-repository.js';
import { lapsedPayment, paymentHoldUntil, paymentInsert, paymentOutcome } from './payment.js';
import {releaseState,scheduledState} from './advance-booking.js';
import {cancelUncollectedTask} from './reception.js';

const activeItems = items => items.filter(i=>i.item_status==='租出');
const conditions = ['完好','损坏或存在安全隐患'];
const exchangeReasons = ['尺码不合适','装备故障','偏好调整','其他'];
const lockContract = (db,c) => guard(db,'rental_contract','contract_id',c.contract_id,c.version);
async function rental(db,id) {
  const c = await contractById(db,positiveId(id,'合同'));
  requireRule(c && ['租出','处理异常'].includes(c.status),'合同不存在、尚未取件或已完成归还',409);
  requireRule(!snapshot(c).pending,'请先查询该合同的待处理支付请求',409);
  return c;
}
async function findReplacements(db,user,body) {
  const c = await rental(db,body.contractId);
  const old = activeItems(await contractItems(db,c.contract_id)).find(i=>i.equipment_id===Number(body.oldId));
  requireRule(old,'请选择合同内仍在租用的装备');
  const t = now();
  requireRule(t<c.end_at,'合同剩余租期已结束，请办理归还');
  const price = snapshot(c);
  const reasonType = inList(body.reasonType,exchangeReasons,'换装原因');
  const note = textField(body.reason,'换装说明',255,true);
  const reason = note?reasonType+' · '+note:reasonType;
  const condition = inList(body.condition,conditions,'旧装备检查结果');
  requireRule(reasonType!=='装备故障' || condition===conditions[1],
    '故障换装须隔离旧装备。若检查确认无故障，请更正换装原因。');
  const fit = fitProfile({...price.fit,...body.fit});
  const result = await recommend(db,fit,{start:t,end:c.end_at},[old.category_code],user.store_id,price.system);
  const prior = (price.currentLines||price.lines).find(l=>l.equipment_id===old.equipment_id);
  const alternatives = result.candidates.filter(u=>u.current_store_id===user.store_id &&
    (reasonType!=='尺码不合适' || u.size_spec!==old.size_spec));
  const candidates = alternatives.map(u=>({
    ...u, delta:exchangeDelta(u,prior)
  }));
  const selection = JSON.stringify([c.contract_id,c.version,old.equipment_id,old.equipment_version,reason,condition,fit]);
  return { c,price,old,fit,reason,condition,candidates,selection };
}
export async function exchangeChoices(db,user,body,tokens) {
  const { candidates,selection } = await findReplacements(db,user,body);
  const token = await tokens.sign({kind:'exchange-preview',userId:user.user_id,selection,
    quotes:candidates.map(i=>[i.equipment_id,i.version,i.delta])},demo.quoteMinutes);
  return { candidates,token };
}

export async function previewReturn(db,user,body) {
  const c = await rental(db,body.contractId);
  const store = await activeStore(db,body.storeId);
  requireRule(store===user.store_id,'请选择当前登录员工所属的实际归还门店');
  const items = activeItems(await contractItems(db,c.contract_id));
  requireRule(items.length,'合同中没有需要归还的装备',409);
  const received = integerList(body.equipmentIds);
  requireRule(received.every(id=>items.some(i=>i.equipment_id===id)),'实际归还装备与合同不匹配');
  const at = now();
  const price = snapshot(c);
  const missing = items.filter(i=>!received.includes(i.equipment_id)).map(i=>i.asset_no);
  const inspections = received.map(id=>{
    const item = items.find(i=>i.equipment_id===id);
    const line = (price.currentLines||price.lines).find(l=>l.equipment_id===id);
    const condition = inList(body.inspections?.[id]?.condition,conditions,'装备检查结果');
    const damage = condition===conditions[0]?0:Number(body.inspections?.[id]?.fee || 0);
    requireRule(Number.isFinite(damage) && damage>=0 && damage<=100000,'请核对损坏费用');
    return { ...item,condition,...returnFees(line,c.end_at,at,damage) };
  });
  const delta = money(inspections.reduce((n,i)=>n+i.damage+i.overdue-i.deposit,0));
  return { c,price,store,at,inspections,missing,delta,crossStore:items.some(i=>received.includes(i.equipment_id) && i.current_store_id!==store),changedReturnStore:price.agreedReturnStore!==store };
}
function returnSelection(c,operation) {
  const checked = operation.inspections.map(i=>[i.equipment_id,i.equipment_version,i.condition,i.damage,i.overdue,i.deposit]);
  return JSON.stringify([c.contract_id,c.version,operation.store,checked,operation.missing,operation.delta]);
}
export async function quoteReturn(db,user,body,tokens) {
  const {c,price,...operation} = await previewReturn(db,user,body);
  const token = await tokens.sign({kind:'return-preview',userId:user.user_id,selection:returnSelection(c,operation)},demo.quoteMinutes);
  return { ...operation,token };
}
export async function executeReturn(db,user,body,tokens) {
  requireRule(body.confirm===true,'请先核对归还及费用摘要');
  const preview = await tokens.read(body.token,'return-preview');
  requireRule(preview?.userId===user.user_id,'请重新核对归还与费用',409);
  const { c,price,...operation } = await previewReturn(db,user,body);
  requireRule(preview.selection===returnSelection(c,operation),'归还信息、费用或装备状态已变化，请重新核对',409);
  return beginOperation(db,user,c,price,{...operation,type:'归还'},body.scenario);
}
export async function executeExchange(db,user,body,tokens) {
  requireRule(body.confirm===true,'请先核对换装与价差');
  const preview = await tokens.read(body.token,'exchange-preview');
  requireRule(preview?.userId===user.user_id,'请重新查询替换装备和价差',409);
  const { c,price,old,fit,reason,condition,candidates,selection } = await findReplacements(db,user,body);
  const replacement = candidates.find(i=>i.equipment_id===positiveId(body.newId,'替换装备'));
  requireRule(replacement,'替换装备已不可用，请重新查询',409);
  requireRule(preview.selection===selection && preview.quotes.some(([id,version,delta])=>
    id===replacement.equipment_id && version===replacement.version && delta===replacement.delta),
  '换装条件、价差或装备状态已变化，请重新查询',409);
  return beginOperation(db,user,c,price,{type:'换装',at:now(),store:user.store_id,old,replacement,reason,condition,fit,delta:replacement.delta},body.scenario);
}
export async function cancelUncollected(db,user,body) {
  const c = await contractById(db,positiveId(body.contractId,'合同'));
  const atPickup = c?.pickup_store_id===user.store_id;
  const atBooking = c?.task_store_id===user.store_id && (c.status==='已取消' || c.status==='待支付' && c.end_at>now());
  requireRule(atPickup || atBooking,'请在合同取件门店处理',403);
  requireRule(body.confirm===true,'请先核对装备和支付记录');
  if (c.status==='已取消') return contractDetail(db,c.contract_id);
  requireRule(['待支付','已确认'].includes(c.status),'只有尚未取件的合同可以取消',409);
  if (c.status==='待支付') {
    await cancelPendingCharge(db,user,c,'DEMO_CHARGE_CANCELLED');
    return contractDetail(db,c.contract_id);
  }
  const price = snapshot(c);
  if (price.pending?.type==='未取件取消') {
    const request = await db.one('SELECT * FROM payment_request WHERE request_no=?',price.pending.requestNo);
    return settleAdjustment(db,user,c,request,body.scenario);
  }
  const paid = await db.one("SELECT amount FROM payment_request WHERE contract_id=? AND request_type='收费' AND status='成功' ORDER BY payment_request_id DESC LIMIT 1",c.contract_id);
  const items = await contractItems(db,c.contract_id);
  return beginOperation(db,user,c,price,{type:'未取件取消',at:now(),store:user.store_id,items,
    delta:paid?-paid.amount:0},body.scenario);
}
async function beginOperation(db,user,c,price,op,scenario) {
  const commands = [lockContract(db,c)];
  if (op.type==='换装') {
    const unit = op.replacement;
    commands.push(guard(db,'equipment','equipment_id',unit.equipment_id,unit.version));
    if (op.delta) commands.push(db.q("UPDATE equipment SET status='临时锁定' WHERE equipment_id=?",unit.equipment_id));
  }
  if (op.delta===0) {
    commands.push(...await completeOperation(db,user,c,price,op));
    await db.batch(commands);
    return contractDetail(db,c.contract_id);
  }
  const no = uid('ADJ');
  op.requestNo = no;
  const kind = op.delta>0?'补款':'退款';
  commands.push(paymentInsert(db,no,c.contract_id,kind,Math.abs(op.delta)));
  commands.push(db.q('UPDATE rental_contract SET price_snapshot=? WHERE contract_id=?',JSON.stringify({...price,pending:op}),c.contract_id));
  commands.push(...audit(db,user,op.type+'提交'+kind,c.status,c.status,[['rental_contract',c.contract_id]]));
  await db.batch(commands);
  const current = await contractById(db,c.contract_id);
  const request = await db.one('SELECT * FROM payment_request WHERE request_no=?',no);
  try {
    return await settleAdjustment(db,user,current,request,scenario);
  } catch (error) {
    if (error instanceof BusinessError) throw error;
    const latest = await contractById(db,c.contract_id);
    if (latest.version!==current.version) return contractDetail(db,c.contract_id);
    const rollback = [
      lockContract(db,latest),
      db.q("UPDATE payment_request SET status=CASE WHEN status='待支付' THEN '失败' ELSE NULL END WHERE request_no=?",no),
      db.q('UPDATE rental_contract SET price_snapshot=? WHERE contract_id=?',JSON.stringify(price),c.contract_id)
    ];
    if (op.type==='换装') rollback.push(db.q(`UPDATE equipment SET status=${releaseState(String(op.replacement.equipment_id))},version=version+1 WHERE equipment_id=? AND status='临时锁定'`,op.replacement.equipment_id));
    rollback.push(...audit(db,user,op.type+'保存失败',c.status,c.status,[['rental_contract',c.contract_id],['payment_request',request.payment_request_id]],'已撤销本次操作'));
    await db.batch(rollback);
    console.error('Simulated adjustment could not be saved:',error.message);
    throw new BusinessError(op.type+'保存失败，原业务状态已保留，请重新核对后办理。',500);
  }
}
async function completeOperation(db,user,c,price,op) {
  const id = c.contract_id;
  const commands = [];
  const targets = [['rental_contract',id]];
  const { pending,...base } = price;
  const adjustment = { at:op.at,type:op.type,store:op.store,amount:op.delta,requestNo:op.requestNo ?? null };
  let next = c.status;
  const returnUnit = (item,condition,itemStatus) => {
    const changed = item.current_store_id!==op.store;
    const damaged = condition!==conditions[0];
    const status = damaged?'待检查':'可租';
    const movement = op.type==='换装'?'换装退回':changed?'跨店归还':'归还';
    commands.push(guard(db,'equipment','equipment_id',item.equipment_id,item.equipment_version));
    commands.push(db.q('UPDATE rental_item SET rented_to=?,item_status=? WHERE rental_item_id=?',op.at,itemStatus,item.rental_item_id));
    commands.push(db.q(`UPDATE equipment SET current_store_id=?,status=${damaged?"'待检查'":scheduledState(String(item.equipment_id))} WHERE equipment_id=?`,op.store,item.equipment_id));
    commands.push(db.q(`INSERT INTO equipment_location_history(equipment_id,from_store_id,to_store_id,contract_id,
      recorded_by_user_id,movement_type,moved_at,note) VALUES(?,?,?,?,?,?,?,?)`,item.equipment_id,item.current_store_id,op.store,id,
      user.user_id,movement,op.at,condition));
    targets.push(['equipment',item.equipment_id]);
    if (damaged) commands.push(...audit(db,user,'归还安全隔离','租出','待检查',[['equipment',item.equipment_id],['rental_contract',id]]));
  };
  if (op.type==='归还') {
    for (const row of op.inspections) returnUnit(row,row.condition,'已归还');
    adjustment.details = op.inspections.map(i=>({asset_no:i.asset_no,condition:i.condition,damage:i.damage,overdue:i.overdue,deposit:i.deposit}));
    adjustment.missing = op.missing;
    adjustment.crossStore = op.crossStore;
    adjustment.changedReturnStore = op.changedReturnStore;
    next = op.missing.length?'处理异常':'已归还';
    commands.push(db.q('UPDATE rental_contract SET return_store_id=?,status=? WHERE contract_id=?',op.store,next,id));
  } else if (op.type==='未取件取消') {
    const itemStatus = c.status==='待支付'?'待支付':'已预留';
    next = '已取消';
    commands.push(...cancelContractChanges(db,id,op.items,itemStatus));
    commands.push(...cancelUncollectedTask(db,c.service_task_id,op.at,'取消未取件合同'));
    commands.push(db.q("UPDATE payment_request SET status='失败' WHERE contract_id=? AND request_type='收费' AND status IN ('待支付','处理中')",id));
    targets.push(...op.items.filter(i=>i.item_status===itemStatus).map(i=>['equipment',i.equipment_id]));
  } else {
    const replacement = op.replacement;
    const newAsset = await db.one('SELECT * FROM equipment WHERE equipment_id=?',replacement.equipment_id);
    if (op.delta) {
      requireRule(newAsset.status==='临时锁定','替换装备锁定状态已变化，请核对');
      commands.push(guard(db,'equipment','equipment_id',newAsset.equipment_id,newAsset.version));
      commands.push(db.q(`UPDATE equipment SET status=${releaseState(String(newAsset.equipment_id))} WHERE equipment_id=?`,newAsset.equipment_id));
    }
    returnUnit(op.old,exchangedCondition(op.reason,op.condition),'已换出');
    commands.push(db.q(`INSERT INTO rental_item(contract_id,equipment_id,replaces_item_id,rented_from,quoted_price,item_status)
      VALUES(?,?,?,?,?,'租出')`,id,newAsset.equipment_id,op.old.rental_item_id,op.at,replacement.rent));
    commands.push(db.q("UPDATE equipment SET status='租出' WHERE equipment_id=?",newAsset.equipment_id));
    const { equipment_id,asset_no,model,size,category,daily,days,rent,deposit } = replacement;
    base.currentLines = (base.currentLines||base.lines).map(l=>l.equipment_id===op.old.equipment_id?
      {equipment_id,asset_no,model,size,category,daily,days,rent,deposit}:l);
    if (op.fit) base.fit = op.fit;
    Object.assign(adjustment,{ from:op.old.asset_no,to:replacement.asset_no,reason:op.reason });
    targets.push(['equipment',newAsset.equipment_id]);
  }
  const changes = [...(base.adjustments||[]),adjustment];
  commands.push(db.q('UPDATE rental_contract SET price_snapshot=? WHERE contract_id=?',JSON.stringify({...base,adjustments:changes}),id));
  commands.push(...audit(db,user,op.type+'完成',c.status,next,targets,op.missing?.length?'装备缺失':'成功'));
  return commands;
}
export async function settleAdjustment(db,user,c,request,scenario) {
  requireRule(request,'未找到支付请求',404);
  if (request.status==='成功') return contractDetail(db,c.contract_id);
  const price = snapshot(c);
  const op = price.pending?.requestNo===request.request_no?price.pending:null;
  requireRule(!op || !user || op.store===user.store_id,'请在原操作门店处理这笔款项',403);
  const rentalEnded = c.end_at<=now();
  const expiredExchange = op?.type==='换装' && (rentalEnded || paymentHoldUntil(request.created_at)<=now());
  const result = paymentOutcome(db,request,scenario,
    expiredExchange?lapsedPayment('DEMO_EXCHANGE_EXPIRED'):undefined);
  if (!result) return contractDetail(db,c.contract_id);
  const commands = [lockContract(db,c),...result.statements];
  if (op?.type==='归还' || (op && result.status==='成功')) {
    commands.push(...await completeOperation(db,user,c,price,op));
  } else if (expiredExchange || (op?.type==='换装' && request.request_type==='补款' && result.status==='失败')) {
    const { pending,...prior } = price;
    if (expiredExchange) {
      prior.adjustments = [...(prior.adjustments||[]),{
        at:now(),type:'换装取消',amount:0,store:op.store,requestNo:request.request_no,cancelled:true,
        reason:rentalEnded?'租期已结束，请办理原装备归还':'模拟支付保留期已过，原装备仍在合同中'
      }];
      commands.push(...audit(db,user,'换装过期取消',c.status,c.status,
        [['rental_contract',c.contract_id],['equipment',op.replacement.equipment_id],['payment_request',request.payment_request_id]],'已释放替换装备',op.store));
    }
    commands.push(db.q('UPDATE rental_contract SET price_snapshot=? WHERE contract_id=?',JSON.stringify(prior),c.contract_id));
    const unit = await db.one('SELECT version FROM equipment WHERE equipment_id=?',op.replacement.equipment_id);
    commands.push(guard(db,'equipment','equipment_id',op.replacement.equipment_id,unit.version));
    commands.push(db.q(`UPDATE equipment SET status=${releaseState(String(op.replacement.equipment_id))} WHERE equipment_id=? AND status='临时锁定'`,op.replacement.equipment_id));
  }
  commands.push(...audit(db,user,request.request_type+'结果',request.status,result.status,
    [['rental_contract',c.contract_id],['payment_request',request.payment_request_id]],result.status,op?.store??user?.store_id));
  await db.batch(commands);
  return contractDetail(db,c.contract_id);
}
export async function retryPayment(db,user,body) {
  const no = textField(body.requestNo,'支付请求号',64);
  const request = await db.one('SELECT * FROM payment_request WHERE request_no=?',no);
  requireRule(request,'未找到支付请求',404);
  const c = await contractById(db,request.contract_id);
  if (request.request_type==='收费') {
    requireRule([c.task_store_id,c.pickup_store_id].includes(user.store_id),'请在办理门店或取件门店查询支付结果',403);
    if (request.status==='成功') return contractDetail(db,c.contract_id);
    if (request.status==='失败') {
      const terminal = await db.one(`SELECT response_code FROM payment_transaction WHERE payment_request_id=?
        ORDER BY attempt_no DESC LIMIT 1`,request.payment_request_id);
      if (['DEMO_CHARGE_EXPIRED','DEMO_CHARGE_CANCELLED'].includes(terminal?.response_code)) return contractDetail(db,c.contract_id);
    }
    requireRule(request.status!=='失败','本次收费已失败，请重新确认装备方案后发起新请求');
    return settleCharge(db,user,c,body.scenario,request.payment_request_id);
  }
  const price = snapshot(c);
  const adjustment = price.adjustments?.find(a=>a.requestNo===no);
  const pending = price.pending?.requestNo===no?price.pending:null;
  requireRule(pending || adjustment,'该费用调整已撤销，请重新办理');
  requireRule(user.store_id===(pending?.store??adjustment?.store??c.return_store_id??c.pickup_store_id),
    '请在原操作门店处理这笔款项',403);
  if (adjustment?.cancelled) return contractDetail(db,c.contract_id);
  return settleAdjustment(db,user,c,request,body.scenario);
}
