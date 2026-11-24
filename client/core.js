const app = document.querySelector('#app');
const notice = document.querySelector('#notice');
const state = { page:'reception', user:null, stores:[], contractors:[], reservations:[] };
const pages = {
  reception:['▤','接待管理','预约顾客提前选装预订；现场顾客到店选装，两类顾客按实际到店顺序办理。'],
  contracts:['▣','合同办理','核对租期、费用和支付凭证，确认合同并办理取件。'],
  returns:['⇄','归还与换装','通过合同号或装备编号识别在租合同，记录归还和换装。'],
  repair:['⚒','维修登记','核对装备状态、故障和责任门店，登记送修或安全检查。'],
  tracking:['◷','维修跟踪','查看工单进度、维修结果和门店安全验收。'],
  operations:['▥','经营概览','查看两家门店的接待、库存利用、异常待办和维修情况。']
};
const modes = { staff:['reception','contracts','returns','repair','tracking'],contractor:['tracking'],manager:['operations'] };
const categories = { SKI:'双板', BOOT:'雪靴', POLE:'雪杖', HELMET:'头盔' };
const conditions = ['完好','损坏或存在安全隐患'];
const h = value => String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const date = x => x?new Date(x).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'—';
const shortDate = x => x?new Date(x).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false,hour:'2-digit',minute:'2-digit'}):'—';
const money = x => '¥'+Number(x??0).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const delta = x => x>0?'应补 '+money(x):x<0?'应退 '+money(-x):'无需补款或退款';
const storeName = id => state.stores.find(s=>s.store_id===Number(id))?.name||'—';
const localTime = raw => {
  const dt=new Date(raw||Date.now());
  return new Date(+dt+8*3600000).toISOString().slice(0,16);
};
const localDay = offset => localTime(Date.now()+offset*86400000).slice(0,10);
const toISO = val => new Date(val+'+08:00').toISOString();
const empty = text => `<p class="empty">${h(text)}</p>`;
const info = (text,warning=false) => `<p class="info${warning?' warning':''}">${h(text)}</p>`;
const pill = text => {
  const label=String(text??'—');
  const css=/失败|异常|不合格|逾期|缺失|高/.test(label)?'bad':/待|处理中|维修中|临时/.test(label)?'warn':/成功|确认|可租|完成|合格|归还|关闭/.test(label)?'good':'';
  return `<span class="pill ${css}">${h(label)}</span>`;
};
const options = (items, selected, placeholder='') =>
  (placeholder?`<option value="">${h(placeholder)}</option>`:'')+items.map(item=>{
    const [key,text]=Array.isArray(item)?item:[item,item];
    return `<option value="${h(key)}"${String(key)===String(selected)?' selected':''}>${h(text)}</option>`;
  }).join('');
