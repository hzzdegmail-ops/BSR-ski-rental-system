import { audit, activeStore, now, day, positiveId, requireRule, textField } from './data.js';
import { categories, fitProfile, rentalDates } from './domain.js';
import { demo } from './demo-config.js';
import { recommend } from './equipment-repository.js';
import { reservationDetail } from './reservations.js';

const arrivalAt = `coalesce(st.enqueued_at,(SELECT min(a.occurred_at)
  FROM audit_event_target t JOIN audit_event a USING(audit_event_id)
  WHERE t.entity_type='service_task' AND t.entity_id=st.task_id AND a.event_type='接待登记'),st.started_at)`;

export async function receptionQueue(db, user) {
  return db.all(`SELECT st.*,c.name,c.phone,s.name AS store_name,sr.reservation_no,ua.display_name AS assigned_name,
    (SELECT contract_id FROM rental_contract WHERE service_task_id=st.task_id AND status IN ('待支付','已确认')) AS contract_id,${arrivalAt} AS arrived_at
    FROM service_task st JOIN customer c USING(customer_id) JOIN store s USING(store_id)
    LEFT JOIN service_reservation sr USING(reservation_id)
    LEFT JOIN user_account ua ON ua.user_id=st.assigned_user_id
    WHERE st.store_id=? AND st.task_type='现场接待' AND st.status IN ('排队中','办理中','待合同确认')
    ORDER BY arrived_at,st.task_id`,user.store_id);
}
function normalizedPhone(value) {
  const key=value.normalize('NFKC').replace(/[\s-]/g,'');
  return /^\+?[0-9]{7,15}$/.test(key)?key:null;
}

async function customerByPhone(db,phone) {
  if (!phone) return null;
  const matches=await db.all("SELECT * FROM customer WHERE replace(replace(phone,' ',''),'-','')=? LIMIT 2",phone);
  requireRule(matches.length<=1,'此号码对应多份旧档案，请按顾客编号或预约号核对后办理',409);
  return matches[0]??null;
}

export async function lookupCustomer(db, raw) {
  const key = textField(raw.key,'手机号、预约号或顾客编号',40);
  const reservationSQL=`SELECT sr.*,s.name AS store_name FROM service_reservation sr JOIN store s USING(store_id)`;
  let reservation=await db.one(reservationSQL+' WHERE upper(sr.reservation_no)=upper(?)',key);
  const customer = reservation
    ? await db.one('SELECT * FROM customer WHERE customer_id=?',reservation.customer_id)
    : await customerByPhone(db,normalizedPhone(key)) ??
      await db.one('SELECT * FROM customer WHERE CAST(customer_id AS TEXT)=?',key);
  if (!reservation && customer) {
    reservation=await db.one(reservationSQL+` WHERE sr.customer_id=? AND (
      (sr.status IN ('待接待','待支付','已预订') AND julianday(sr.requested_end_at)>julianday(?)) OR
      (sr.status='已接待' AND EXISTS(SELECT 1 FROM service_task t WHERE t.reservation_id=sr.reservation_id
        AND t.status IN ('排队中','办理中','待合同确认'))))
      ORDER BY coalesce(sr.appointment_at,sr.requested_start_at),sr.reservation_id LIMIT 1`,customer.customer_id,now());
  }
  const profile = customer
    ? await db.one('SELECT * FROM customer_fit_profile WHERE customer_id=?',customer.customer_id) : null;
  return { customer, reservation, profile };
}

const activeReception = (db,customerId,storeId) => db.one(`SELECT * FROM service_task WHERE customer_id=? AND store_id=?
  AND task_type='现场接待' AND status IN ('排队中','办理中','待合同确认') ORDER BY task_id LIMIT 1`,customerId,storeId);

