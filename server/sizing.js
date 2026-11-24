import { audit } from './data.js';

export function sizeSpecification(unit) {
  const category=unit.category_code||({1:'SKI',2:'BOOT',3:'POLE',4:'HELMET'})[unit.category_id];
  const rule=typeof unit.compatibility_rule==='string'?JSON.parse(unit.compatibility_rule||'{}'):unit.compatibility_rule||{};
  const raw=String(unit.size_spec||unit.size||'');
  if (category==='BOOT' && rule.foot?.length===2)
    return `雪靴适配脚长 ${rule.foot[0]}～${rule.foot[1]} mm`;
  if (category==='SKI'||category==='POLE') {
    const length=raw.match(/(\d+(?:\.\d+)?)\s*cm/i)?.[1];
    if (length) return `${category==='SKI'?'双板':'雪杖'}长度 ${Number(length)} cm`;
  }
  if (category==='HELMET') {
    const size=raw.match(/\b(XS|XL|S|M|L)\b/i)?.[1]?.toUpperCase();
    if (size) return '头盔尺码 '+size;
  }
  return raw;
}

export async function normalizeModelSizing(db) {
  const models=await db.all('SELECT * FROM equipment_model ORDER BY model_id');
  const changes=[];
  const targets=[];
  for (const model of models) {
    const rule=JSON.parse(model.compatibility_rule||'{}');
    const hadShoe=Object.hasOwn(rule,'shoe');
    delete rule.shoe;
    const size=sizeSpecification({...model,compatibility_rule:rule});
    if (size===model.size_spec && !hadShoe) continue;
    changes.push(db.q('UPDATE equipment_model SET size_spec=?,compatibility_rule=? WHERE model_id=?',
      size,JSON.stringify(rule),model.model_id));
    targets.push(['equipment_model',model.model_id]);
  }
  if (!changes.length) return 0;
  await db.batch([...changes,...audit(db,null,'尺寸口径统一',null,'已统一',targets,'雪靴按实测脚长（mm）匹配；日常鞋码（EU）仅作参考')]);
  return changes.length;
}
