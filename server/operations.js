import { activeStore, day, now, positiveId, snapshot, textField } from './data.js';
import { businessPeriod } from './business-period.js';
import { demo } from './demo-config.js';
import { readOperations } from './operations-repository.js';
import { paymentHoldUntil } from './payment.js';
import {rentalTotals,waitingStatistics} from './period-statistics.js';

export async function operations(db,body) {
  const cutoff=now();
  const period=businessPeriod(body,cutoff);
  const {from,to}=period;
  const store=body.storeId?await activeStore(db,body.storeId):null;
  const auditFilter={
    key:textField(body.auditKey,'审计查询关键词',80,true)?.toLowerCase()??null,
    page:body.auditPage==null?1:positiveId(body.auditPage,'审计页码')
  };
  const {dataSets,queries}=await readOperations(db,store,period,cutoff,auditFilter);
  const missing = dataSets.filter((_,index)=>queries[index].status==='rejected');
  const [allTasks,allContracts,allUnits,allRepairs,payments,metrics,audit,compatibility,reservations,periodUtilization,stores,deliveredRows] =
    queries.map(query=>query.status==='fulfilled'?query.value:[]);
  const tasks=allTasks.filter(t=>!store || t.store_id===store).map(t=>['试装中','待复核'].includes(t.current_stage)?
    {...t,current_stage:allContracts.some(c=>c.service_task_id===t.task_id&&c.status==='已确认')?'待取件':t.status==='待合同确认'?'合同确认':'装备适配'}:t);
  const contracts=allContracts.filter(c=>!store || c.pickup_store_id===store || c.return_store_id===store);
  const units=allUnits.filter(e=>!store || e.current_store_id===store);
  const repairs=allRepairs.filter(r=>!store || r.responsible_store_id===store);
  const available = index => queries[index].status==='fulfilled';
  const compat = new Set(compatibility.map(i=>i.entity_id));
  const openTasks = tasks.filter(t=>['排队中','办理中','待合同确认'].includes(t.status));
  const pendingReservations = reservations.filter(r=>['待接待','待支付','已预订'].includes(r.status) && r.requested_end_at>cutoff);
  const stages = ['等待接待','装备适配','合同确认'].map(label=>({label,count:openTasks.filter(t=>t.current_stage===label).length}));
  const inPeriod = value=>value && value>=from && value<=to;
  const periodTasks = tasks.filter(t=>inPeriod(t.started_at));
  const delivered = periodTasks.filter(t=>t.delivered_at);
  const queueCancellations = tasks.filter(t=>t.status==='已取消' && t.assigned_user_id==null && inPeriod(t.finished_at));
  const periodReservations = reservations.filter(r=>inPeriod(r.appointment_at||r.requested_start_at));
  const periodContracts = contracts.filter(c=>c.end_at>=from && c.start_at<=to);
  const periodRepairs = repairs.filter(r=>r.opened_at<=to && (!r.completed_at || r.completed_at>=from));
  const elapsed = (a,b) => (Date.parse(b)-Date.parse(a))/60000;
  const average = rows => rows.length?Math.round(rows.reduce((a,b)=>a+b,0)/rows.length*10)/10:null;
  const repairCycleMinutes = average(periodRepairs.filter(r=>inPeriod(r.completed_at))
    .map(r=>elapsed(r.opened_at,r.completed_at)));
  const averageWait = (rows,until) => average(rows.filter(t=>t.arrived_at && t[until]>=t.arrived_at)
    .map(t=>elapsed(t.arrived_at,t[until])));
  const overdue = contracts.filter(c=>['租出','处理异常'].includes(c.status) && c.end_at<cutoff);
  const open = repairs.filter(r=>!r.completed_at);
  const todos = [];
  const add = (type,key,store,status,at,limit,link,recordId,detail) => {
    const deadline=type==='检查'?null:new Date(Date.parse(at)+limit*60000).toISOString();
    const overdueMinutes=deadline?Math.max(0,Math.floor(elapsed(deadline,cutoff))):null;
    todos.push({type,key,store,status,at,deadline,overdueMinutes,
      reason:type==='检查'?'安全核验未完成，完成检查前不可出租':
        deadline<=cutoff?'已超过规定处理时间':'尚未超过规定处理时间',
      priority:type==='检查'||deadline<=cutoff?'高':'普通',link,recordId,detail});
  };
  for (const r of pendingReservations)
    add('预约',r.reservation_no+' · '+r.name,r.store_name,r.status,r.appointment_at||r.requested_start_at,demo.alertMinutes.reception,
      'reception',null,{source:r.source_type,start:r.requested_start_at,end:r.requested_end_at});
  for (const t of openTasks)
    add('接待',t.name+' · '+t.queue_no+' 号',t.store_name,t.status,t.arrived_at||t.started_at,demo.alertMinutes.reception,
      'reception',null,{stage:t.current_stage,started:t.assigned_user_id?t.started_at:null});
  for (const c of contracts.filter(c=>c.status==='处理异常' || overdue.includes(c)))
    add('归还',c.contract_no,c.store_name,c.status==='处理异常'?'装备缺失':'逾期未归还',c.end_at,0,'returns',c.contract_id);
  for (const c of contracts.filter(c=>['已确认','待支付'].includes(c.status) && c.end_at<cutoff))
    add('取件',c.contract_no,c.store_name,c.status==='待支付'?'支付未完成，取件超时':'取件超时',c.end_at,0,'contracts',c.contract_id);
  const contractsById=new Map(contracts.map(c=>[c.contract_id,c]));
  for (const p of payments) {
    const c=contractsById.get(p.contract_id);
    const pending=c?snapshot(c).pending:null;
    const exchangeHold=pending?.type==='换装' && pending.requestNo===p.request_no;
    const expired=(p.request_type==='收费'||exchangeHold) && (paymentHoldUntil(p.created_at)<=cutoff || exchangeHold && c.end_at<=cutoff);
    const status=expired?'锁定到期，门店待处理':p.status==='失败'?'失败，待重试':p.status;
    add('支付',p.request_no,p.store_name,p.request_type+' · '+status,p.created_at,demo.alertMinutes.payment,'contracts',p.contract_id);
  }
  for (const r of open) {
    const estimated = r.status==='维修中' ? r.estimated_completion_at : null;
    const status = estimated && estimated<=cutoff ? '维修中 · 已超过预计时间' : r.status;
    add('维修',r.ticket_no,r.store_name,status,estimated||r.opened_at,
      estimated?0:demo.alertMinutes.repair,'tracking',r.repair_order_id);
  }
  const needsInspection=e=>!e.open_ticket && !e.retired_at &&
    (e.status==='待检查' || (e.status==='可租' && (e.inspection_result!=='合格' || e.valid_until<day(cutoff) || compat.has(e.equipment_id))));
  for (const e of units.filter(needsInspection))
    add('检查',e.asset_no,e.store_name,compat.has(e.equipment_id)?'部件兼容检查':'安全检查待办',
      cutoff,0,'repair',null,{model:e.model_name,inspection:e.inspection_result,validUntil:e.valid_until});
  const current = units.filter(u=>!u.retired_at);
  const waitingNow = openTasks.filter(t=>t.status==='排队中')
    .map(t=>Math.max(0,elapsed(t.arrived_at||t.started_at,cutoff)));
  const waitSample = periodTasks.filter(t=>t.assigned_user_id!=null && t.arrived_at && t.started_at>=t.arrived_at);
  const rentalSummary=rentalTotals(deliveredRows);
  const queueSummary=waitingStatistics(tasks,from,to,cutoff);
  const processingPayments = contracts.filter(c=>c.status==='待支付');
  const pickupPending = contracts.filter(c=>c.status==='已确认');
  const returnsToday = contracts.filter(c=>c.status==='租出' && day(c.end_at)===day(cutoff));
  const utilization = current.length ? Math.round(current.filter(e=>e.status==='租出').length/current.length*1000)/10 : null;
  return {
    cutoff,missing,stages:available(0)?stages:[],todos:todos.sort((a,b)=>Number(b.type==='检查')-Number(a.type==='检查') ||
      Number(b.priority==='高')-Number(a.priority==='高') || a.at.localeCompare(b.at)),
    stores:available(10)?stores.map(s=>{
      const equipment=allUnits.filter(e=>e.current_store_id===s.store_id && !e.retired_at);
      return {...s,waiting:available(0)?allTasks.filter(t=>t.store_id===s.store_id && t.status==='排队中').length:null,
        inspections:available(2)&&available(7)?equipment.filter(needsInspection).length:null,
        overdue:available(1)?allContracts.filter(c=>(c.pickup_store_id===s.store_id || c.return_store_id===s.store_id) &&
          ['租出','处理异常'].includes(c.status) && c.end_at<cutoff).length:null,
        repairs:available(3)?allRepairs.filter(r=>r.responsible_store_id===s.store_id && !r.completed_at).length:null,
        utilization:available(2)&&equipment.length?Math.round(equipment.filter(e=>e.status==='租出').length/equipment.length*1000)/10:null};
    }):[],
    events:audit.rows??[],auditPagination:available(6)?{total:audit.total,page:audit.page,pages:audit.pages}:null,
    hasData:!!(deliveredRows.length||periodTasks.length||queueCancellations.length||periodReservations.length||periodContracts.length||periodRepairs.length||metrics.length||available(9)&&periodUtilization!==null),
    summary:{
      rentalCount:available(11)?rentalSummary.count:null,
      rentalRent:available(11)?rentalSummary.rent:null,
      missingRent:available(11)?rentalSummary.missingRent:null,
      queueWaiting:available(0)?queueSummary:null,
      utilization:available(9)?periodUtilization:null,
      reservations:available(8)?periodReservations.length:null,
      repairsOpened:available(3)?periodRepairs.filter(r=>inPeriod(r.opened_at)).length:null,
      repairsClosed:available(3)?periodRepairs.filter(r=>inPeriod(r.completed_at)).length:null,
      waiting:averageWait(waitSample,'started_at'),
      waitingSamples:available(0)?waitSample.length:null,
      cancelledWaiting:averageWait(queueCancellations,'finished_at'),
      handling:average(delivered.map(t=>elapsed(t.started_at,t.delivered_at))),
      delivery:average(delivered.map(t=>elapsed(t.started_at,t.delivered_at))),
      deliverySamples:available(0)?delivered.length:null,
      repairCycle:repairCycleMinutes===null?null:repairCycleMinutes/60,
      crossStore:available(5)?metrics.filter(m=>m.metric_code==='cross_store_returns').reduce((n,m)=>n+m.metric_value,0):null
    },
    current:{
      waiting:available(0)?waitingNow.length:null,
      pendingReservations:available(8)?pendingReservations.length:null,
      longestWait:available(0)&&waitingNow.length?Math.floor(Math.max(...waitingNow)):null,
      awaitingPayment:available(1)?processingPayments.length:null,
      awaitingPickup:available(1)?pickupPending.length:null,
      returnsToday:available(1)?returnsToday.length:null,
      utilization:available(2)?utilization:null,overdue:available(1)?overdue.length:null,repairs:available(3)?open.length:null,
      paymentTodo:available(4)?payments.length:null
    }
  };
}