export async function enqueue(db, user, body) {
  let customerId = body.customerId ? positiveId(body.customerId,'顾客') : null;
  const reservationId = body.reservationId ? positiveId(body.reservationId,'预约') : null;
  if (reservationId) {
    const reservation = await db.one('SELECT * FROM service_reservation WHERE reservation_id=?',reservationId);
    requireRule(reservation && reservation.customer_id===customerId,'预约与顾客资料不一致');
    requireRule(reservation.store_id===user.store_id,'请在预约所属门店接待，或按现场顾客办理');
    requireRule(['待接待','待支付','已预订','已接待'].includes(reservation.status),'该预约已结束，请按现场顾客办理新的租赁');
    const prior = await db.one("SELECT * FROM service_task WHERE reservation_id=? AND status<>'已取消'",reservationId);
    if (prior) {
      if(prior.task_type==='提前预订') {
        requireRule(!await activeReception(db,customerId,user.store_id),'该顾客已有现场办理任务，请先完成或取消后再确认预约到店',409);
        const at=now();
        await db.batch([
          db.q(`UPDATE service_task SET recommendation_revision=CASE WHEN task_type='提前预订' AND recommendation_revision=? THEN recommendation_revision+1 ELSE NULL END,
            task_type='现场接待',status='排队中',current_stage='等待接待',assigned_user_id=NULL,
            enqueued_at=?,started_at=?,finished_at=NULL,queue_no=(SELECT coalesce(max(queue_no),0)+1 FROM service_task
              WHERE store_id=? AND task_type='现场接待' AND date(enqueued_at,'+8 hours')=date(?,'+8 hours')) WHERE task_id=?`,
            prior.recommendation_revision,at,at,user.store_id,at,prior.task_id),
          db.q("UPDATE service_reservation SET status='已接待',version=version+1 WHERE reservation_id=?",reservationId),
          ...audit(db,user,'确认预约到店',reservation.status,'已接待',[['service_reservation',reservationId],['service_task',prior.task_id]])
        ]);
        return {task:await getTask(db,user,prior.task_id)};
      }
      requireRule(prior.status!=='已完成','该预约已完成办理，请按现场顾客登记新的租赁');
      return { task:prior };
    }
  }
  const commands = [];
  const at = now();
  let phone;
  if (!customerId) {
    phone = normalizedPhone(textField(body.phone,'手机号',30));
    requireRule(phone,'请填写 7 至 15 位数字的手机号，可带国家区号');
    const name = textField(body.name,'顾客姓名',100);
    const email = textField(body.email,'电子邮箱',255,true);
    requireRule(!email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'电子邮箱格式不正确');
    const found = await customerByPhone(db,phone);
    if (found) customerId = found.customer_id;
    else commands.push(db.q('INSERT INTO customer(phone,name,email,created_at) VALUES(?,?,?,?) ON CONFLICT(phone) DO NOTHING',phone,name,email,at));
  }
  const current = customerId && await activeReception(db,customerId,user.store_id);
  if (current) {
    requireRule(!reservationId||current.reservation_id===reservationId,'该顾客已有现场办理任务，请先完成或取消该任务，再确认预约到店',409);
    return { task:current };
  }
  const insertPosition = commands.length;
  commands.push(db.q(`INSERT INTO service_task(reservation_id,customer_id,store_id,queue_no,current_stage,status,started_at,enqueued_at)
    VALUES(?,coalesce(?,(SELECT customer_id FROM customer WHERE phone=?)),?,
    (SELECT coalesce(max(st.queue_no),0)+1 FROM service_task st WHERE st.store_id=?
      AND date(${arrivalAt},'+8 hours')=date(?, '+8 hours')),
    '等待接待','排队中',?,?)`,reservationId,customerId,phone??null,user.store_id,user.store_id,at,at,at));
  if (reservationId) commands.push(db.q("UPDATE service_reservation SET status=CASE WHEN status='待接待' THEN '已接待' ELSE NULL END,version=version+1 WHERE reservation_id=?",reservationId));
  commands.push(...audit(db,user,'接待登记',null,'排队中',[]));
  commands.push(db.q(`INSERT INTO audit_event_target(audit_event_id,entity_type,entity_id)
    SELECT (SELECT max(audit_event_id) FROM audit_event),'service_task',max(task_id) FROM service_task`));
  try {
    const results = await db.batch(commands);
    const task = await db.one('SELECT * FROM service_task WHERE task_id=?',results[insertPosition].meta.last_row_id);
    return { task };
  } catch (error) {
    if (!/ACTIVE_RECEPTION_EXISTS|UNIQUE constraint failed: (customer.phone|service_task.reservation_id)/.test(String(error.message))) throw error;
    const id = customerId ?? (await customerByPhone(db,phone))?.customer_id;
    const task = id && await activeReception(db,id,user.store_id);
    if (!task) throw error;
    return { task };
  }
}
export async function getTask(db, user, id) {
  const task = await db.one(`SELECT st.*,c.name,c.phone,sr.requested_start_at,sr.requested_end_at,sr.reservation_no,
    fp.height_cm,fp.weight_kg,fp.foot_length_mm,fp.shoe_size,fp.skill_level,fp.equipment_preference
    FROM service_task st JOIN customer c USING(customer_id) LEFT JOIN service_reservation sr USING(reservation_id)
    LEFT JOIN customer_fit_profile fp USING(customer_id) WHERE st.task_id=? AND st.store_id=?`,positiveId(id,'办理任务'),user.store_id);
  requireRule(task,'办理任务不存在或属于另一家门店',404);
  if (task.reservation_id) task.reservation=await reservationDetail(db,user,task.reservation_id);
  const prebooked=await db.one("SELECT contract_id FROM rental_contract WHERE service_task_id=? AND status IN ('待支付','已确认')",task.task_id);
  if(prebooked) task.prebookedContractId=prebooked.contract_id;
  return task;
}
export async function beginTask(db,user,body) {
  const task = await getTask(db,user,body.taskId);
  requireRule(task.task_type==='现场接待','请先确认顾客实际到店',409);
  if (task.status==='办理中' || task.status==='待合同确认') return { task };
  requireRule(task.status==='排队中','该任务无法开始办理');
  const next=(await receptionQueue(db,user)).find(t=>t.status==='排队中');
  requireRule(next?.task_id===task.task_id,'请先开始接待排在前面的顾客；已开始的任务可继续办理',409);
  await db.batch([
    db.q(`UPDATE service_task SET assigned_user_id=?,current_stage='装备适配',
      status=CASE WHEN status='排队中' AND task_type='现场接待' THEN '办理中' ELSE NULL END,started_at=? WHERE task_id=?`,user.user_id,now(),task.task_id),
    ...audit(db,user,'开始办理',task.status,'办理中',[['service_task',task.task_id]])
  ]);
  return { task:await getTask(db,user,task.task_id) };
}
export function cancelUncollectedTask(db,taskId,at,stage='未取件超时',keepBooking=false) {
  return [
    db.q(`UPDATE service_task SET status='已取消',current_stage=?,finished_at=?
      WHERE task_id=? AND (status IN ('排队中','办理中','待合同确认') OR (task_type='提前预订' AND status='已完成'))`,stage,at,taskId),
    db.q(`UPDATE service_reservation SET status=CASE WHEN ? AND EXISTS(SELECT 1 FROM service_task WHERE task_id=? AND task_type='提前预订')
      THEN CASE WHEN julianday(requested_end_at)>julianday(?) THEN '待接待' ELSE '已过期' END ELSE '已取消' END,version=version+1
      WHERE reservation_id=(SELECT reservation_id FROM service_task WHERE task_id=? AND status='已取消')
        AND status IN ('待接待','待支付','已预订','已接待','已完成')
        AND NOT EXISTS (SELECT 1 FROM service_task WHERE reservation_id=service_reservation.reservation_id AND status<>'已取消')`,Number(keepBooking),taskId,at,taskId)
  ];
}