const input = (label,name,value='',type='text',attrs='') => `<label class="field"><span>${h(label)}</span><input name="${name}" type="${type}" value="${h(value)}" ${attrs}></label>`;
const select = (label,name,items,value,placeholder='') => `<label class="field"><span>${h(label)}</span><select name="${name}">${options(items,value,placeholder)}</select></label>`;
const area = (label,name,placeholder='',value='') => `<label class="field full"><span>${h(label)}</span><textarea name="${name}" maxlength="500" required placeholder="${h(placeholder)}">\n${h(value)}</textarea></label>`;
const storeSelect = (name,label,value,scope=state.stores) => select(label,name,scope.map(s=>[s.store_id,s.name]),value);
const contractorSelect = value => select('维修承包商','contractorId',state.contractors.map(c=>[c.contractor_id,c.name]),value,'暂未分配');
const fieldButton = (label,primary=false) => `<button class="btn ${primary?'primary':''}" type="submit">${h(label)}</button>`;
const button = (label,action,value='',css='') => `<button type="button" class="btn ${css}" data-action="${action}" data-value="${h(value)}">${h(label)}</button>`;
const panel = (title,body,head='',css='') => `<section class="panel ${css}"><header class="panel-head"><h2>${h(title)}</h2>${head}</header>${body}</section>`;
const body = contents => `<div class="panel-body">${contents}</div>`;
const table = (columns,rows,emptyText='暂无记录') => rows.length?`<div class="table-wrap"><table><thead><tr>${columns.map(c=>`<th scope="col">${h(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(cell=>`<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:empty(emptyText);
const details = pairs => `<dl class="details">${pairs.map(([label,value])=>`<div><dt>${h(label)}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
const cell = (a,b='')=>`<span class="cell-title">${h(a)}</span>${b?`<span class="cell-sub">${h(b)}</span>`:''}`;
const check = (name,label) => `<label class="check"><input type="checkbox" name="${name}" required>${h(label)}</label>`;
const actions = html => `<div class="actions">${html}</div>`;
const historyPager = ({page,pages,total},action) => actions(
  (page>1?button('上一页',action,page-1,'tiny'):'')+
  `<small>共 ${total} 条 · 第 ${page} / ${pages} 页</small>`+
  (page<pages?button('下一页',action,page+1,'tiny'):''));
const form = (action,html,css='') => `<form data-form="${action}" class="${css}">${html}</form>`;
const scenario = () => select('模拟支付结果','scenario',[['success','成功'],['failure','失败'],['timeout','超时 / 处理中']],'success');
function toast(text,error=false) {
  notice.textContent=text; notice.hidden=false; notice.className=error?'error':'';
  clearTimeout(toast.timer);
  toast.timer=setTimeout(()=>{notice.hidden=true;}, error?9000:4200);
}
async function api(route,data={}) {
  const response=await fetch('/api/'+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
  const result=await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error||'操作失败，请刷新后重试'),{status:response.status,route});
  return result;
}
async function loginView() {
  const accounts=await api('demo-accounts');
  app.innerHTML=`<main class="login-page">
    <section class="login-brand"><span class="mark" aria-label="BSR">BSR</span>
      <h1>滑雪装备租赁与维护管理系统</h1><p>BSR 滑雪租赁公司</p></section>
    <section class="login-area"><div class="panel login-card">
      <h2>登录工作台</h2>
      ${form('login',
        select('演示账号','username',accounts.map(a=>[a.username,a.display_name]),state.expiredUser||'north.staff')+
        input('密码','password','','password','required autocomplete="current-password" placeholder="输入演示密码"')+
        fieldButton('登录',true)+`<small>演示密码 <strong>BSR-demo-2026</strong></small>`,'stack')}
    </div></section></main>`;
}
function render() {
  if (!state.user) return;
  const key=state.page;
  const nav=modes[state.user.role_type];
  app.innerHTML=`<div class="layout">
    <aside class="sidebar">
      <div class="brand"><span class="mark">BSR</span><div><strong>BSR 租赁与维护</strong><small>门店业务工作台</small></div></div>
      <nav class="nav" aria-label="工作台导航">${nav.map(item=>`<button data-action="navigate" data-value="${item}" ${item===key?'aria-current="page"':''}>
        <span class="nav-icon" aria-hidden="true">${pages[item][0]}</span>${pages[item][1]}</button>`).join('')}</nav>
      <div class="sidebar-footer"><small>${h(state.user.username)}</small><button data-action="logout">退出工作会话</button></div>
    </aside>
    <div class="workspace">
      <header class="topbar"><div class="context"><span class="dot"></span><span>${h(state.user.store_id?storeName(state.user.store_id):state.user.role_type==='manager'?'全部门店':'承包商工作区')}</span></div><span>${h(state.user.display_name)}</span></header>
      <main class="main" id="workspace"><header class="page-head"><div><h1>${pages[key][1]}</h1><p>${pages[key][2]}</p></div>
      <span class="tag">${h(new Date().toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai',month:'long',day:'numeric',weekday:'short'}))}</span></header>
      ${views[key]()}</main>
    </div>
  </div>`;
}
async function activateUser() {
  const profile=await api('bootstrap');
  const returning=state.expiredUser===profile.user.username;
  if (state.expiredUser && !returning) clearWorkbench();
  Object.assign(state,profile);
  const allowed=modes[state.user.role_type];
  let page=allowed[0];
  if (returning && allowed.includes(state.page)) {
    page=state.page;
    resetReturn();
    resetRecommendation();
  } else {
    state.drafts=loadDrafts(state.user.username);
    const draft=state.drafts[0];
    if (state.user.role_type==='staff' && draft && Number.isSafeInteger(draft.id)) {
      if (assetDraftForms.includes(draft.form)) {
        page='repair';
        state.equipmentId=draft.id;
      } else if (contractDraftForms.includes(draft.form)) {
        page='returns';
        state.returnMode=draft.form==='exchange-choices'?'exchange':'return';
        state.returnResumeId=draft.id;
      }
    }
  }
  await loadPage(page);
  delete state.expiredUser;
}
async function loadPage(page) {
  if (!modes[state.user.role_type].includes(page)) return;
  if (page==='reception') { Object.assign(state,await api('bootstrap')); state.queue=await api('queue'); await loadReservations(); }
  if (page==='contracts' || page==='returns') await loadContractList(page,undefined,true);
  if (page==='repair') state.inventory=await api('inventory');
  if (page==='tracking') await loadRepairs();
  if (page==='operations') state.operating=await api('operations',{...state.scope,...state.auditFilter});
  state.page=page;
  render();
}
async function loadRepairs(filter=state.repairFilter||{page:1}) {
  const listing=await api('repairs',filter);
  let detail=state.repairDetail;
  if (detail) {
    try {
      detail=await api('repair',{orderId:detail.order.repair_order_id});
      listing.rows=listing.rows.map(row=>row.repair_order_id===detail.order.repair_order_id?detail.order:row);
    } catch (error) {
      if (![403,404].includes(error.status)) throw error;
      detail=null;
      toast(error.message,true);
    }
  }
  state.repairDetail=detail;
  state.repairListing=listing;
  state.repairFilter={...filter,page:listing.page};
}
async function loadContractList(page,filter=state.contractFilters?.[page]||{},refreshDetail=false) {
  const scope=page==='returns'?'rental':filter.scope||'active';
  const listing=await api('contracts',{...filter,scope});
  if (!listing.rows.length && listing.page>1) {
    return loadContractList(page,{...filter,scope,page:1},refreshDetail);
  }
  if (refreshDetail) {
    const detailKey=page==='returns'?'returnContract':'contract';
    const previous=state[detailKey];
    const id=previous?.contract.contract_id??(page==='returns'?state.returnResumeId:null);
    if (id) {
      try {
        const detail=await api('contract',{contractId:id});
        state[detailKey]=detail;
        if (page==='returns' && previous?.contract.version!==detail.contract.version) resetReturn();
        if (page==='returns' && !['租出','处理异常'].includes(detail.contract.status)) dropDrafts(contractDraftForms,id);
        listing.rows=listing.rows.map(row=>row.contract_id===id?{...row,...detail.contract}:row);
      } catch (error) {
        if (error.status!==404) throw error;
        delete state[detailKey];
        if (page==='returns') {
          resetReturn();
          dropDrafts(contractDraftForms,id);
        }
        toast(error.message,true);
      }
    }
    if (page==='returns') delete state.returnResumeId;
  }
  (state.contractFilters??={})[page]={...filter,scope,page:listing.page};
  state.contractListing=listing;
}
function receiptPrice(price) {
  return table(['装备','日租金','计费天数','租金','押金'],price.lines.map(l=>[
    cell(l.asset_no,l.model+' · '+l.size),money(l.daily),h(l.days),money(l.rent),money(l.deposit)
  ]))+`<div class="totals"><span>租金<strong>${money(price.rent)}</strong></span>
    <span>押金<strong>${money(price.deposit)}</strong></span><span>应付<strong class="money">${money(price.total)}</strong></span></div>`+info(price.rules);
}
function receptionView() {
  if (state.receptionTab && state.receptionTab!=='arrival') return receptionTabs()+bookingView();
  const found=state.lookup;
  const lookup=form('lookup',input('手机号、预约号或顾客编号','key',state.lookupKey||'','search','required placeholder="例如 BSR-RES-001"')+fieldButton('检索',true),'inline');
  const reservation=found?.reservation;
  const result=!found?'':found.customer?
    `<div class="item"><div>${cell(found.customer.name,found.customer.phone)}
    <small>${reservation?h(reservation.reservation_no+' · '+reservation.store_name+' · '+reservation.status+' · 租赁开始 '+date(reservation.requested_start_at)):'现场顾客 · 可复用适配档案'}</small></div></div>`+
    actions((reservation&&reservation.store_id===state.user.store_id&&['待接待','待支付','已预订','已接待'].includes(reservation.status)?button('确认预约到店并加入队列','enqueue-res','','primary'):'')+
      button(['待接待','待支付','已预订'].includes(reservation?.status)?'另办现场租赁（不使用原预约）':'登记现场租赁（无本次预约）','enqueue-known','',reservation&&['待接待','待支付','已预订','已接待'].includes(reservation.status)?'':'primary'))+
    (reservation?.status==='待接待'?info('若顾客本次按此预约到店，请选择“确认预约到店”；另办现场租赁不会使用或核销原预约。'):''):
    info('未找到预约或顾客。请补充现场顾客资料。')+form('walk-in',
      `<div class="grid">${input('姓名','name','','text','required maxlength="100"')}${input('手机号','phone',/^\+?[\d -]{7,30}$/.test(state.lookupKey)?state.lookupKey:'','tel','required')}${input('电子邮箱（选填）','email','','email')}</div>`+
      actions(fieldButton('登记并加入队列',true)),'stack');
  const samples=state.reservations.length?`<div class="items">${state.reservations.map(r=>`<div class="item"><div>${cell(r.name,r.reservation_no)}<small>${h(r.appointment_at?'到店 '+date(r.appointment_at):'未设到店时间 · 租赁开始 '+date(r.requested_start_at))}</small></div>
      ${button('检索','sample',r.reservation_no,'tiny')}</div>`).join('')}</div>`:empty('暂无待接待预约');
  const q=state.queue||[];
  const nextTask=q.find(t=>t.status==='排队中')?.task_id;
  const rows=items=>table(['排队序号 / 到店','顾客','当前状态','开始时间','操作'],items.map(t=>[
    cell(t.queue_no+' 号',date(t.arrived_at)),cell(t.name,t.reservation_no||t.phone),pill(t.status==='排队中'?'等待接待':t.current_stage==='待取件'?'待取件':'办理中'),t.status==='排队中'?'—':h(shortDate(t.started_at)),
    actions((t.status==='排队中'&&t.task_id!==nextTask?'<button type="button" class="btn tiny" disabled>等待前方顾客</button>':button(t.status==='排队中'?'开始办理':'继续办理','begin-task',t.task_id,'tiny'))+
      (!t.contract_id?button('离店未办理','leave-reception',t.task_id,'tiny'):''))
  ]),'暂无记录');
  const queue=body(info('按到店顺序开始接待，保留原队号。付款后在合同办理确认取件，顾客可试装；不合适通过归还与换装，沿用原合同办理。')+rows(q));
  return receptionTabs()+info('已预约顾客：核对预约后确认到店。未预约顾客：通过手机号查找档案或登记新顾客。两类顾客均按实际到店顺序排队。')+`<div class="split">
    ${panel('顾客检索',body(`<div class="stack">${lookup}${result}</div>`))}
    ${panel('待接待预约',body(samples),button('刷新','refresh','','tiny'))}
  </div>`+panel('现场办理队列',queue,`<small>${q.length} 项待办</small>`)+(state.task?fittingView():'');
}
function fittingView() {
  const t=state.task;
  const req=t.reservation?.requirements;
  const f=state.fitForm||(req?{...req,start:t.requested_start_at,end:t.requested_end_at}:{});
  const saved=state.fitDraft?.taskId===t.task_id?state.fitDraft:null;
  const raw=saved?.fields||f.fit||t;
  const fit=`<div class="grid three">
    ${input('身高（cm）','height_cm',raw.height_cm,'number','required step="0.01" min="90" max="230"')}
    ${input('体重（kg）','weight_kg',raw.weight_kg,'number','required step="0.01" min="15" max="180"')}
    ${input('实测脚长（mm）','foot_length_mm',raw.foot_length_mm,'number','required min="140" max="340"')}
    ${input('日常鞋码（EU，选填参考）','shoe_size',raw.shoe_size,'number','step="0.1" min="22" max="55"')}
    ${select('技能水平','skill_level',['初级','中级','高级'],raw.skill_level)}
    ${input('装备偏好（选填）','equipment_preference',raw.equipment_preference)}
    ${input('租赁开始','start',saved?.fields.start??localTime(f.start||t.requested_start_at),'datetime-local','required')}
    ${input('计划结束','end',saved?.fields.end??localTime(f.end||t.requested_end_at||Date.now()+86400000),'datetime-local','required')}
    ${select('固定器与雪靴接口','system',['Alpine','Touring'],saved?.fields.system??(f.system||'Alpine'))}
    ${storeSelect('pickup','期望取件门店',saved?.fields.pickup??(f.pickup||t.store_id))}
    ${storeSelect('returnStore','约定归还门店',saved?.fields.returnStore??(f.returnStore||t.store_id))}
  </div>`;
  const labels=Object.entries(categories).map(([key,label])=>`<label><input type="checkbox" name="category" value="${key}"
    ${(saved?.categories??f.categories??['SKI','BOOT']).includes(key)?'checked':''}>${label}</label>`).join('');
  return (t.reservation?panel('预约需求与到店核对',body(bookingSummary(t.reservation))):'')+panel('适配资料与装备推荐',body(form('recommend',
    fit+info('雪靴按实测脚长（mm）与适配脚长范围（mm）匹配；日常鞋码（EU）仅作参考。')+
    `<h3 class="section-label">所需类别</h3><div class="choices">${labels}</div>`+actions(fieldButton('查询两家门店装备',true)))),
    pill(t.queue_no+' 号 · '+t.name))+(state.recommendation?recommendationView():'');
}
function recommendationView() {
  const r=state.recommendation;
  const data=state.fitForm;
  const candidates=r.candidates;
  const alternatives=r.alternatives||[];
  const row=c=>[
    `<input type="checkbox" name="equipmentId" value="${c.equipment_id}" data-fit-review="${!!c.requiresFitConfirmation}" aria-label="选择 ${h(c.asset_no)}">`,
    cell(c.asset_no,c.brand+' '+c.model_name),cell(c.category_name,c.size_spec),h(c.store_name),
    cell(c.reason,'接口 '+(JSON.parse(c.compatibility_rule||'{}').system||'通用')+' · 检查有效至 '+c.valid_until),money(c.rent)+' / '+money(c.deposit)
  ];
  const columns=['选择','装备','类别 / 尺寸规格','所在门店','适配及安全','租金 / 押金'];
  const models=new Set(),counts=new Map();
  const preview=candidates.filter(c=>{
    const key=c.category+':'+c.current_store_id;
    const model=key+':'+c.model_id;
    if (models.has(model) || (counts.get(key)||0)>=2) return false;
    models.add(model);counts.set(key,(counts.get(key)||0)+1);return true;
  });
  const rest=candidates.filter(c=>!preview.includes(c));
  const plans=`<div class="recommendation-plans">${(r.storePlans||[]).map(s=>`<div><strong>${h(s.name)}</strong><p>${
    s.missing.length?'缺少可选的'+h(s.missing.map(c=>categories[c]).join('、')):
      s.trial.length?'可配齐；'+h(s.trial.map(c=>categories[c]).join('、'))+'需试穿核对':'可直接配齐所需类别'}</p></div>`).join('')}</div>`;
  const trial=alternatives.length?`<h3 class="section-label">最接近尺寸的备选装备 · 试穿核对后可选择</h3>`+
    info('以下装备满足可用状态、安全检查、承载、技能与接口要求；尺寸存在列明差异，选择后须填写试穿核对记录。')+
    table(columns,alternatives.map(row))+
    `<div class="fit-review" data-fit-review-fields hidden><label class="check"><input type="checkbox" name="fitConfirmed">员工已完成所选临近尺寸装备的试穿核对，顾客确认适配</label>`+
    input('试穿核对说明','fitNote','','text','maxlength="255" placeholder="填写试穿结果及尺寸差异核对情况"')+`</div>`:'';
  return panel('推荐装备',body(form('quote',
    `<p class="recommendation-context">本次资料：实测脚长 ${h(data.fit.foot_length_mm)} mm · 日常鞋码 ${data.fit.shoe_size?h('EU '+data.fit.shoe_size):'未填写'}（参考） · 接口 ${h(data.system)}</p>`+plans+
    (r.hasCompletePlan?info('从同一家取件门店为每个所需类别至少选择一件装备，再点击下方“核对合同与费用”。推荐有效 '+r.validMinutes+' 分钟。'):
      info('所需类别尚不能在同一门店配齐，缺少项已列在上方。可查看临近尺寸备选或核对真实资料、租期和装备需求。',true))+
    `<h3 class="section-label">符合适配条件的装备</h3>`+table(columns,preview.map(row),'暂无直接匹配的装备，请查看下方临近尺寸备选')+
    (rest.length?`<details class="section-label"><summary>查看其余符合条件的装备（${rest.length} 件）</summary>${table(columns,rest.map(row))}</details>`:'')+trial+
    `<div class="actions"><button class="btn primary" type="submit"${r.hasCompletePlan?'':' disabled'}>核对合同与费用</button><small>下一步：合同办理 → 确认合同并收费 → 确认取件</small></div>`+
    (r.excluded.length?`<details class="section-label"><summary>查看未推荐原因（${r.excluded.length} 件）</summary>${table(['装备','原因'],r.excluded.map(e=>[h(e.asset_no),h(e.reason)]))}</details>`:'')
  )) ,`<small>${h(data.categories.map(c=>categories[c]).join(' / '))}</small>`);
}
