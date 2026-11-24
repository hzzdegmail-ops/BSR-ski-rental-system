import { BusinessError, audit, day, guard, inventorySQL, now, positiveId, requireRule, snapshot, textField, uid, integerList } from './data.js';
import { quote } from './domain.js';
import { recommend } from './equipment-repository.js';
import { lapsedPayment, paymentHoldUntil, paymentInsert, paymentOutcome } from './payment.js';
import { contractById, contractDetail, contractItems } from './contract-repository.js';
import { cancelUncollectedTask, getTask } from './reception.js';
import {scheduledState,releaseState} from './advance-booking.js';

const chargeFor = (db,id) => db.one(`SELECT * FROM payment_request WHERE contract_id=? AND request_type='收费'
  ORDER BY payment_request_id DESC LIMIT 1`,id);

export async function quoteContract(db,user,body,tokens) {
  const draft = await tokens.read(body.token,'quote');
  requireRule(draft && draft.userId===user.user_id,'装备推荐已过期，请回到接待界面重新查询',409);
  requireRule(draft.range.end>now(),'计划结束时间已过，请回到接待界面更新租期',409);
  const task = await getTask(db,user,draft.taskId);
  if(draft.advance) requireRule(task.task_type==='提前预订' && task.reservation?.status==='待接待' && task.reservation.version===draft.reservationVersion,
    '预约资料或办理阶段已变化，请重新选装',409);
  else requireRule(task.task_type==='现场接待','请通过预约选装入口办理提前预订',409);
  requireRule(task.status==='待合同确认','办理任务尚未完成推荐或已经结束');
  requireRule(task.recommendation_revision===draft.revision,'适配资料或查询条件已更新，请重新推荐并核对合同',409);
  const ids = integerList(body.equipmentIds);
  requireRule(ids.every(id=>draft.candidateIds.includes(id)),'所选装备超出本次推荐范围');
  const result = await recommend(db,draft.fit,draft.range,draft.selected,draft.pickup,draft.system);
  const {excluded}=result;
  const candidates=[...result.candidates,...result.alternatives];
  const lost = ids.filter(id=>!candidates.some(c=>c.equipment_id===id));
  if (lost.length) {
    const conflicts = excluded.filter(e=>lost.includes(e.equipment_id));
    const safety = conflicts.filter(e=>e.check);
    if (safety.length) await db.batch(safety.flatMap(e=>audit(db,user,'安全检查待办',null,'待检查',[['equipment',e.equipment_id]])));
    requireRule(false,'装备已变化：'+conflicts.map(e=>e.asset_no+' '+e.reason).join('、')+'。可选装备：'+
      candidates.slice(0,5).map(c=>c.asset_no).join('、')+'。请重新查询。',409);
  }
  const price = quote(candidates,ids,draft.selected,draft.returnStore);
  price.advanceBooking=!!draft.advance;
  const trial=price.lines.filter(l=>l.requiresFitConfirmation);
  if (trial.length) {
    if(draft.advance) price.fitReview={equipmentIds:trial.map(l=>l.equipment_id),pending:true,note:'临近尺寸已预订，到店试穿核对后方可交付'};
    else {
      requireRule(body.fitConfirmed===true,'所选临近尺寸装备须经员工试穿核对后确认');
      const note=textField(body.fitNote,'试穿核对说明',255);
      price.fitReview={equipmentIds:trial.map(l=>l.equipment_id),note,confirmedBy:user.user_id,confirmedAt:now()};
    }
  }
  return { draft,task,price };
}
export function cancelContractChanges(db, contractId, items, itemStatus) {
  return [
    db.q("UPDATE rental_contract SET status='已取消' WHERE contract_id=?",contractId),
    db.q("UPDATE rental_item SET item_status='已取消' WHERE contract_id=? AND item_status=?",contractId,itemStatus),
    ...items.filter(item=>item.item_status===itemStatus).flatMap(item=>[
      guard(db,'equipment','equipment_id',item.equipment_id,item.equipment_version),
      db.q(`UPDATE equipment SET status=${releaseState(String(item.equipment_id))} WHERE equipment_id=?`,item.equipment_id)
    ])
  ];
}
export async function cancelPendingCharge(db,actor,contract,code,expectedRequestId) {
  const id=contract.contract_id;
  const [request,items]=await Promise.all([chargeFor(db,id),contractItems(db,id)]);
  requireRule(request && ['待支付','处理中'].includes(request.status),'已获得支付结果，请重新核对合同',409);
  requireRule(expectedRequestId===undefined || request.payment_request_id===expectedRequestId,'支付请求已变化，请重新核对',409);
  const result=paymentOutcome(db,request,null,lapsedPayment(code));
  const reason=code==='DEMO_CHARGE_EXPIRED'?'模拟支付超时':'未取件取消';
  await db.batch([
    guard(db,'rental_contract','contract_id',id,contract.version),
    ...result.statements,
    ...cancelContractChanges(db,id,items,'待支付'),
    ...cancelUncollectedTask(db,contract.service_task_id,now(),reason,code==='DEMO_CHARGE_EXPIRED'),
    ...audit(db,actor,reason,'待支付','已取消',[
      ['rental_contract',id],['service_task',contract.service_task_id],['payment_request',request.payment_request_id],
      ...items.filter(i=>i.item_status==='待支付').map(i=>['equipment',i.equipment_id])
    ],'已释放装备',actor?.store_id??contract.pickup_store_id)
  ]);
}
export async function confirmContract(db,user,body,tokens) {
  const token = await tokens.read(body.token,'quote');
  requireRule(token && token.userId===user.user_id,'装备推荐已过期，请重新查询',409);
  const existing = await db.one('SELECT * FROM rental_contract WHERE service_task_id=?',token.taskId);
  if (existing && existing.status!=='已取消') {
    if (existing.status==='待支付') {
      const task = await getTask(db,user,token.taskId);
      requireRule(task.recommendation_revision===token.revision,'请在合同详情查询现有支付请求',409);
      requireRule(body.confirm===true,'请先确认合同摘要及费用规则');
      return settleCharge(db,user,existing,body.scenario);
    }
    return contractDetail(db,existing.contract_id);
  }
  const { draft,task,price } = await quoteContract(db,user,body,tokens);
  requireRule(body.confirm===true,'请先确认合同摘要及费用规则');
  const fullPrice = { ...price,fit:draft.fit,system:draft.system,advanceBooking:!!draft.advance };
  const queries = [db.q(`UPDATE service_task SET recommendation_revision=CASE
    WHEN recommendation_revision=? AND status='待合同确认' THEN recommendation_revision ELSE NULL END WHERE task_id=?`,
    draft.revision,task.task_id)];
  if(draft.advance) queries.push(db.q(`UPDATE service_reservation SET status='待支付',version=CASE WHEN version=? AND status='待接待' THEN version+1 ELSE NULL END WHERE reservation_id=?`,draft.reservationVersion,draft.reservationId));
  if (price.fitReview) queries.push(...audit(db,user,price.fitReview.pending?'预订临近尺寸待试穿':'临近尺寸试穿确认',null,price.fitReview.pending?'待试穿':'已确认',
    [['service_task',task.task_id],...price.fitReview.equipmentIds.map(id=>['equipment',id])],price.fitReview.note));
  const no = uid('BSR');
  if (existing) {
    queries.push(guard(db,'rental_contract','contract_id',existing.contract_id,existing.version));
    queries.push(db.q(`UPDATE rental_contract SET pickup_store_id=?,return_store_id=NULL,start_at=?,end_at=?,status='待支付',
      amount_due=?,price_snapshot=? WHERE contract_id=?`,price.pickup,draft.range.start,draft.range.end,price.total,
      JSON.stringify(fullPrice),existing.contract_id));
  } else queries.push(db.q(`INSERT INTO rental_contract(contract_no,service_task_id,customer_id,pickup_store_id,start_at,end_at,status,amount_due,price_snapshot)
    VALUES(?,?,?,?,?,?,'待支付',?,?)`,no,task.task_id,task.customer_id,price.pickup,draft.range.start,draft.range.end,price.total,JSON.stringify(fullPrice)));
  const lock = price.lines.map(line=>db.q(`INSERT INTO rental_item(contract_id,equipment_id,rented_from,quoted_price,item_status)
    VALUES(coalesce(?,(SELECT max(contract_id) FROM rental_contract)),?,?,?,'待支付')
    ON CONFLICT(contract_id,equipment_id,rented_from) DO UPDATE SET quoted_price=excluded.quoted_price,
      item_status='待支付',rented_to=NULL WHERE rental_item.item_status='已取消'`,
    existing?.contract_id ?? null,line.equipment_id,draft.range.start,line.rent));
  queries.push(...lock);
  queries.push(...price.lines.map(l=>db.q(`UPDATE equipment SET status=${scheduledState(String(l.equipment_id))},version=version+1 WHERE equipment_id=?`,l.equipment_id)));
  const requestNo = uid('PAY');
  queries.push(paymentInsert(db,requestNo,existing?.contract_id ?? null,'收费',price.total));
  queries.push(...audit(db,user,'提交合同收费',existing?.status??null,'待支付',
    [['service_task',task.task_id],...price.lines.map(l=>['equipment',l.equipment_id])]));
  queries.push(db.q(`INSERT INTO audit_event_target(audit_event_id,entity_type,entity_id)
    SELECT (SELECT max(audit_event_id) FROM audit_event),'rental_contract',contract_id FROM rental_contract WHERE service_task_id=?`,task.task_id));
  await db.batch(queries);
  const contract = await db.one('SELECT * FROM rental_contract WHERE service_task_id=?',task.task_id);
  return settleCharge(db,user,contract,body.scenario);
}
export async function settleCharge(db,user,contract,scenario,expectedRequestId) {
  requireRule(contract.pickup_store_id===user.store_id ||
    (await db.one('SELECT store_id FROM service_task WHERE task_id=?',contract.service_task_id))?.store_id===user.store_id,
    '请在办理门店或取件门店查询支付结果',403);
  if (contract.status!=='待支付') return contractDetail(db,contract.contract_id);
  const id = contract.contract_id;
  const task=await db.one('SELECT * FROM service_task WHERE task_id=?',contract.service_task_id);
  const advance=!!snapshot(contract).advanceBooking;
  const [request,items] = await Promise.all([
    chargeFor(db,id),
    contractItems(db,id)
  ]);
  requireRule(request,'未找到合同支付请求',409);
  requireRule(expectedRequestId===undefined || request.payment_request_id===expectedRequestId,'这笔收费请求已结束，请重新核对合同',409);
  if (['待支付','处理中'].includes(request.status) && paymentHoldUntil(request.created_at)<=now()) {
    await cancelPendingCharge(db,user,contract,'DEMO_CHARGE_EXPIRED',request.payment_request_id);
    return contractDetail(db,id);
  }
  requireRule(contract.end_at>now(),'合同租期已结束，请处理未取件超时合同',409);
  const result = paymentOutcome(db,request,scenario);
  if (!result) return contractDetail(db,id);
  const next = { '成功':'已确认','失败':'已取消','处理中':'待支付' }[result.status];
  const commands = [guard(db,'rental_contract','contract_id',id,contract.version),...result.statements];
  if (next==='已取消') {
    commands.push(...cancelContractChanges(db,id,items,'待支付'));
    if(advance && task.task_type==='提前预订') commands.push(...cancelUncollectedTask(db,task.task_id,now(),'预订付款失败',true));
    else if(advance) commands.push(db.q("UPDATE service_reservation SET status='已接待',version=version+1 WHERE reservation_id=?",task.reservation_id));
  }
  if (next==='已确认') {
    commands.push(db.q('UPDATE rental_contract SET status=? WHERE contract_id=?',next,id));
    commands.push(db.q("UPDATE rental_item SET item_status='已预留' WHERE contract_id=? AND item_status='待支付'",id));
    for (const item of items.filter(i=>i.item_status==='待支付')) {
      commands.push(guard(db,'equipment','equipment_id',item.equipment_id,item.equipment_version));
      commands.push(db.q(`UPDATE equipment SET status=${scheduledState(String(item.equipment_id))} WHERE equipment_id=?`,item.equipment_id));
    }
    if(task.task_type==='提前预订') commands.push(db.q("UPDATE service_task SET status='已完成',current_stage='装备已预订',finished_at=? WHERE task_id=?",now(),task.task_id));
    else commands.push(db.q("UPDATE service_task SET status='办理中',current_stage='待取件',finished_at=NULL WHERE task_id=?",task.task_id));
    commands.push(db.q("UPDATE service_reservation SET status=?,version=version+1 WHERE reservation_id=?",advance&&task.task_type==='提前预订'?'已预订':'已接待',task.reservation_id));
  }
  commands.push(...audit(db,user,'合同收费结果',contract.status,next,
    [['rental_contract',id],['payment_request',request.payment_request_id],...items.filter(i=>i.item_status==='待支付').map(i=>['equipment',i.equipment_id])],result.status));
  try {
    await db.batch(commands);
  } catch (error) {
    const current = await contractById(db,id);
    if (current?.version!==contract.version || current?.status!=='待支付') return contractDetail(db,id);
    // The simulator has no external charge to reverse. Cancel only this unchanged request.
    await db.batch([
      guard(db,'rental_contract','contract_id',id,contract.version),
      db.q("UPDATE payment_request SET status=CASE WHEN status=? THEN '失败' ELSE NULL END WHERE payment_request_id=?",
        request.status,request.payment_request_id),
      ...cancelContractChanges(db,id,items,'待支付'),
      ...(advance && task.task_type==='提前预订'?cancelUncollectedTask(db,task.task_id,now(),'预订付款保存失败',true):[]),
      ...audit(db,user,'模拟支付保存失败','待支付','已取消',
        [['rental_contract',id],['payment_request',request.payment_request_id],...items.filter(i=>i.item_status==='待支付').map(i=>['equipment',i.equipment_id])],'已释放装备')
    ]);
    console.error('Simulated charge outcome could not be saved:',error.message);
    throw new BusinessError('模拟支付结果保存失败，合同已取消、装备已释放。可重新核对方案后发起新请求。',500);
  }
  return contractDetail(db,id);
}
export async function pickupContract(db,user,body) {
  requireRule(body.confirm===true,'请先核对实际交付装备');
  const contract = await contractById(db,positiveId(body.contractId,'合同'));
  requireRule(contract?.status==='已确认','只有已确认合同可以取件',409);
  requireRule(contract.pickup_store_id===user.store_id,'请切换至合同取件门店办理',403);
  const t = now();
  const price=snapshot(contract),task=await db.one('SELECT * FROM service_task WHERE task_id=?',contract.service_task_id);
  requireRule(task,'合同办理记录缺失，请核对原合同',409);
  if(price.advanceBooking) requireRule(task.task_type==='现场接待' && task.status==='办理中','请先确认预约到店，并从现场队列开始核对取件',409);
  if(price.fitReview?.pending) {
    requireRule(body.fitConfirmed===true,'临近尺寸预订须在到店试穿后确认');
    price.fitReview={...price.fitReview,pending:false,note:textField(body.fitNote,'试穿核对说明',255),confirmedBy:user.user_id,confirmedAt:t};
  }
  requireRule(t<contract.end_at,'合同租期已结束，请处理未取件超时合同');
  requireRule(t>=contract.start_at,'尚未到合同约定开始时间，请按时取件或取消后按新租期重办',409);
  requireRule(!snapshot(contract).pending,'合同正在处理取消退款，暂不能取件',409);
  const items = (await contractItems(db,contract.contract_id)).filter(i=>i.item_status==='已预留');
  requireRule(items.length,'该合同无待取装备',409);
  const checks = await db.all(inventorySQL+' WHERE e.equipment_id IN (SELECT value FROM json_each(?))',
    JSON.stringify(items.map(i=>i.equipment_id)));
  const unsafe = checks.filter(e=>!['已预留','临时锁定'].includes(e.status) || e.current_store_id!==user.store_id ||
    e.inspection_result!=='合格' || e.valid_until<day(contract.end_at));
  if (unsafe.length) {
    await db.batch(unsafe.flatMap(e=>audit(db,user,'安全检查待办',null,'待检查',[['equipment',e.equipment_id]])));
    requireRule(false,'装备状态、位置或检查有效期已变化，请先处理检查待办',409);
  }
  await db.batch([
    guard(db,'rental_contract','contract_id',contract.contract_id,contract.version),
    db.q("UPDATE rental_contract SET status='租出' WHERE contract_id=?",contract.contract_id),
    db.q("UPDATE rental_item SET item_status='租出',rented_from=? WHERE contract_id=? AND item_status='已预留'",t,contract.contract_id),
    ...items.flatMap(i=>[guard(db,'equipment','equipment_id',i.equipment_id,i.equipment_version),
      db.q("UPDATE equipment SET status='租出' WHERE equipment_id=?",i.equipment_id)]),
    ...(price.advanceBooking?[
      db.q(`INSERT INTO customer_fit_profile(customer_id,height_cm,weight_kg,foot_length_mm,shoe_size,skill_level,equipment_preference,updated_at)
        VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(customer_id) DO UPDATE SET height_cm=excluded.height_cm,weight_kg=excluded.weight_kg,
        foot_length_mm=excluded.foot_length_mm,shoe_size=excluded.shoe_size,skill_level=excluded.skill_level,
        equipment_preference=excluded.equipment_preference,updated_at=excluded.updated_at`,contract.customer_id,price.fit.height_cm,price.fit.weight_kg,
        price.fit.foot_length_mm,price.fit.shoe_size,price.fit.skill_level,price.fit.equipment_preference,t),

      db.q('UPDATE rental_contract SET price_snapshot=? WHERE contract_id=?',JSON.stringify(price),contract.contract_id),
      ...(price.fitReview?[...audit(db,user,'预订到店试穿确认',null,'已确认',[['rental_contract',contract.contract_id]],price.fitReview.note)]:[])
    ]:[]),
    db.q("UPDATE service_task SET status='已完成',current_stage='装备已交付',finished_at=? WHERE task_id=? AND status IN ('办理中','待合同确认')",t,task.task_id),
    db.q("UPDATE service_reservation SET status='已完成',version=version+1 WHERE reservation_id=? AND status='已接待'",task.reservation_id),
    ...audit(db,user,'装备交付','已确认','租出',[['rental_contract',contract.contract_id],...items.map(i=>['equipment',i.equipment_id])])
  ]);
  return contractDetail(db,contract.contract_id);
}
