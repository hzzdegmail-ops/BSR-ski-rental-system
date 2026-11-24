import { requireRule, textField, inList, now, day, iso } from './data.js';
import { demo } from './demo-config.js';
import { sizeSpecification } from './sizing.js';

export const skills = ['初级','中级','高级'];
export const categories = { SKI:'双板', BOOT:'雪靴', POLE:'雪杖', HELMET:'头盔' };
export const rulesText = `演示计费规则：每 ${demo.billingHours} 小时计为一天，不足按一天。完好归还退还押金。跨店归还记录实际门店。换装按剩余租期计价差；逾期按日租金补收，损坏费用由员工检查后确认。`;
export const cents = amount => Math.round(Number(amount) * 100);
export const money = amount => cents(amount)/100;
export const rentDays = (from,to) => Math.max(1,Math.ceil((Date.parse(to)-Date.parse(from))/(demo.billingHours*3600000)));
export function rentalDates(start,end) {
  const from = iso(start, '租赁开始时间');
  const to = iso(end, '计划结束时间');
  requireRule(from < to && to > now(),'租期须在未来结束，且开始时间早于结束时间');
  return { start:from,end:to };
}
export function fitProfile(raw = {}) {
  const value = (key, name, min, max) => {
    const n = Number(raw[key]);
    requireRule(Number.isFinite(n) && n >= min && n <= max,`请填写有效的${name}（${min} 至 ${max}）`);
    return n;
  };
  return {
    height_cm:value('height_cm','身高',90,230),
    weight_kg:value('weight_kg','体重',15,180),
    foot_length_mm:Math.round(value('foot_length_mm','实测脚长（mm）',140,340)),
    shoe_size:raw.shoe_size==null||String(raw.shoe_size).trim()===''?null:value('shoe_size','日常鞋码（EU）',22,55),
    skill_level:inList(raw.skill_level,skills,'技能水平'),
    equipment_preference:textField(raw.equipment_preference,'装备偏好',255,true)
  };
}

