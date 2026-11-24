async function loadReservations() {
  state.bookingList=await api('reservations',{date:state.bookingDate||localDay(0)});
  state.bookingDate=state.bookingList.date;
  if(state.bookingDetail) state.bookingDetail=await api('reservation',{reservationId:state.bookingDetail.reservation_id});
}
async function closeBooking(id,status) {
  if (!window.confirm(status==='未到店'?'标记该顾客未到店并释放接待名额？':'取消预约并释放接待名额？')) return;
  const r=await api('reservation',{reservationId:id});
  state.bookingDetail=await api('reservation-end',{reservationId:id,version:r.version,status,confirm:true});
  await loadReservations(); Object.assign(state,await api('bootstrap')); render(); toast('预约已'+(status==='未到店'?'标记未到店':'取消'));
}
function receptionTabs() {
  const tab=state.receptionTab||'arrival';
  return `<div class="reception-tabs" role="group" aria-label="接待方式">${[['arrival','到店办理'],['bookings','预约安排'],['preparation','预约准备']].map(([key,label])=>
    `<button type="button" class="btn ${key===tab?'primary':''}" data-action="reception-tab" data-value="${key}" aria-pressed="${key===tab}">${label}</button>`).join('')}</div>`;
}
function bookingSummary(r) {
  const req=r.requirements,p=r.preparation;
  return info(r.status==='已预订'?'装备已按合同租期预留；到店后按实际顺序排队，核对并试穿后领取。':'登记需求或保存备选方案不会占用装备。选装、核对合同并完成模拟付款后，才确认装备预订。')+
    `<dl class="details"><div><dt>顾客</dt><dd>${h(r.name)} · ${h(r.phone)}</dd></div><div><dt>预计到店时间</dt><dd>${h(date(r.appointment_at))}</dd></div>
    <div><dt>租赁时间</dt><dd>${h(date(r.requested_start_at))} 至 ${h(date(r.requested_end_at))}</dd></div>
    <div><dt>准备状态</dt><dd>${h(p?.status||(req?'待准备':'资料待补全'))}</dd></div></dl>`+
    (req?`<p>${h(req.categories.map(c=>categories[c]).join('、'))} · ${h(req.system)} · 身高 ${h(req.fit.height_cm)} cm · 实测脚长 ${h(req.fit.foot_length_mm)} mm</p>`:'')+
    (req?.note?info('预约备注：'+req.note):'')+
    (p?table(['所需类别','备选装备','准备结果','预计租金 / 押金'],p.choices.map(c=>[h(categories[c.category]),c.missing?'—':cell(c.asset,c.size),h(c.missing?'缺货待沟通':c.trial?'到店须试穿核对':'到店重新核验'),c.missing?'—':money(c.rent)+' / '+money(c.deposit)]))+
      info('准备于 '+date(p.at)+' · '+p.by+(p.note?' · 联系及准备记录：'+p.note:'')):'');
}
function reservationForm() {
  const r=state.bookingEdit||{},req=r.requirements||{},fit=req.fit||{};
  const arrival=r.appointment_at||localDay(1)+'T02:00:00.000Z';
  const fields=`<div class="grid three">
    ${input('顾客姓名','name',r.name||'','text','required maxlength="100"')}
    ${input('手机号','phone',r.phone||'','tel',`required ${r.reservation_id?'readonly':''}`)}
    ${select('预约来源','source',['电话','微信','当面'],['电话','微信','当面'].includes(r.source_type)?r.source_type:'电话')}
    ${input('预计到店时间（北京时间）','appointmentAt',localTime(arrival),'datetime-local','required')}
    ${input('租赁开始','start',localTime(r.requested_start_at||arrival),'datetime-local','required')}
    ${input('计划结束','end',localTime(r.requested_end_at||Date.parse(arrival)+86400000),'datetime-local','required')}
    ${input('身高（cm）','height_cm',fit.height_cm||'','number','required min="90" max="230" step="0.01"')}
    ${input('体重（kg）','weight_kg',fit.weight_kg||'','number','required min="15" max="180" step="0.01"')}
    ${input('实测脚长（mm）','foot_length_mm',fit.foot_length_mm||'','number','required min="140" max="340"')}
    ${input('日常鞋码（EU，选填参考）','shoe_size',fit.shoe_size||'','number','min="22" max="55" step="0.1"')}
    ${select('技能水平','skill_level',['初级','中级','高级'],fit.skill_level||'初级')}
    ${select('固定器与雪靴接口','system',['Alpine','Touring'],req.system||'Alpine')}
    ${input('装备偏好（选填）','equipment_preference',fit.equipment_preference||'')}
    ${storeSelect('returnStore','约定归还门店',req.returnStore||state.user.store_id)}
    <div class="field"><span>预约及取件门店</span><strong>${h(storeName(state.user.store_id))}</strong></div></div>`;
  return panel(r.reservation_id?'修改预约资料与时间':'新建预约',body(form('booking-save',
    info('预计到店时间用于准备装备，不限制预约人数、不承诺免排队。能否预订取决于所选租期的可用库存；修改需求后须重新选装。')+
    fields+`<div class="checks">${Object.entries(categories).map(([c,n])=>`<label><input type="checkbox" name="category" value="${c}" ${(req.categories||['SKI','BOOT']).includes(c)?'checked':''}>${n}</label>`).join('')}</div>`+
    input('预约备注（选填）','note',req.note||'','text','maxlength="500"')+
    actions(fieldButton('保存预约',true)+button('返回预约列表','booking-close')),'stack')));
}
function bookingView() {
  if (state.bookingEdit) return reservationForm();
  const list=state.bookingList||{rows:[]},preparing=state.receptionTab==='preparation';
  const filter=form('booking-date',input('查看日期','date',state.bookingDate||localDay(0),'date','required')+fieldButton('查询'),'inline');
  const rows=list.rows.filter(r=>!preparing||['待接待','待支付','已预订'].includes(r.status));
  const tableRows=rows.map(r=>[
    cell(r.appointment_at?shortDate(r.appointment_at):'未设预计到店时间',r.reservation_no),cell(r.name,r.phone),
    pill(r.status),
    h(r.status==='待接待'?(r.preparation?.status||(r.requirements?'待选装':'资料待补全')):r.status==='待支付'?'等待模拟付款':r.status==='已预订'?'装备已预留':r.status==='已接待'?'已转入到店办理':'预约已结束'),
    actions(button(preparing?'准备方案':'查看预约','booking-open',r.reservation_id,'tiny')+
      (['待接待','待支付','已预订'].includes(r.status)?button('确认到店','booking-arrive',r.reservation_id,'tiny'):''))
  ]);
  const detail=state.bookingDetail;
  return panel(preparing?'提前选装与装备预订':'预约安排',body(info('预约顾客提前选装、确认合同并模拟付款后预留装备；现场顾客到店后选装办理。')+filter+
    (!preparing?actions(button('新建预约','booking-new','','primary')):'')+
    info('不设预约人数上限。所有顾客按实际到店顺序办理，预约顾客已提前完成的手续无需重复办理。'))+
    table(['预计到店 / 预约号','顾客','预约状态','准备状态','操作'],tableRows,'所选日期暂无预约'))+
    (detail?panel('预约详情',body(bookingSummary(detail)+
      (detail.contractId?actions(button('查看预订合同 / 支付与取消','booking-contract',detail.contractId,'primary')):'')+
      (detail.status==='待接待'?form('booking-prepare',
      input('准备及联系记录（选填）','note',detail.preparation?.note||'','text','maxlength="500"')+
      actions(fieldButton('查询并保存备选方案')+button('选择装备并预订','booking-choices',detail.reservation_id,'primary')+button('修改 / 改期','booking-edit',detail.reservation_id)+
        button('取消预约','booking-cancel',detail.reservation_id)+
        (detail.appointment_at&&Date.parse(detail.appointment_at)<Date.now()?button('标记未到店','booking-noshow',detail.reservation_id):'')),'stack'):'')))+
      (state.bookingChoices&&state.bookingChoices.reservationId===detail.reservation_id?bookingChoicesView():''):'' );
}
function bookingChoicesView() {
  const r=state.bookingChoices;
  const rows=[...r.candidates,...r.alternatives].map(c=>[
    `<input type="checkbox" name="equipmentId" value="${c.equipment_id}" aria-label="选择 ${h(c.asset_no)}">`,
    cell(c.asset_no,c.brand+' '+c.model_name),cell(c.category_name,c.size_spec),
    h(c.requiresFitConfirmation?'临近尺寸，到店必须试穿核对':'按资料适配，到店核对实物'),money(c.rent)+' / '+money(c.deposit)]);
  return panel('选择本店可预订装备',body(info('请选择各所需类别的装备。确认合同和模拟付款前会再次检查租期冲突；临近尺寸预订须在到店试穿后才能交付。'))+
    form('booking-quote',table(['选择','装备','类别 / 尺寸规格','到店核对','租金 / 押金'],rows,'所选租期暂无可预订装备')+
    body(r.missing.length?info('缺少可选类别：'+r.missing.map(c=>categories[c]).join('、'),true):actions(fieldButton('核对预订合同与费用',true)))));
}
