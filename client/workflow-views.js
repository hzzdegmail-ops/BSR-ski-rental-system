function contractRows(rows, action) {
  return table(['合同号 / 顾客','取件门店','计划结束','状态','应付','操作'],rows.map(c=>[
    cell(c.contract_no,c.customer_name),h(c.pickup_name),h(date(c.end_at)),pill(c.status),money(c.amount_due),
    button('查看',action,c.contract_id,'tiny')
  ]),'暂无租赁合同');
}
function contractListPanel(isReturn=false) {
  const listing=state.contractListing||{rows:[],page:1,hasMore:false};
  const filter=state.contractFilters?.[state.page]||{};
  const controls=form('contract-list',
    (isReturn?'':select('范围','scope',[['active','待处理及在租'],['history','已结束合同']],filter.scope||'active'))+
    input('合同号或顾客姓名','key',filter.key||'','search','maxlength="80"')+fieldButton('筛选',true),'inline');
  const page=listing.page;
  const pager=actions((page>1?button('上一页','contract-page',page-1,'tiny'):'')+
    `<small>第 ${page} 页</small>`+(listing.hasMore?button('下一页','contract-page',page+1,'tiny'):''));
  return panel(isReturn?'在租与待处理合同':'租赁合同',body(controls)+
    contractRows(listing.rows,isReturn?'open-return':'open-contract')+body(pager),button('刷新','refresh','','tiny'),'no-print');
}
function contractsView() {
  const draft=state.quote;
  const d=state.contract;
  const quotePanel=draft?panel('合同摘要 · 确认前核对',body(form('confirm',
    details([['顾客',h(draft.task.name)],['取件门店',h(storeName(draft.price.pickup))],['约定归还',h(storeName(draft.price.agreedReturnStore))],
      ['开始',h(date(draft.range.start))],['结束',h(date(draft.range.end))],['确认后状态',pill('待支付 → 已确认 / 装备已预留')]])+
    receiptPrice(draft.price)+(draft.price.advanceBooking?info('提前预订尚未登记到店。模拟付款成功后按租期预留装备，到店仍按实际顺序办理。'):'')+
    (draft.price.fitReview?info(draft.price.fitReview.pending?draft.price.fitReview.note:'临近尺寸已完成试穿核对：'+draft.price.fitReview.note):'')+
    info('课程演示使用模拟支付，不会实际扣款或退款。')+`<div class="actions">${check('confirm','顾客已确认合同、费用及换装归还规则')}</div>`+
    `<div class="inline section-label">${scenario()}${fieldButton('确认合同并收费',true)}</div>`
  )),'','no-print'):'';
  return quotePanel+(d?contractDocument(d,true):'')+
    contractListPanel();
}
function contractDocument(d,forContract=false) {
  const c=d.contract;
  const p=d.price;
  const paymentsToResolve=d.payments.filter(r=>['待支付','处理中'].includes(r.status)||
    (r.request_type!=='收费'&&r.status==='失败'&&
      (p.pending?.requestNo===r.request_no||p.adjustments?.some(a=>a.requestNo===r.request_no&&!a.cancelled))));
  const settlement=paymentsToResolve.map(r=>r.request_type+'待处理 · '+money(r.amount)).join('；');
  const rows=table(['装备','尺寸规格','位置','明细状态','实际结束'],d.items.map(i=>[
    cell(i.asset_no,[i.brand,i.model_name].filter(Boolean).join(' ')),h(i.size_spec),h(i.store_name),pill(i.item_status),h(date(i.rented_to))
  ]),'暂无装备明细');
  const atPickup=forContract&&c.pickup_store_id===state.user.store_id;
  const atBooking=forContract&&c.task_store_id===state.user.store_id;
  const now=new Date();
  const expired=new Date(c.end_at)<=now;
  const early=new Date(c.start_at)>now;
  const payRows=table(['支付请求号','类型','金额','支付状态','模拟凭证','操作'],d.payments.map(r=>{
    const pending=paymentsToResolve.includes(r);
    const canRetry=r.request_type==='收费'?
      (c.pickup_store_id===state.user.store_id||c.task_store_id===state.user.store_id)&&!expired&&(!d.holdUntil||new Date(d.holdUntil)>now):
      Number(p.adjustments?.find(a=>a.requestNo===r.request_no)?.store??
        (p.pending?.requestNo===r.request_no?p.pending.store:null))===state.user.store_id;
    return [
      cell(r.request_no,r.attempt_no?'尝试 '+r.attempt_no+' 次':''),h(r.request_type),money(r.amount),
      pill(r.status),h(r.provider_transaction_no||r.response_code||'—'),
      pending&&canRetry?button('模拟重试','retry',r.request_no,'tiny'):'—'
    ];
  }),'暂无支付请求');
  const pickup=atPickup&&!expired&&!p.pending&&c.status==='已确认'?(p.advanceBooking&&(c.task_type!=='现场接待'||c.task_status!=='办理中')?
    info('请先在接待管理确认顾客实际到店，并从现场队列开始核对取件。')+actions(button('前往到店办理','booking-reception')):early?
    info('请在 '+date(c.start_at)+' 起办理取件。需要提前领取时，请取消后按新租期重办。'):
    form('pickup',info('付款已完成。核对实物和安全后确认取件；取件后可试装，不合适可按原合同办理换装。')+
      (p.fitReview?.pending?`<div class="fit-review">${info('预订的是临近尺寸，必须到店试穿核对。若不合适，可取消未取件合同并重新选装。')}${check('fitConfirmed','已现场试穿，确认适配')}${input('试穿核对说明','fitNote','','text','required maxlength="255"')}</div>`:'')+
      actions(check('confirm','已核对顾客尺寸、技能、接口及实际交付装备')+fieldButton('确认取件',true)),'no-print')):'';
  const paid=d.payments.find(r=>r.request_type==='收费'&&r.status==='成功');
  const canCancel=(atPickup||atBooking&&c.status==='待支付'&&!expired)&&['待支付','已确认'].includes(c.status)&&!p.pending;
  const cancel=canCancel?form('cancel-uncollected',
    info('取消未取件合同后释放装备。'+(paid?'本次模拟退款 '+money(paid.amount)+'。':''),true)+
    check('confirm','已核对取件记录、装备与模拟支付金额')+
    `<div class="inline section-label">${paid?scenario():''}${fieldButton(expired?'处理未取件超时合同':'取消未取件合同',true)}</div>`,'no-print'):'';
  const adjustments=(p.adjustments||[]).map(a=>[
    h(a.type),h(date(a.at)),h(delta(a.amount)),
    h(a.cancelled?a.reason:a.type==='未取件取消'?'取消合同并释放装备':a.type==='换装'?(a.from+' → '+a.to+' · '+a.reason):[
      a.crossStore?'跨店归还':'门店归还',
      a.missing?.length?'缺失 '+a.missing.join('、'):'',
      ...(a.details||[]).map(i=>i.asset_no+' '+i.condition+' / 押金 '+money(i.deposit)+' / 损坏 '+money(i.damage)+' / 逾期 '+money(i.overdue))
    ].filter(Boolean).join(' · '))
  ]);
  const isolated=d.items.filter(i=>i.equipment_status==='待检查' && i.current_store_id===state.user.store_id &&
    ['已归还','已换出'].includes(i.item_status));
  return panel('电子合同 '+c.contract_no,body(`<div class="stack">
    ${details([['顾客',h(c.customer_name)],['合同状态',pill(c.status)],['取件门店',h(c.pickup_name)],
      ['租赁开始',h(date(c.start_at))],['计划结束',h(date(c.end_at))],['约定归还',h(storeName(p.agreedReturnStore))],
      ['实际归还',h(c.return_name||'—')],['模拟支付待办',settlement?pill(settlement):'无待处理款项']])}
    ${p.advanceBooking?'<h3>预订适配资料 · 到店核对</h3>'+details([['身高',h(p.fit.height_cm+' cm')],['体重',h(p.fit.weight_kg+' kg')],['实测脚长',h(p.fit.foot_length_mm+' mm')],['日常鞋码（参考）',h(p.fit.shoe_size||'未填写')],['技能水平',h(p.fit.skill_level)],['固定器与雪靴接口',h(p.system)]]):''}
    <h3>合同价格明细</h3>${receiptPrice(p)}
    <h3>装备明细</h3>${rows}<h3>模拟支付与凭证</h3><div class="receipt-payment">${payRows}</div>
    ${p.fitReview?`<h3>${p.fitReview.pending?'临近尺寸待到店试穿':'临近尺寸试穿记录'}</h3>${info(p.fitReview.note)}${p.fitReview.pending?'':details([['核对时间',h(date(p.fitReview.confirmedAt))],['核对员工编号',h(p.fitReview.confirmedBy)]])}`:''}
    ${d.holdUntil?info('模拟支付保留至 '+date(d.holdUntil)+'。到期后重新查询会释放临时锁定的装备。',true):''}
    ${adjustments.length?'<h3>换装与归还结果</h3>'+table(['业务','时间','费用调整','处理详情'],adjustments):''}
    ${isolated.length?`<div class="no-print">${actions(isolated.map(i=>button('登记维修 · '+i.asset_no,'repair-returned',i.equipment_id,'tiny')).join(''))}</div>`:''}
    ${p.pending?info('该合同有待处理的费用调整。请使用原请求号查询或重试。',true):''}
    ${pickup}${cancel}${forContract&&['租出','处理异常'].includes(c.status)?info('可在取件后试装。不合适时按原合同换装，系统计算价差；无需重新登记接待。')+actions(button('试装不合适，办理换装','start-exchange',c.contract_id,'primary')):''}</div>`),
    `<span class="no-print">${button('打印凭证','print','','tiny')}</span>`,'contract-receipt');
}
function returnsView() {
  const d=state.returnContract;
  const search=panel('查找合同',body(form('find-contract',
    input('合同号或装备编号','key',state.returnKey||'','search','required placeholder="输入合同单号或资产编号"')+fieldButton('查询',true),'inline')));
  const active=(d?.items||[]).filter(i=>i.item_status==='租出');
  const canWork=d && ['租出','处理异常'].includes(d.contract.status) && active.length && !d.price.pending;
  return search+(d?contractDocument(d):'')+(canWork?returnWork(active):'')+
    contractListPanel(true);
}
function returnWork(items) {
  const mode=state.returnMode||'return';
  const toolbar=button('办理归还','return-mode','return',mode==='return'?'primary':'')+
    button('办理换装','return-mode','exchange',mode==='exchange'?'primary':'');
  const id=state.returnContract.contract.contract_id;
  const returnDraft=findDraft('preview-return',id);
  const exchangeDraft=findDraft('exchange-choices',id);
  const rs=state.returnSelection;
  const received=returnDraft?.received??rs?.equipmentIds;
  const fields=items.map(i=>`<div class="item"><label class="check"><input type="checkbox" name="received" value="${i.equipment_id}"
    ${(!received||received.includes(String(i.equipment_id)))?'checked':''}>${h(i.asset_no+' · '+i.model_name)}</label><div class="grid">
    ${select('检查结果','condition_'+i.equipment_id,conditions,returnDraft?.fields['condition_'+i.equipment_id]??rs?.inspections[i.equipment_id]?.condition,'请选择检查结果')}
    ${input('损坏费用（元）','fee_'+i.equipment_id,returnDraft?.fields['fee_'+i.equipment_id]??rs?.inspections[i.equipment_id]?.fee??0,'number','min="0" max="100000" step="0.01"')}</div></div>`).join('');
  const p=state.returnPreview;
  const returning=form('preview-return',draftNote(returnDraft)+storeSelect('storeId','实际归还门店',state.user.store_id,state.stores.filter(s=>s.store_id===state.user.store_id))+
    `<h3>勾选实际收到的装备</h3><div class="items">${fields}</div>${fieldButton('核对归还与费用',true)}`,'stack')+
    (p?`<div class="section-label stack" data-review="return">${info((p.crossStore?'跨店归还 · ':p.changedReturnStore?'变更约定归还门店 · ':'')+delta(p.delta)+
      (p.missing.length?' · 缺失 '+p.missing.join('、')+'，合同进入处理异常':' · 合同进入已归还')+'。',!!p.missing.length)}
      ${table(['装备','检查结果','押金','逾期','损坏'],p.inspections.map(i=>[
        h(i.asset_no),h(i.condition),money(i.deposit),money(i.overdue),money(i.damage)
      ]))}
      ${form('return',check('confirm','已核对归还装备、检查和费用')+
        `<div class="inline section-label">${p.delta?scenario():''}${fieldButton('确认归还',true)}</div>`)}</div>`:'');
  const ex=exchangeDraft?.fields??state.exchangeSearch;
  const fit=exchangeDraft?.fields??ex?.fit??state.returnContract.price.fit??{};
  const exchange=form('exchange-choices',draftNote(exchangeDraft)+`<div class="grid">
    ${select('原装备','oldId',items.map(i=>[i.equipment_id,i.asset_no+' · '+i.model_name]),ex?.oldId)}
    ${select('换装原因','reasonType',['尺码不合适','装备故障','偏好调整','其他'],ex?.reasonType)}
    ${input('换装说明（选填）','reason',ex?.reason||'','text','maxlength="255"')}
    <label class="field"><span>旧装备检查结果</span>
    <select name="condition" aria-label="旧装备检查结果" required>${options(conditions,ex?.condition,'请选择检查结果')}</select></label></div>
    <details><summary>核对或调整顾客适配资料</summary><div class="grid three section-label">
    ${input('身高（cm）','height_cm',fit.height_cm,'number','required step="0.01"')}
    ${input('体重（kg）','weight_kg',fit.weight_kg,'number','required step="0.01"')}
    ${input('实测脚长（mm）','foot_length_mm',fit.foot_length_mm,'number','required min="140" max="340"')}
    ${input('日常鞋码（EU，选填参考）','shoe_size',fit.shoe_size,'number','step="0.1" min="22" max="55"')}
    ${select('技能水平','skill_level',['初级','中级','高级'],fit.skill_level)}
    ${input('装备偏好（选填）','equipment_preference',fit.equipment_preference||'')}</div></details>
    ${actions(fieldButton('查询替换装备',true))}`,'stack')+
    (state.exchangeCandidates?form('exchange',
      table(['选择','替换装备','适配和安全','剩余租期价差'],state.exchangeCandidates.map(i=>[
        `<input type="radio" name="newId" value="${i.equipment_id}" required aria-label="选择 ${h(i.asset_no)}">`,
        cell(i.asset_no,i.model+' · '+i.size),cell(i.reason,'检查有效至 '+i.valid_until),h(delta(i.delta))
      ]),'本店没有可替换装备。可到另一家门店查询，或办理归还。')+
      (state.exchangeCandidates.length?`<div class="section-label stack">
        ${info('换装完成后，旧装备释放或隔离，新装备进入原合同。')}
        ${check('confirm','已核对替换装备、状态和价差')}
        <div class="inline">${scenario()}${fieldButton('确认换装',true)}</div></div>`:'')
    ):'');
  return panel(mode==='return'?'归还核对':'换装核对',body(actions(toolbar)+`<div class="section-label">${mode==='return'?returning:exchange}</div>`));
}
function repairView() {
  const {filter='',store='',status=''}=state.assetFilter||{};
  const selected=state.inventory?.find(e=>e.equipment_id===state.equipmentId);
  const all=state.inventory||[];
  const query=form('asset-filter',input('装备编号、型号或状态','filter',filter,'search','placeholder="搜索装备"')+
    select('门店','store',[['','全部门店'],...state.stores.map(s=>[s.store_id,s.name])],store)+
    select('状态','status',[['','全部状态'],...new Set(all.map(e=>e.status)),['检查不可出租','检查不可出租']],status)+
    fieldButton('筛选',true),'inline');
  const inventory=all.filter(e=>(!store||e.current_store_id===Number(store))&&
    (!status||(status==='检查不可出租'?!!inspectionIssue(e):e.status===status))&&
    [e.asset_no,e.legacy_asset_no||'',e.model_name,e.status,e.store_name,e.category_name].some(v=>v.toLowerCase().includes(filter.toLowerCase())));
  const pageSize=12;
  const pages=Math.max(1,Math.ceil(inventory.length/pageSize));
  const page=Math.min(state.assetPage||1,pages);
  const visible=inventory.slice((page-1)*pageSize,page*pageSize);
  const rows=table(['装备','所在门店','状态','操作'],visible.map(e=>[
    cell(e.asset_no,e.category_name+' · '+e.size_spec),h(e.store_name),equipmentStatus(e),button('查看','asset',e.equipment_id,'tiny')
  ]),'没有符合条件的装备');
  let right=panel('装备详情',empty('从列表选择装备，查看检查状态和维修工单。'));
  if (selected) {
    const e=selected;
    const repairDraft=findDraft('repair-submit',e.equipment_id);
    const inspectionDraft=findDraft('inspect-asset',e.equipment_id);
    const repair=repairDraft?.fields;
    const inspection=inspectionDraft?.fields;
    const canRepair=e.current_store_id===state.user.store_id&&!e.open_ticket&&!['租出','已预留','临时锁定','退役','调拨中'].includes(e.status);
    const canInspect=canRepair&&['可租','待检查'].includes(e.status);
    const part=e.open_ticket?info('已有未关闭工单 '+e.open_ticket)+actions(button('查看已有工单','existing-repair',e.open_repair_id,'primary')):
      canRepair?form('repair-submit',draftNote(repairDraft)+
        `<div class="grid">${storeSelect('storeId','责任门店',e.current_store_id,state.stores.filter(s=>s.store_id===e.current_store_id))}
        ${select('严重程度','severity',['低','中','高'],repair?.severity??'中')}${contractorSelect(repair?.contractorId??state.contractors[0]?.contractor_id)}${area('故障现象','fault','描述问题及现场检查结果',repair?.fault)}</div>`+
        info('提交后装备进入「维修中、不可租」，工单进入待接收或待分配。')+
        check('confirm','已核对故障装备与责任门店')+fieldButton('提交维修工单',true),'stack'):
      info('请在装备当前门店办理。已占用或已退役的装备无法直接送修。',true);
    const inspect=canInspect?`<details${inspection?' open':''}><summary>记录装备安全检查</summary>${form('inspect-asset',
      draftNote(inspectionDraft)+select('检查结果','result',['合格','不合格'],inspection?.result??'','请选择检查结果')+area('检查说明','note','',inspection?.note)+
      info('合格时更新有效期并恢复可租，不合格时隔离为待检查。')+
      check('confirm','已核对检查结果')+fieldButton('保存检查'),'stack')}</details>`:'';
    right=panel(e.asset_no,body(`<div class="stack">${details([
      ['型号',h(e.brand+' '+e.model_name+' · '+e.size_spec)],['装备状态',equipmentStatus(e)],['当前门店',h(e.store_name)],
      ['最近检查',h(e.inspection_result||'暂无')],['检查有效期',h(e.valid_until||'—')]
    ])}${part}${inspect}</div>`));
  }
  const pager=pages>1?body(historyPager({page,pages,total:inventory.length},'asset-page')):'';
  return `<div class="split repair-split">${panel('单件装备',body(query)+rows+pager,`<small>${inventory.length} 件</small>`,'asset-list')}${right}</div>`;
}
function inspectionIssue(e) {
  if (!['可租','待检查'].includes(e.status)) return '';
  if (e.inspection_result!=='合格'||!e.valid_until) return '检查未通过或缺失';
  return e.valid_until<localDay(0)?'安全检查已过期':'';
}
function equipmentStatus(e) {
  const issue=inspectionIssue(e);
  return issue?pill('暂不可出租')+`<small class="cell-sub">${h(issue)}</small>`:pill(e.status);
}
function trackingView() {
  const listing=state.repairListing;
  const search=form('repair-list',input('工单号或装备编号','key',state.repairFilter?.key||'','search','maxlength="80"')+
    select('工单状态','status',[['','全部状态'],...['待分配','待接收','维修中','待验收','待确认退役','已关闭','已退役']],state.repairFilter?.status||'')+
    select('责任门店','storeId',[['','全部门店'],...state.stores.map(s=>[s.store_id,s.name])],state.repairFilter?.storeId||'')+
    fieldButton('筛选',true),'inline');
  const rows=table(['工单 / 装备','责任门店','状态','预计完成','操作'],listing.rows.map(o=>[
    cell(o.ticket_no,o.asset_no),h(o.store_name),pill(o.status),h(date(o.estimated_completion_at)),button('查看','open-repair',o.repair_order_id,'tiny')
  ]),'暂无当前角色可查看的工单');
  return `<div class="split repair-split">${panel('维修工单',body(search)+rows+body(historyPager(listing,'repair-page')),button('刷新','refresh','','tiny'))}
    ${state.repairDetail?repairDocument(state.repairDetail):panel('工单进度',empty('请选择一张工单。'))}</div>`;
}
function repairDocument(detail) {
  const {order:o,updates}=detail;
  const isStaff=state.user.role_type==='staff';
  const responsible=isStaff&&state.user.store_id===o.responsible_store_id;
  const history=updates.length?`<ol class="timeline">${updates.map(u=>`<li>
    <strong>${h(u.progress_status)}</strong><span class="cell-sub">${h(date(u.created_at)+' · '+u.display_name)}</span><p>${h(u.note)}</p>
  </li>`).join('')}</ol>`:empty('暂无进度记录');
  const assign=responsible&&o.status==='待分配'?form('repair-assign',
    contractorSelect('')+info('分配后工单进入「待接收」。')+fieldButton('确认分配',true),'stack'):'';
  const update=state.user.role_type==='contractor'&&['待接收','维修中'].includes(o.status)?form('repair-update',
    select('维修结果','status',[['维修中','继续维修'],['待验收','完工，待验收'],['待确认退役','无法修复，建议退役']],'维修中')+
    input(o.estimated_completion_at?'调整预计完成时间（选填）':'接单或继续维修的预计完成时间',
      'estimatedCompletionAt','','datetime-local')+
    area('处理说明及维修结果','note')+info('接单或继续维修须有预计完成时间。完工后由责任门店验收。')+
    check('confirm','已核对将提交的维修进度')+fieldButton('保存维修进度',true),'stack'):'';
  const inspect=responsible&&['待验收','待确认退役'].includes(o.status)?form('repair-inspect',
    select(o.status==='待验收'?'安全验收':'退役确认','result',o.status==='待验收'?['合格','不合格']:['确认退役','退回维修'],'','请选择结果')+
    area('验收说明','note')+info('检查合格后关闭工单、装备恢复可租。不合格则退回维修。确认退役后装备不可租。')+
    check('confirm','已核对验收或退役结果')+fieldButton('提交验收结果',true),'stack'):'';
  return panel(o.ticket_no,body(`<div class="stack">${details([
    ['装备',h(o.asset_no)],['工单状态',pill(o.status)],['装备状态',pill(o.equipment_status)],
    ['责任门店',h(o.store_name)],['维修承包商',h(o.contractor_name||'待分配')],['建立时间',h(date(o.opened_at))],
    ['严重程度',h(o.severity||'未记录')],['预计完成',h(date(o.estimated_completion_at))]
  ])}<h3>故障现象</h3><p>${h(o.fault_description)}</p><h3>进度记录</h3>${history}${assign}${update}${inspect}</div>`));
}
function filterOperationsTodos(todos,type=state.todoType||'all') {
  return todos.filter(t=>type==='all'||t.type===type);
}
function operationsDuration(minutes) {
  if (minutes==null) return '—';
  if (minutes<1) return '少于1分钟';
  if (minutes>=1440) return Number((minutes/1440).toFixed(1))+' 天';
  if (minutes>=60) return Number((minutes/60).toFixed(1))+' 小时';
  return Number(minutes.toFixed(1))+' 分钟';
}
function operationsView() {
  const data=state.operating;
  const filters=state.scope||{};
  if (!data) return empty('经营数据暂不可用，请刷新重试');
  const tab=state.operationsTab||'current';
  const storeControl=form('operations-store',select('门店范围','storeId',
    [['','全部门店'],...state.stores.map(s=>[s.store_id,s.name])],filters.storeId||'')+
    fieldButton('应用')+button('刷新','operations-refresh'),'operations-store');
  const controls=form('operations',`<div class="operations-filters">
    ${input('开始日期','from',filters.from||localDay(-30),'date','required')}
    ${input('结束日期','to',filters.to||localDay(0),'date','required')}
    ${fieldButton('查询',true)}
  </div>`);
  const s=data.summary;
  const current=data.current;
  const metric=(name,value,unit='',note='')=>`<div class="metric"><small>${h(name)}</small><strong>${value==null?'—':h(value)}${value==null?'':`<span>${h(unit)}</span>`}</strong>${note?`<p>${h(note)}</p>`:''}</div>`;
  const duration=(name,minutes,note='')=>metric(name,operationsDuration(minutes),'',note);
  const wait=s.queueWaiting;
  const metricCards=[
    metric('已交付租赁单数',s.rentalCount,' 单','按实际交付日期及取件门店统计'),
    metric('租金金额',s.rentalRent==null?null:money(s.rentalRent),'',s.missingRent?'部分合同租金缺失，待核对':'已交付合同约定租金 · 不含押金'),
    metric('装备利用率',s.utilization,'%', '租出时长 / 同期在册时长'),
    wait?.review.length?metric('平均排队等待','待核对','',`${wait.samples} 条记录中有 ${wait.review.length} 条时间待核对`):
      duration('平均排队等待',wait?.average??null,`已开始接待 ${wait?.samples??'—'} 人`)
  ].join('');
  const waitingReview=wait?.review.length?`<details class="operations-disclosure operations-review">
    <summary><span class="operations-review-mark" aria-hidden="true">!</span>
      <span class="operations-disclosure-title"><strong>等待记录待核对 <span class="operations-review-count">${wait.review.length} 条</span></strong><small>平均排队等待暂不显示</small></span>
      <span class="operations-disclosure-action"><span class="when-closed">查看记录</span><span class="when-open">收起记录</span><i aria-hidden="true"></i></span></summary>
    <div class="operations-review-content"><p>原记录保留，以下时长仅供核对。</p><div class="operations-review-list">${wait.review.map(r=>
      `<article class="operations-review-record"><header><strong>${h(r.customer)}<span> · ${h(r.store)}</span></strong><span class="operations-review-reason">${h(r.reason)}</span></header>
        <dl>${[['到店时间',date(r.arrivedAt)],['开始办理',date(r.startedAt)],['记录时长',operationsDuration(r.minutes)]].map(([label,value])=>`<div><dt>${h(label)}</dt><dd>${h(value)}</dd></div>`).join('')}</dl></article>`
    ).join('')}</div></div></details>`:'';
  const currentCards=metric('当前排队',current.waiting,' 人','最长等待 '+operationsDuration(current.longestWait))+
    metric('逾期未还',current.overdue,' 份','查看归还异常')+metric('未关闭维修',current.repairs,' 单','含待验收与待确认退役')+
    metric('当前装备租出占比',current.utilization,'%', '当前租出件数 / 在册件数');
  const stages=[...data.stages,
    {label:'待支付合同',count:current.awaitingPayment},
    {label:'已确认待取件',count:current.awaitingPickup},
    {label:'今日应归还',count:current.returnsToday}].filter(x=>x.count!==null);
  const stage=`<div class="operations-stages">${stages.map(x=>`<div><strong>${x.count}</strong><span>${h(x.label)}</span></div>`).join('')}</div>`;
  const types=['all','检查','接待','预约','归还','取件','维修','支付'];
  const groups=`<div class="operations-groups" aria-label="待办分类">${types.map(type=>
    `<button type="button" data-action="operations-type" data-value="${h(type)}" aria-pressed="${(state.todoType||'all')===type}">${type==='all'?'全部':type}<span>${filterOperationsTodos(data.todos,type).length}</span></button>`).join('')}</div>`;
  const todos=filterOperationsTodos(data.todos);
  const representatives=[];
  for (const todo of todos) if (!representatives.some(t=>t.type===todo.type)) representatives.push(todo);
  const preview=[...representatives,...todos.filter(t=>!representatives.includes(t))];
  const visibleTodos=state.todosExpanded?todos:preview.slice(0,5);
  const todoRows=todos.length?`<ul class="operations-todos">${visibleTodos.map(t=>{
    const index=data.todos.indexOf(t);
    const time=t.type==='检查'?'检查完成前不可出租':t.overdueMinutes>0?'超时 '+operationsDuration(t.overdueMinutes):t.priority==='高'?'已到处理时限':'尚未超时';
    return `<li><div class="operations-todo-main"><div class="operations-todo-title">${pill(t.type)}<strong>${h(t.key)}</strong></div>
      <p>${h(t.store)} · ${h(t.status)}</p><p class="operations-reason">${h(t.reason)}</p>
      <small>${t.type==='检查'?'核验时点':'相关时间'} ${h(date(t.at))}</small></div>
      <div class="operations-todo-side">${pill(t.priority+'优先级')}<span>${h(time)}</span>${t.recordId?button('查看详情',t.link==='tracking'?'view-repair-todo':'view-contract-todo',t.recordId,'tiny'):
        t.detail?button('查看详情','view-operational-todo',index,'tiny'):'—'}</div></li>`;
  }).join('')}</ul>`+(todos.length>5?`<div class="operations-list-footer"><small>${state.todosExpanded?'全部待办':'各类重点'} · ${visibleTodos.length} / ${todos.length} 项</small>${button(state.todosExpanded?'收起待办':'展开全部待办','operations-expand','','tiny')}</div>`:''):empty('当前分类暂无待办');
  const storeRows=[['等待接待','waiting',' 人'],['安全与兼容检查','inspections',' 件'],['逾期未还','overdue',' 份'],['未关闭维修','repairs',' 单'],['当前装备租出占比','utilization','%']];
  const compare=data.stores?.length?table(['关注事项',...data.stores.map(s=>s.name)],storeRows.map(([label,key,unit])=>[
    h(label),...data.stores.map(s=>h(s[key]==null?'—':s[key]+unit))]))+`<p class="operations-note">固定对照全部门店。归还按合同取还门店归属，维修按责任门店归属。</p>`:empty('门店对比暂不可用');
  const auditColumns=['时间','操作人','发生门店','事件','状态变化','结果','关联对象'];
  const auditCells=data.events.map(e=>[
    h(date(e.occurred_at)),h(e.display_name||'系统'),h(e.event_store_name||'—'),h(e.event_type),
    e.from_status||e.to_status?h((e.from_status||'—')+' → '+(e.to_status||'—')):'<span class="muted">不涉及状态变更</span>',
    pill(e.result),auditTargetsView(e)
  ]);
  const auditRows=auditCells.length?`<div class="table-wrap"><table><thead><tr>${auditColumns.map(c=>`<th scope="col">${h(c)}</th>`).join('')}</tr></thead>
    <tbody>${auditCells.map(row=>`<tr>${row.map((cell,index)=>`<td data-label="${h(auditColumns[index])}">${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:empty('所选范围内暂无审计事件');
  const auditSearch=form('audit-list',input('事件、操作人或关联业务','auditKey',state.auditFilter?.auditKey||'','search','maxlength="80" placeholder="例如 装备编号、工单号、顾客姓名"')+
    fieldButton('筛选',true),'inline');
  const auditContent=data.auditPagination?
    auditRows+body(historyPager(data.auditPagination,'audit-page')):empty('审计记录暂不可用');
  const missing=data.missing?.length?panel('部分数据暂不可用',body(info(data.missing.join('、')+'查询失败，以下显示已获取的结果。',true))):'';
  const periodRows=[
    ['预约数',s.reservations==null?'—':s.reservations+' 条'],
    ['跨店归还装备',s.crossStore==null?'—':s.crossStore+' 件'],
    ['新建维修工单',s.repairsOpened==null?'—':s.repairsOpened+' 单'],
    ['完成维修工单',s.repairsClosed==null?'—':s.repairsClosed+' 单']
  ];
  const tabs=[['current','当前概览'],['period','经营统计'],['audit','审计记录']];
  const toolbar=`<div class="operations-toolbar"><div><p class="operations-note">北京时间 · 数据截至 ${h(date(data.cutoff))}</p><p class="operations-note">经理只读查看</p></div>${storeControl}</div>`;
  const nav=`<div class="operations-tabs" role="tablist" aria-label="经营看板页面">${tabs.map(([key,label])=>`<button type="button" role="tab" id="operations-tab-${key}" aria-selected="${tab===key}" aria-controls="operations-content" data-action="operations-tab" data-value="${key}">${label}</button>`).join('')}</div>`;
  const detail=state.todoDetail?`<div id="todo-detail">${button('关闭详情','operations-close-detail','','tiny')}${state.todoDetail.detail?operationalTodoDetail(state.todoDetail):state.todoDetail.order?repairDocument(state.todoDetail):contractDocument(state.todoDetail)}</div>`:'';
  const currentView=`<div class="metrics operations-kpis">${currentCards}</div><div class="operations-columns">`+
    panel('重点待办与超时预警',groups+todoRows,`<small>${data.todos.length} 项 · 高优先级 ${data.todos.filter(t=>t.priority==='高').length} 项</small>`)+
    panel('两店当前对比',compare,`<small>全部门店</small>`)+`</div>`+detail+
    panel('当前办理环节积压',body(stage))+`<p class="operations-note">待接待预约 ${current.pendingReservations??'—'} 条 · 支付待处理 ${current.paymentTodo??'—'} 项。当前状态和待办不受历史日期范围限制。</p>`;
  const periodView=panel('统计范围',body(controls))+(data.hasData?
    `<div class="metrics operations-kpis">${metricCards}</div>`+waitingReview+
    `<details class="operations-disclosure operations-secondary"><summary>
      <span class="operations-disclosure-title"><strong>其他业务统计</strong><small>预约、跨店归还与维修</small></span>
      <span class="operations-disclosure-action"><span class="when-closed">展开</span><span class="when-open">收起</span><i aria-hidden="true"></i></span></summary>
      <dl class="operations-secondary-grid">${periodRows.map(([label,value])=>`<div><dt>${h(label)}</dt><dd>${h(value)}</dd></div>`).join('')}</dl></details>`:
    empty(data.missing?.length?'当前没有可展示的统计记录':'所选范围内暂无数据'));
  const auditView=panel('审计查询范围',body(controls))+auditDetailView()+`<section class="panel" id="audit-history"><header class="panel-head"><h2>所选日期审计记录</h2></header>${body(auditSearch)+auditContent}</section>`;
  return `<div class="operations-dashboard">${toolbar}${nav}${missing}<div id="operations-content" role="tabpanel" aria-labelledby="operations-tab-${tab}">${tab==='current'?currentView:tab==='period'?periodView:auditView}</div></div>`;
}
function auditTargetsView(event) {
  const targets=event.targetObjects||[];
  if(!targets.length) return '<span class="muted">无关联业务记录</span>';
  const entry=t=>t.available?`<button type="button" class="btn audit-target" data-action="view-audit-target"
    data-value="${h(event.audit_event_id+':'+t.entityType+':'+t.entityId)}" aria-label="查看${h(t.label)}">${h(t.label)}</button>`:
    `<span class="audit-target unavailable">${h(t.label)}</span>`;
  return `<div class="audit-targets">${targets.slice(0,3).map(entry).join('')}${targets.length>3?
    `<details class="audit-extra"><summary>另 ${targets.length-3} 个关联对象</summary><div class="audit-targets">${targets.slice(3).map(entry).join('')}</div></details>`:''}</div>`;
}
function auditDetailView() {
  const d=state.auditDetail;
  if(!d) return '';
  const content=d.contract?contractDocument(d.contract):d.repair?repairDocument(d.repair):panel(d.target.label,body(details(d.fields.map(f=>
    [f.label,h(f.value==null?'—':f.format==='date'?date(f.value):f.format==='money'?money(f.value):f.value)]))));
  return `<section id="audit-target-detail" tabindex="-1" aria-label="关联业务详情">${actions(button('返回审计记录','audit-close-detail','','tiny'))}
    ${info('以下为关联业务的当前详情，仅供查看；事件发生时的状态请以审计记录中的“状态变化”为准。')}${content}</section>`;
}
function operationalTodoDetail(todo) {
  const d=todo.detail;
  const fields={
    预约:[['预约来源',h(d.source)],['预计到店',h(date(todo.at))],['租赁开始',h(date(d.start))],['计划结束',h(date(d.end))]],
    接待:[['当前环节',h(d.stage)],['到店时间',h(date(todo.at))],['开始办理',h(date(d.started))]],
    检查:[['装备型号',h(d.model)],['检查结果',h(d.inspection||'未记录')],['检查有效期',h(d.validUntil||'—')]]
  };
  return panel(todo.type+'详情 · '+todo.key,body(details([
    ['责任门店',h(todo.store)],['状态',pill(todo.status)],...fields[todo.type]])));
}
const views = {reception:receptionView,contracts:contractsView,returns:returnsView,repair:repairView,tracking:trackingView,operations:operationsView};