export async function cancelReception(db,user,body) {
  requireRule(body.confirm===true,'请确认取消办理');
  const task=await getTask(db,user,body.taskId);
  if (task.status==='已取消') return {task};
  requireRule(['排队中','办理中','待合同确认'].includes(task.status),'该任务已经完成',409);
  const pending=await db.one("SELECT 1 FROM rental_contract WHERE service_task_id=? AND status<>'已取消'",task.task_id);
  requireRule(!pending,'已有合同，请在合同详情处理取消',409);
  const at=now();
  const reason=body.reason==='离店未办理'?'离店未办理':'取消办理';
  await db.batch([
    db.q(`UPDATE service_task SET recommendation_revision=CASE WHEN status=?
      AND recommendation_revision=? AND NOT EXISTS (
        SELECT 1 FROM rental_contract WHERE service_task_id=? AND status<>'已取消'
      ) THEN recommendation_revision+1 ELSE NULL END WHERE task_id=?`,task.status,task.recommendation_revision,task.task_id,task.task_id),
    ...cancelUncollectedTask(db,task.task_id,at,reason),
    ...audit(db,user,reason,task.status,'已取消',[['service_task',task.task_id]])
  ]);
  return {task:await getTask(db,user,task.task_id)};
}

export async function closeLegacyUncollectedTasks(db) {
  const closed=await db.all(`SELECT t.task_id,json_extract(a.value,'$.at') AS cancelled_at
    FROM service_task t JOIN rental_contract c ON c.service_task_id=t.task_id
    JOIN json_each(c.price_snapshot,'$.adjustments') a
    WHERE c.status='已取消' AND t.status IN ('排队中','办理中','待合同确认')
      AND json_extract(a.value,'$.type')='未取件取消'`);
  for (const task of closed) {
    await db.batch(cancelUncollectedTask(db,task.task_id,task.cancelled_at||now()));
  }
}

