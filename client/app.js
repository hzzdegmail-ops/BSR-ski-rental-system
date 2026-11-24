function resetReturn() {
  delete state.returnPreview;
  delete state.returnSelection;
  delete state.exchangeCandidates;
  delete state.exchangeSearch;
  delete state.exchangeToken;
}
function resetRecommendation() {
  delete state.recommendation;
  delete state.quote;
  delete state.selection;
}
function fittingSelection(fd) {
  const data=Object.fromEntries(fd);
  const fit=Object.fromEntries(['height_cm','weight_kg','foot_length_mm','shoe_size','skill_level','equipment_preference'].map(k=>[k,data[k]]));
  return {fit,taskId:state.task.task_id,start:toISO(data.start),end:toISO(data.end),
    system:data.system,pickup:data.pickup,returnStore:data.returnStore,categories:fd.getAll('category')};
}
function returnSelection(fd) {
  const data=Object.fromEntries(fd);
  const equipmentIds=fd.getAll('received');
  const inspections=Object.fromEntries(equipmentIds.map(id=>[id,{condition:data['condition_'+id],fee:data['fee_'+id]}]));
  return {contractId:state.returnContract.contract.contract_id,storeId:data.storeId,equipmentIds,inspections};
}
function exchangeSelection(fd) {
  const {height_cm,weight_kg,foot_length_mm,shoe_size,skill_level,equipment_preference,...data}=Object.fromEntries(fd);
  const fit={height_cm,weight_kg,foot_length_mm,shoe_size,skill_level,equipment_preference};
  return {...data,fit,contractId:state.returnContract.contract.contract_id};
}
function verifySelection(fd, select, before) {
  const current=select(fd);
  if (JSON.stringify(current)!==JSON.stringify(before)) throw new Error('资料已修改，请重新核对后确认');
  return current;
}
function scrollToForm(name) {
  document.querySelector('[data-form="'+name+'"]')?.closest('.panel')?.scrollIntoView({block:'nearest',behavior:'smooth'});
}
async function afterEnqueue(data) {
  const res=await api('enqueue',data);
  state.queue=await api('queue');
  Object.assign(state,await api('bootstrap'));
  delete state.lookup;
  state.lookupKey='';
  render();
  toast('当前排队序号 '+res.task.queue_no);
}
async function displayContract(data,key,refresh=true) {
  state[key]=data;
  if (refresh) await loadContractList(state.page);
  render();
}
function discardPrompt(message) {
  return !state.dirtyForm || state.dirtyForm==='recommend' ||
    window.confirm(message);
}
function clearWorkbench() {
  for (const key of Object.keys(state)) delete state[key];
}
function interruptedFormKey() {
  const order=state.repairDetail?.order;
  return state.page==='tracking'?`tracking:${order?.repair_order_id}:${order?.version}`:state.lookupKey;
}
async function showExpiredLogin() {
  const form=app.querySelector('form[data-form="'+state.dirtyForm+'"]');
  if (form && ['walk-in','repair-assign','repair-update','repair-inspect'].includes(state.dirtyForm)) {
    const fd=new FormData(form);
    fd.delete('confirm');
    state.interruptedForm={name:state.dirtyForm,key:interruptedFormKey(),values:Object.fromEntries(fd)};
  }
  state.expiredUser=state.user.username;
  state.user=null;
  app.replaceChildren();
  await loginView();
  toast('工作会话已过期，请登录原账号继续办理。',true);
}
async function showRepairList(filter) {
  await loadRepairs(filter);
  state.dirtyForm=null;
  render();
}
async function showAuditHistory(filter) {
  delete state.auditDetail;
  state.operating=await api('operations',{...state.scope,...filter});
  state.auditFilter={...filter,auditPage:state.operating.auditPagination?.page??1};
  state.auditExpanded=true;
  state.operationsTab='audit';
  render();
  document.querySelector('#audit-history')?.scrollIntoView({block:'start'});
}
const formHandlers = {
  async 'contract-list'(data) {
    await loadContractList(state.page,{...data,page:1});
    render();
  },
  async login(data) {
    await api('login',data);
    await activateUser();
    const draft=state.interruptedForm;
    delete state.interruptedForm;
    if (!draft || draft.key!==interruptedFormKey()) return;
    const form=app.querySelector('form[data-form="'+draft.name+'"]');
    if (!form) return;
    for (const [name,value] of Object.entries(draft.values)) {
      const control=form.elements.namedItem(name);
      if (control && 'value' in control) control.value=value;
    }
    return false;
  },
  async lookup(data) { state.lookup=await api('lookup',data); state.lookupKey=data.key; render(); },
  'walk-in':afterEnqueue,
  async 'booking-date'(data) { state.bookingDate=data.date; delete state.bookingDetail; await loadReservations(); render(); },
  async 'booking-quote'(data,fd) {
    const selected={token:state.bookingChoices.token,equipmentIds:fd.getAll('equipmentId')};
    const quote=await api('quote',selected);
    state.quote=quote;state.selection=selected;state.contract=null;await loadPage('contracts');window.scrollTo(0,0);
  },
  async 'booking-save'(data,fd) {
    const fit=Object.fromEntries(['height_cm','weight_kg','foot_length_mm','shoe_size','skill_level','equipment_preference'].map(k=>[k,data[k]]));
    const saved=await api('reservation-save',{...data,fit,categories:fd.getAll('category'),appointmentAt:toISO(data.appointmentAt),
      start:toISO(data.start),end:toISO(data.end),reservationId:state.bookingEdit.reservation_id,version:state.bookingEdit.version});
    state.bookingDate=localTime(saved.appointment_at).slice(0,10); state.bookingDetail=saved; delete state.bookingEdit;
    delete state.bookingChoices;
    await loadReservations(); Object.assign(state,await api('bootstrap')); render(); toast('预约需求已保存，可提前选装并确认预订');
  },
  async 'booking-prepare'(data) {
    const r=state.bookingDetail;
    state.bookingDetail=await api('reservation-prepare',{reservationId:r.reservation_id,version:r.version,note:data.note});
    delete state.bookingChoices;
    await loadReservations(); render(); toast('备选方案已保存，到店时重新核验');
  },
  async recommend(data,fd) {
    const draft=fittingSelection(fd);
    resetRecommendation();
    app.querySelector('[data-form="quote"]')?.closest('.panel')?.remove();
    const recommendation=await api('recommend',draft);
    verifySelection(new FormData(document.querySelector('[data-form="recommend"]')),fittingSelection,draft);
    state.recommendation=recommendation;
    state.fitForm=draft;
    delete state.fitDraft;
    state.queue=await api('queue');
    render();
    scrollToForm('quote');
  },
  async quote(data,fd) {
    const equipmentIds=fd.getAll('equipmentId');
    const selection={equipmentIds,token:state.recommendation.token,fitConfirmed:fd.get('fitConfirmed')==='on',fitNote:data.fitNote||''};
    const quote=await api('quote',selection);
    if (state.recommendation?.token!==selection.token) throw new Error('适配条件已修改，请重新查询装备');
    Object.assign(state,{quote,selection,contract:null});
    await loadPage('contracts'); window.scrollTo(0,0);
  },
  async confirm(data) {
    const detail=await api('confirm',{...state.selection,confirm:!!data.confirm,scenario:data.scenario});
    state.quote=null;
    if (detail.contract.status==='已确认') {
      delete state.task; delete state.recommendation; delete state.fitForm;
    }
    await displayContract(detail,'contract');
    Object.assign(state,await api('bootstrap'));delete state.bookingChoices;
    toast('合同状态：'+detail.contract.status+(detail.payments[0]?' · 支付'+detail.payments[0].status:''));
  },
  async pickup(data) {
    await displayContract(await api('pickup',{contractId:state.contract.contract.contract_id,confirm:!!data.confirm,fitConfirmed:!!data.fitConfirmed,fitNote:data.fitNote}),'contract');
    toast('装备已交付，合同进入租出状态');
  },
  async 'cancel-uncollected'(data) {
    const detail=await api('cancel-uncollected',{contractId:state.contract.contract.contract_id,confirm:!!data.confirm,scenario:data.scenario});
    if (detail.contract.status==='已取消' && state.task?.task_id===detail.contract.service_task_id) {
      delete state.task;
      delete state.fitForm;
      resetRecommendation();
    }
    await displayContract(detail,'contract');
    toast(detail.contract.status==='已取消'?'合同已取消，装备占用已释放':'模拟退款待处理，请使用原请求号重试');
  },
  async 'find-contract'(data) {
    state.returnKey=data.key;
    const detail=await api('find-contract',data);
    resetReturn(); await displayContract(detail,'returnContract',false);
  },
  async 'preview-return'(data,fd) {
    const selection=returnSelection(fd);
    const preview=await api('preview-return',selection);
    verifySelection(new FormData(document.querySelector('[data-form="preview-return"]')),returnSelection,selection);
    state.returnPreview=preview;
    state.returnSelection=selection; render(); scrollToForm('return');
  },
  async return(data) {
    const selection=verifySelection(new FormData(document.querySelector('[data-form="preview-return"]')),returnSelection,state.returnSelection);
    const result=await api('return',{...selection,token:state.returnPreview.token,confirm:!!data.confirm,scenario:data.scenario});
    dropDrafts(contractDraftForms,selection.contractId);
    resetReturn(); await displayContract(result,'returnContract');
    toast('归还处理结果：'+result.contract.status);
  },
  async 'exchange-choices'(data,fd) {
    const search=exchangeSelection(fd);
    const preview=await api('exchange-choices',search);
    verifySelection(new FormData(document.querySelector('[data-form="exchange-choices"]')),exchangeSelection,search);
    state.exchangeCandidates=preview.candidates;
    state.exchangeToken=preview.token;
    state.exchangeSearch=search; render(); scrollToForm('exchange');
  },
  async exchange(data) {
    const search=verifySelection(new FormData(document.querySelector('[data-form="exchange-choices"]')),exchangeSelection,state.exchangeSearch);
    const result=await api('exchange',{...search,...data,token:state.exchangeToken,confirm:!!data.confirm});
    if (result.items.some(i=>i.equipment_id===Number(data.newId)&&i.item_status==='租出')) {
      dropDrafts(contractDraftForms,search.contractId);
    }
    resetReturn(); await displayContract(result,'returnContract');
    const latest=result.payments[0];
    if (latest?.response_code==='DEMO_EXCHANGE_EXPIRED') {
      toast('本次换装已取消，原装备仍在合同中');
      return;
    }
    const failed=latest?.request_type==='补款'&&latest.status==='失败'&&!result.items.some(i=>i.equipment_id===Number(data.newId)&&i.item_status==='租出');
    toast(result.price.pending?'费用调整处理中，请通过原请求号查询':failed?'补款失败，原合同继续有效':'换装已完成',failed);
  },
  'asset-filter'(data) { state.assetFilter={...data,filter:data.filter.trim()}; state.assetPage=1; render(); },
  async 'repair-list'(data) {
    if (!discardPrompt('筛选会清除未提交的工单资料。确定筛选？')) return false;
    await showRepairList({...data,page:1});
  },
  async 'repair-submit'(data) {
    state.repairDetail=await api('repair-submit',{...data,equipmentId:state.equipmentId});
    dropDrafts(assetDraftForms,state.equipmentId);
    await loadPage('tracking'); window.scrollTo(0,0);
    toast('工单已保存：'+state.repairDetail.order.status);
  },
  async 'inspect-asset'(data) {
    const r=await api('inspect-asset',{...data,equipmentId:state.equipmentId});
    dropDrafts(['inspect-asset'],state.equipmentId);
    await loadPage('repair');
    toast('检查已记录，装备'+r.equipment.status);
  },
  async operations(data) {
    const filter={...state.auditFilter,auditPage:1};
    const scope={...state.scope,...data};
    state.operating=await api('operations',{...scope,...filter});
    state.scope=scope;
    state.auditFilter=filter;
    delete state.todoDetail;
    delete state.auditDetail;
    render();
  },
  'operations-store':data=>formHandlers.operations({storeId:data.storeId}),
  'audit-list':data=>showAuditHistory({auditKey:data.auditKey,auditPage:1})
};
for (const action of ['repair-assign','repair-update','repair-inspect']) {
  formHandlers[action]=async data=>{
    if (action==='repair-update' && data.estimatedCompletionAt) data.estimatedCompletionAt=toISO(data.estimatedCompletionAt);
    state.repairDetail=await api(action,{...data,orderId:state.repairDetail.order.repair_order_id});
    await loadPage('tracking'); toast('工单状态：'+state.repairDetail.order.status);
  };
}
const clickHandlers = {
  'operations-tab'(tab) {
    if (!['current','period','audit'].includes(tab)) return;
    state.operationsTab=tab;
    render();
    document.querySelector('#operations-tab-'+tab)?.focus({preventScroll:true});
  },
  'operations-type'(type) { state.todoType=type; state.todosExpanded=false; delete state.todoDetail; render(); },
  'operations-expand'() { state.todosExpanded=!state.todosExpanded; render(); },
  'operations-close-detail'() { delete state.todoDetail; render(); },
  async 'operations-refresh'() {
    state.operating=await api('operations',{...state.scope,...state.auditFilter});
    delete state.todoDetail;
    delete state.auditDetail;
    render();
    toast('经营数据已更新');
  },
  async navigate(page) {
    if (page===state.page) return;
    if (!discardPrompt('此页有尚未提交的资料，离开后会清除。确定离开？')) return;
    await loadPage(page);
    state.dirtyForm=null;
    window.scrollTo(0,0);
  },
  async refresh() {
    if (!discardPrompt('刷新会清除已输入的资料。确定刷新？')) return;
    const page=state.page;
    if (page==='returns') resetReturn();
    await loadPage(page);
    state.dirtyForm=null;
  },
  async 'contract-page'(page) {
    await loadContractList(state.page,{...state.contractFilters?.[state.page],page:Number(page)});
    render();
  },
  async 'repair-page'(page) {
    if (!discardPrompt('翻页会清除未提交的工单资料。确定翻页？')) return;
    await showRepairList({...state.repairFilter,page:Number(page)});
  },
  'asset-page'(page) {
    state.assetPage=Number(page);
    render();
    document.querySelector('.asset-list')?.scrollIntoView({block:'nearest'});
  },
  'audit-page':page=>showAuditHistory({...state.auditFilter,auditPage:Number(page)}),
  async 'view-audit-target'(value) {
    const [auditEventId,entityType,entityId]=value.split(':');
    state.auditDetail=await api('audit-target',{auditEventId,entityType,entityId});
    render();
    const detail=document.querySelector('#audit-target-detail');
    detail?.focus({preventScroll:true});
    detail?.scrollIntoView({block:'start',behavior:'smooth'});
  },
  'audit-close-detail'() {
    delete state.auditDetail;render();
    document.querySelector('#audit-history')?.scrollIntoView({block:'start'});
  },
  async logout() {
    await api('logout');
    state.drafts=[];
    persistDrafts();
    clearWorkbench();
    notice.hidden=true; await loginView();
  },
  async sample(key) { await formHandlers.lookup({key}); },
  async 'reception-tab'(tab) {
    if (!discardPrompt('切换页面会清除未保存的资料。确定切换？')) return;
    state.receptionTab=tab; delete state.bookingEdit; state.dirtyForm=null; await loadPage('reception');
  },
  'booking-new'() { delete state.bookingChoices;state.bookingEdit={}; render(); },
  async 'booking-open'(id) { delete state.bookingChoices;state.bookingDetail=await api('reservation',{reservationId:id}); render(); },
  async 'booking-choices'(id) {
    state.bookingDetail=await api('reservation',{reservationId:id});
    state.bookingChoices=await api('reservation-choices',{reservationId:id});render();
    scrollToForm('booking-quote');
  },
  async 'booking-contract'(id) { state.quote=null;state.contract=await api('contract',{contractId:id});await loadPage('contracts');window.scrollTo(0,0); },
  async 'booking-reception'() { state.receptionTab='arrival';await loadPage('reception');window.scrollTo(0,0); },
  async 'booking-edit'(id) { state.bookingEdit=await api('reservation',{reservationId:id}); render(); },
  'booking-close'() { delete state.bookingEdit; state.dirtyForm=null; render(); },
  async 'booking-arrive'(id) {
    const r=await api('reservation',{reservationId:id});
    await afterEnqueue({customerId:r.customer_id,reservationId:r.reservation_id});
    state.receptionTab='arrival'; render(); toast('已确认到店，请从队列开始办理');
  },
  'booking-cancel':id=>closeBooking(id,'已取消'),
  'booking-noshow':id=>closeBooking(id,'未到店'),
  'enqueue-res':()=>afterEnqueue({customerId:state.lookup.customer.customer_id,reservationId:state.lookup.reservation.reservation_id}),
  'enqueue-known':()=>afterEnqueue({customerId:state.lookup.customer.customer_id}),
  async 'begin-task'(id) {
    await api('begin',{taskId:id});
    state.task=await api('task',{taskId:id});
    if(state.task.prebookedContractId) {
      state.quote=null;state.contract=await api('contract',{contractId:state.task.prebookedContractId});
      await loadPage('contracts');window.scrollTo(0,0);return;
    }
    resetRecommendation(); delete state.fitForm;
    delete state.fitDraft;
    const r=state.task.reservation;
    if (r?.requirements && r.requested_end_at>new Date().toISOString()) {
      state.fitForm={...r.requirements,start:r.requested_start_at,end:r.requested_end_at,taskId:state.task.task_id};
      state.recommendation=await api('recommend',state.fitForm);
    }
    state.queue=await api('queue'); render(); scrollToForm('recommend');
  },
  async 'leave-reception'(id) {
    if(!window.confirm('确认顾客已离店且本次未办理？记录将保留。'))return;
    await api('cancel-reception',{taskId:id,confirm:true,reason:'离店未办理'});
    if(Number(id)===state.task?.task_id){delete state.task;resetRecommendation();}
    await loadPage('reception');toast('已记录离店未办理');
  },
  async 'cancel-reception'(id) {
    if (!window.confirm('取消此办理任务并移出队列？')) return;
    await api('cancel-reception',{taskId:id,confirm:true});
    if (Number(id)===state.task?.task_id) {
      delete state.task;
      delete state.fitForm;
      delete state.fitDraft;
      state.dirtyForm=null;
      resetRecommendation();
    }
    Object.assign(state,await api('bootstrap'));
    await loadPage('reception');
    toast('已取消办理');
  },
  async 'open-contract'(id) {
    state.quote=null; await displayContract(await api('contract',{contractId:id}),'contract',false); window.scrollTo(0,0);
  },
  async 'open-return'(id) {
    resetReturn(); state.returnKey='';
    await displayContract(await api('contract',{contractId:id}),'returnContract',false); window.scrollTo(0,0);
  },
  async 'start-exchange'(id) {
    resetReturn();state.returnMode='exchange';
    await loadPage('returns');
    state.returnContract=await api('contract',{contractId:id});render();scrollToForm('exchange-choices');
  },
  'return-mode'(mode) {
    if ((state.returnMode||'return')===mode) return;
    resetReturn();
    state.returnMode=mode;
    render();
  },
  async retry(requestNo) {
    const result=await api('retry',{requestNo,scenario:'success'});
    if (result.contract.status==='已确认') { delete state.task; delete state.recommendation; delete state.fitForm; }
    if (result.payments.some(p=>p.request_no===requestNo&&p.status==='成功') &&
        result.price.adjustments?.some(a=>a.requestNo===requestNo&&a.type==='换装')) {
      dropDrafts(contractDraftForms,result.contract.contract_id);
    }
    await displayContract(result,state.page==='returns'?'returnContract':'contract');
    const payment=result.payments.find(p=>p.request_no===requestNo);
    if (payment?.response_code==='DEMO_EXCHANGE_EXPIRED') {
      resetReturn();
      render();
      toast('本次换装已取消，原装备仍在合同中');
    } else toast('模拟支付结果：'+payment?.status);
  },
  async 'repair-returned'(id) {
    state.equipmentId=Number(id);
    await loadPage('repair');
    window.scrollTo(0,0);
  },
  asset(id) { state.equipmentId=Number(id); render(); },
  async 'existing-repair'(id) {
    state.repairDetail=await api('repair',{orderId:id});
    await loadPage('tracking'); window.scrollTo(0,0);
  },
  async 'open-repair'(id) {
    if (!discardPrompt('切换工单会清除未提交的资料。确定切换？')) return;
    const detail=await api('repair',{orderId:id});
    state.repairDetail=detail;
    state.repairListing.rows=state.repairListing.rows.map(row=>row.repair_order_id===detail.order.repair_order_id?detail.order:row);
    state.dirtyForm=null;
    render();
  },
  'view-repair-todo':id=>showTodoDetail('repair',{orderId:id}),
  'view-contract-todo':id=>showTodoDetail('contract',{contractId:id}),
  'view-operational-todo'(index) {
    state.todoDetail=state.operating.todos[Number(index)];
    render();
    document.querySelector('#todo-detail')?.scrollIntoView({block:'start',behavior:'smooth'});
  },
  print() { window.print(); }
};
async function showTodoDetail(route,query) {
  state.todoDetail=await api(route,query);
  render();
  document.querySelector('#todo-detail')?.scrollIntoView({block:'start',behavior:'smooth'});
}
async function run(control,callback) {
  if (run.busy) return;
  run.busy=true;
  const progress=document.querySelector('#progress-status');
  const progressTimer=setTimeout(()=>{ progress.hidden=false; },250);
  app.setAttribute('aria-busy','true');
  if (control) control.disabled=true;
  try { await callback(); }
  catch (error) {
    if (error.status===401 && error.route!=='login' && state.user) {
      try { await showExpiredLogin(); }
      catch (loginError) { toast(loginError.message+'。请刷新页面重新登录。',true); }
    } else toast(error.message,true);
  }
  finally {
    clearTimeout(progressTimer);
    progress.hidden=true;
    app.removeAttribute('aria-busy');
    if (control) control.disabled=false;
    run.busy=false;
  }
}
app.addEventListener('submit',event=>{
  const name=event.target.dataset.form;
  if (!Object.hasOwn(formHandlers,name)) return;
  event.preventDefault();
  const data=new FormData(event.target);
  run(event.submitter,async()=>{
    const result=await formHandlers[name](Object.fromEntries(data),data);
    if (result!==false) state.dirtyForm=null;
  });
});
function invalidateReview(event) {
  const source=event.target.closest('form[data-form]');
  if (!source) return;
  if (['walk-in','recommend','booking-save','booking-prepare','repair-assign','repair-update','repair-inspect'].includes(source.dataset.form))
    state.dirtyForm=source.dataset.form;
  if (event.target.name!=='confirm' &&
      (assetDraftForms.includes(source.dataset.form) || contractDraftForms.includes(source.dataset.form))) {
    rememberDraft(source);
  }
  if (source.dataset.form==='recommend') {
    const draft=new FormData(source);
    state.fitDraft={taskId:state.task.task_id,fields:Object.fromEntries(draft),categories:draft.getAll('category')};
    resetRecommendation();
    app.querySelector('[data-form="quote"]')?.closest('.panel')?.remove();
  }
  if (source.dataset.form==='preview-return') {
    delete state.returnPreview;
    delete state.returnSelection;
    app.querySelector('[data-review="return"]')?.remove();
  }
  if (source.dataset.form==='exchange-choices') {
    delete state.exchangeCandidates;
    delete state.exchangeToken;
    delete state.exchangeSearch;
    app.querySelector('[data-form="exchange"]')?.remove();
  }
}
app.addEventListener('input',invalidateReview);
app.addEventListener('change',invalidateReview);
app.addEventListener('change',event=>{
  const form=event.target.closest('[data-form="quote"]');
  if (!form) return;
  const review=form.querySelector('[data-fit-review-fields]');
  if (!review) return;
  const needed=!!form.querySelector('[name="equipmentId"][data-fit-review="true"]:checked');
  review.hidden=!needed;
  for (const control of review.querySelectorAll('input')) control.required=needed;
  if (!needed) { form.elements.fitConfirmed.checked=false; form.elements.fitNote.value=''; }
});
app.addEventListener('click',event=>{
  const el=event.target.closest('[data-action]');
  if (!el || !Object.hasOwn(clickHandlers,el.dataset.action)) return;
  run(el,()=>clickHandlers[el.dataset.action](el.dataset.value));
});
app.addEventListener('keydown',event=>{
  const tab=event.target.closest('.operations-tabs [role="tab"]');
  if (!tab || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
  event.preventDefault();
  const tabs=[...tab.parentElement.querySelectorAll('[role="tab"]')];
  const index=event.key==='Home'?0:event.key==='End'?tabs.length-1:
    (tabs.indexOf(tab)+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
  clickHandlers['operations-tab'](tabs[index].dataset.value);
});
async function start() {
  try { await activateUser(); }
  catch(error) {
    await loginView();
    if (error.message!=='请先登录有效工作会话') toast(error.message,true);
  }
}
start().catch(error=>{ app.innerHTML=empty('工作台暂时无法加载'); toast(error.message,true); });