function suitability(unit, fit, system) {
  const rule = JSON.parse(unit.compatibility_rule || '{}');
  const inRange = (v, range) => !range || (v >= range[0] && v <= range[1]);
  if (unit.skill_level && skills.indexOf(unit.skill_level) > skills.indexOf(fit.skill_level)) return '装备技能等级高于顾客当前技能';
  if (!inRange(fit.height_cm,rule.height) || !inRange(fit.weight_kg,rule.weight)
      || !inRange(fit.foot_length_mm,rule.foot)) return '尺寸或承载范围与适配档案不符';
  if (rule.system && rule.system !== system) return '固定器与雪靴接口不兼容';
  return null;
}
function sizeDifferences(unit,fit) {
  const rule=JSON.parse(unit.compatibility_rule||'{}');
  return [['height_cm','height','身高','cm',5],['foot_length_mm','foot','实测脚长','mm',5]]
    .flatMap(([field,key,label,unit,step])=>{
      const range=rule[key];
      if (!range || fit[field]>=range[0] && fit[field]<=range[1]) return [];
      const distance=Math.max(range[0]-fit[field],fit[field]-range[1]);
      return [{field,label,requested:fit[field],range,unit,distance,score:distance/step}];
    });
}
export function linePrice(unit, days) {
  const level = Math.max(0,skills.indexOf(unit.skill_level));
  const daily = demo.rates[unit.category_code] + level * demo.skillPremium;
  return {
    equipment_id:unit.equipment_id, asset_no:unit.asset_no, model:[unit.brand,unit.model_name].filter(Boolean).join(' '), size:sizeSpecification(unit),
    category:unit.category_code,daily,days,rent:daily*days,deposit:demo.deposits[unit.category_code]
  };
}
export function rankEquipment({ units,occupied }, fit, range, selectedCategories, pickup, system) {
  const candidates = [], excluded = [], nearby=[];
  const days = rentDays(range.start,range.end);
  for (const source of units) {
    const unit={...source,size_spec:sizeSpecification(source)};
    if (!selectedCategories.includes(unit.category_code)) continue;
    const reason = suitability(unit,fit,system);
    const safe = unit.inspection_result === '合格' && unit.valid_until >= day(range.end) && unit.valid_until >= day(now());
    const available=['可租','已预留','临时锁定'].includes(unit.status);
    const issue = !available ? unit.status : occupied.has(unit.equipment_id) ? '租期冲突' : !safe ? '安全检查无效或租期内到期' : reason;
    const rule=JSON.parse(unit.compatibility_rule||'{}');
    const differences=sizeDifferences(unit,fit);
    const hardFit=(!unit.skill_level || skills.indexOf(unit.skill_level)<=skills.indexOf(fit.skill_level)) &&
      (!rule.system || rule.system===system) && (!rule.weight || fit.weight_kg>=rule.weight[0] && fit.weight_kg<=rule.weight[1]);
    if (available && !occupied.has(unit.equipment_id) && safe && hardFit && differences.length) {
      nearby.push({...unit,...linePrice(unit,days),requiresFitConfirmation:true,differences,
        distanceScore:differences.reduce((n,d)=>n+d.score,0),
        reason:differences.map(d=>`${d.label} ${d.requested} ${d.unit}，${d.field==='foot_length_mm'?'雪靴适配脚长':'适用身高'} ${d.range.join('～')} ${d.unit}`).join('；')});
      continue;
    }
    if (issue) {
      excluded.push({ equipment_id:unit.equipment_id,asset_no:unit.asset_no,reason:issue,check:unit.status==='可租' && !occupied.has(unit.equipment_id) && !safe });
      continue;
    }
    const preferred = !!fit.equipment_preference && (unit.brand+' '+unit.model_name).includes(fit.equipment_preference);
    candidates.push({
      ...unit, ...linePrice(unit,days),
      reason:(unit.category_code==='HELMET'?'按规格推荐，到店确认头围':'规格与适配档案相符') + (preferred?' · 符合装备偏好':'') + (unit.current_store_id===pickup?' · 取件门店':' · 另一家门店'),
      score:Number(unit.current_store_id===pickup)*4 + Number(preferred)*2 + Number(unit.skill_level===fit.skill_level)
    });
  }
  const alternatives=[];
  const seen=new Map();
  for (const unit of nearby.sort((a,b)=>a.distanceScore-b.distanceScore || Number(b.current_store_id===pickup)-Number(a.current_store_id===pickup) || a.equipment_id-b.equipment_id)) {
    if (candidates.some(c=>c.category===unit.category && c.current_store_id===unit.current_store_id)) continue;
    const key=unit.current_store_id+':'+unit.category;
    const models=seen.get(key)||new Set();
    if (models.size>=3 || models.has(unit.model_id)) continue;
    models.add(unit.model_id);seen.set(key,models);alternatives.push(unit);
  }
  return { candidates:candidates.sort((a,b)=>b.score-a.score || a.daily-b.daily || a.equipment_id-b.equipment_id),alternatives,excluded };
}
export function quote(candidates, ids, selectedCategories, returnStore) {
  const lines = ids.map(id => candidates.find(c=>c.equipment_id===id));
  requireRule(lines.every(Boolean), '所选装备已不符合要求，请刷新推荐后重新选择');
  requireRule(selectedCategories.every(c=>lines.some(line=>line.category===c)),
    '请为每个所需类别至少选择一件装备');
  const stores = new Set(lines.map(l=>l.current_store_id));
  requireRule(stores.size===1,'所选装备须位于同一家取件门店，请调整方案');
  const fields = ['equipment_id','asset_no','model','size','category','daily','days','rent','deposit','requiresFitConfirmation','differences'];
  const rent = lines.reduce((sum,line)=>sum+line.rent,0);
  const deposit = lines.reduce((sum,line)=>sum+line.deposit,0);
  return { lines:lines.map(line=>Object.fromEntries(fields.map(k=>[k,line[k]]))),rent,deposit,total:rent+deposit,
    agreedReturnStore:returnStore,rules:rulesText,pickup:lines[0].current_store_id };
}

export function exchangeDelta(replacement, original) {
  return money(replacement.rent-original.daily*replacement.days+replacement.deposit-original.deposit);
}

export function exchangedCondition(reason, condition) {
  if (reason==='装备故障'||reason?.startsWith('装备故障 · ')) return '损坏或存在安全隐患';
  return condition;
}

export function returnFees(line, end, at, damage) {
  return {
    damage:money(damage),
    overdue:at>end?line.daily*rentDays(end,at):0,
    deposit:line.deposit
  };
}
