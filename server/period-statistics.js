import {day} from './data.js';

export async function deliveredRentals(db,store,from,to,cutoff) {
  return db.all(`WITH deliveries AS (
    SELECT x.entity_id AS contract_id,min(a.occurred_at) AS delivered_at
    FROM audit_event a JOIN audit_event_target x USING(audit_event_id)
    WHERE a.event_type='装备交付' AND x.entity_type='rental_contract'
    GROUP BY x.entity_id
  ) SELECT c.contract_id,c.contract_no,c.pickup_store_id,d.delivered_at,
      json_extract(c.price_snapshot,'$.rent') AS rent
    FROM deliveries d JOIN rental_contract c USING(contract_id)
    WHERE d.delivered_at BETWEEN ? AND ? AND d.delivered_at<=?
      AND c.status<>'已取消' AND (? IS NULL OR c.pickup_store_id=?)
      AND EXISTS(SELECT 1 FROM payment_request p WHERE p.contract_id=c.contract_id
        AND p.request_type='收费' AND p.status='成功')`,from,to,cutoff,store,store);
}

export function rentalTotals(rows) {
  const missing=rows.filter(r=>r.rent==null || !Number.isFinite(Number(r.rent)) || Number(r.rent)<0);
  return {count:rows.length,rent:missing.length?null:
    Math.round(rows.reduce((n,r)=>n+Number(r.rent),0)*100)/100,missingRent:missing.length};
}

export function waitingStatistics(tasks,from,to,cutoff) {
  const samples=tasks.filter(t=>t.task_type==='现场接待' && t.assigned_user_id!=null &&
    t.started_at>=from && t.started_at<=to && t.started_at<=cutoff);
  const review=[],minutes=[];
  for(const task of samples) {
    const start=Date.parse(task.started_at),arrival=Date.parse(task.arrived_at);
    const elapsed=(start-arrival)/60000;
    const issue=!Number.isFinite(arrival)||!Number.isFinite(start)?'到店或开始时间缺失':
      elapsed<0?'开始时间早于到店':day(task.started_at)!==day(task.arrived_at)?'到店与开始办理跨日':null;
    if(Number.isFinite(elapsed)&&elapsed>=0)minutes.push(elapsed);
    if(issue)review.push({taskId:task.task_id,customer:task.name,store:task.store_name,
      arrivedAt:task.arrived_at,startedAt:task.started_at,minutes:Number.isFinite(elapsed)&&elapsed>=0?elapsed:null,reason:issue});
  }
  const observed=minutes.length?Math.round(minutes.reduce((n,v)=>n+v,0)/minutes.length*10)/10:null;
  return {average:review.length?null:observed,observedAverage:observed,samples:samples.length,
    review,over20:minutes.filter(v=>v>20).length};
}