export async function recommendTask(db,user,body,tokens) {
  const task = await getTask(db,user,body.taskId);
  requireRule(task.task_type==='现场接待','请通过预约选装入口办理提前预订',409);
  requireRule(['办理中','待合同确认'].includes(task.status),'请先开始办理');
  const paymentInProgress = await db.one("SELECT 1 FROM rental_contract WHERE service_task_id=? AND status='待支付'",task.task_id);
  requireRule(!paymentInProgress,'合同正在等待支付结果，请先在合同详情处理',409);
  const fit = fitProfile(body.fit);
  const range = rentalDates(body.start,body.end);
  const pickup = await activeStore(db,body.pickup);
  const returnStore = await activeStore(db,body.returnStore);
  const selected = body.categories;
  requireRule(Array.isArray(selected) && selected.length && selected.length<=4 &&
    new Set(selected).size===selected.length && selected.every(c=>Object.hasOwn(categories,c)), '请至少选择一项装备类别');
  const system = body.system==='Touring'?'Touring':'Alpine';
  const results = await recommend(db,fit,range,selected,pickup,system);
  const pool=[...results.candidates,...results.alternatives];
  const storePlans=await db.all('SELECT store_id,name FROM store WHERE active=1 ORDER BY store_id');
  for (const store of storePlans) {
    store.missing=selected.filter(category=>!pool.some(c=>c.category===category && c.current_store_id===store.store_id));
    store.trial=selected.filter(category=>!results.candidates.some(c=>c.category===category && c.current_store_id===store.store_id) &&
      results.alternatives.some(c=>c.category===category && c.current_store_id===store.store_id));
    store.complete=!store.missing.length;
  }
  const hasCompletePlan = storePlans.some(s=>s.complete);
  const next = hasCompletePlan?'待合同确认':'办理中';
  const queries = [
    db.q(`INSERT INTO customer_fit_profile(customer_id,height_cm,weight_kg,foot_length_mm,shoe_size,skill_level,equipment_preference,updated_at)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(customer_id) DO UPDATE SET
      height_cm=excluded.height_cm,weight_kg=excluded.weight_kg,foot_length_mm=excluded.foot_length_mm,
      shoe_size=excluded.shoe_size,skill_level=excluded.skill_level,equipment_preference=excluded.equipment_preference,updated_at=excluded.updated_at`,
      task.customer_id,fit.height_cm,fit.weight_kg,fit.foot_length_mm,fit.shoe_size,fit.skill_level,fit.equipment_preference,now()),
    db.q(`UPDATE service_task SET status=?,current_stage=?,
      recommendation_revision=CASE WHEN recommendation_revision=? AND status IN ('办理中','待合同确认')
        AND NOT EXISTS (SELECT 1 FROM rental_contract WHERE service_task_id=? AND status='待支付')
        THEN recommendation_revision+1 ELSE NULL END WHERE task_id=?`,
      next,hasCompletePlan?'合同确认':'装备适配',task.recommendation_revision,task.task_id,task.task_id),
    ...audit(db,user,'装备推荐',task.status,next,[['service_task',task.task_id],['customer',task.customer_id]])
  ];
  for (const entry of results.excluded.filter(r=>r.check)) {
    const event = entry.reason.startsWith('固定器')?'部件兼容检查':'安全检查待办';
    const recorded = await db.one(`SELECT 1 FROM audit_event a JOIN audit_event_target t USING(audit_event_id)
      WHERE t.entity_type='equipment' AND t.entity_id=? AND a.event_type=? AND date(a.occurred_at,'+8 hours')=?`,entry.equipment_id,event,day(now()));
    if (!recorded) queries.push(...audit(db,user,event,null,'待检查',[['equipment',entry.equipment_id]]));
  }
  await db.batch(queries);
  return { ...results,storePlans,hasCompletePlan, validMinutes:demo.quoteMinutes, token:pool.length?await tokens.sign({
    kind:'quote',userId:user.user_id,taskId:task.task_id,customerId:task.customer_id,fit,range,pickup,returnStore,
    selected,system,revision:task.recommendation_revision+1,candidateIds:pool.map(r=>r.equipment_id)
  },demo.quoteMinutes):null };
}

export async function restoreReceptionStages(db) {
  const tasks=await db.all(`SELECT t.*,EXISTS(SELECT 1 FROM rental_contract c WHERE c.service_task_id=t.task_id
    AND c.status='已确认') AS paid FROM service_task t WHERE t.task_type='现场接待'
    AND t.status IN ('办理中','待合同确认') AND t.current_stage IN ('试装中','待复核')`);
  for(const task of tasks) {
    const stage=task.paid?'待取件':task.status==='待合同确认'?'合同确认':'装备适配';
    await db.batch([
      db.q(`UPDATE service_task SET current_stage=CASE WHEN current_stage=? AND status=? THEN ? ELSE NULL END WHERE task_id=?`,task.current_stage,task.status,stage,task.task_id),
      ...audit(db,null,'接待环节回退',task.current_stage,stage,[['service_task',task.task_id]],'保留原队号及办理记录',task.store_id)
    ]);
  }
}
