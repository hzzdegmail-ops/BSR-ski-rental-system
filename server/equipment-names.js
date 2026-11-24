import {audit} from './data.js';

export async function ensureEquipmentIdentitySchema(db) {
  if ((await db.all('PRAGMA table_info(equipment)')).some(c=>c.name==='legacy_asset_no')) return;
  await db.batch([db.q('ALTER TABLE equipment ADD COLUMN legacy_asset_no VARCHAR(40)'),db.q('PRAGMA user_version=7')]);
}
function sizeCode(model) {
  const numeric=model.model_code.match(/(?:^|-)(\d+)$/)?.[1]||model.size_spec.match(/(\d+)\s*cm/)?.[1];
  if (model.category_id===4) return model.size_spec.match(/\b(XS|XL|S|M|L)\b/)?.[1];
  return numeric?.padStart(3,'0');
}
export async function normalizeEquipmentNames(db) {
  const models=await db.all('SELECT * FROM equipment_model ORDER BY model_id');
  const queries=[],targets=[];
  for (const m of models.filter(m=>m.model_code.startsWith('DEMO2-'))) {
    const touring=JSON.parse(m.compatibility_rule||'{}').system==='Touring';
    const [brand,name]=({1:touring?['Salomon','雪地双板']:['Nordica','入门双板'],
      2:touring?['Tecnica','登山雪靴']:['Salomon','舒适雪靴'],3:['Leki','铝合金雪杖'],4:['Giro','滑雪头盔']})[m.category_id];
    if (brand===m.brand&&name===m.model_name) continue;
    queries.push(db.q('UPDATE equipment_model SET brand=?,model_name=? WHERE model_id=?',brand,name,m.model_id));
    targets.push(['equipment_model',m.model_id]);
  }
  const units=await db.all('SELECT * FROM equipment ORDER BY equipment_id');
  const used=new Set(units.map(u=>u.asset_no));
  for (const u of units) {
    const m=models.find(m=>m.model_id===u.model_id);
    const prefix=({1:'SKI',2:'BOOT',3:'POLE',4:'HELMET'})[m.category_id];
    const base=prefix+'-'+sizeCode(m)+'-';
    if (new RegExp('^'+base+'\\d{2,}$').test(u.asset_no)) continue;
    let serial=1,code;
    do {code=base+String(serial++).padStart(2,'0');} while(used.has(code));
    used.add(code);
    queries.push(db.q('UPDATE equipment SET legacy_asset_no=coalesce(legacy_asset_no,asset_no),asset_no=? WHERE equipment_id=?',code,u.equipment_id));
    targets.push(['equipment',u.equipment_id]);
  }
  if (!queries.length) return 0;
  await db.batch([...queries,...audit(db,null,'装备名称与编号统一',null,'已统一',targets,'品牌与型号统一；单件编号为品类-尺寸-序号，原编号保留检索')]);
  return queries.length;
}
