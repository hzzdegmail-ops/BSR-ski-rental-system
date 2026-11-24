import { audit, dateAfter, day, now } from './data.js';
import { normalizeModelSizing,sizeSpecification } from './sizing.js';

export const accounts = [
  { username: 'north.staff', display_name: '一店门店员工', role_type: 'staff', store_id: 1 },
  { username: 'south.staff', display_name: '二店门店员工', role_type: 'staff', store_id: 2 },
  { username: 'repair', display_name: '维修承包商', role_type: 'contractor', contractor_id: 1 },
  { username: 'manager', display_name: '值班经理', role_type: 'manager' }
];
const models = [
  ['SKI-145','Nordica','入门双板','145 cm','初级',{height:[145,168],weight:[35,75],system:'Alpine'}],
  ['SKI-155','Salomon','巡航双板','155 cm','初级',{height:[155,178],weight:[45,88],system:'Alpine'}],
  ['SKI-165','Rossignol','全地形双板','165 cm','中级',{height:[166,190],weight:[55,108],system:'Alpine'}],
  ['SKI-175','Atomic','性能双板','175 cm','高级',{height:[175,203],weight:[65,125],system:'Alpine'}],
  ['BOOT-240','Salomon','舒适雪靴','雪靴适配脚长 230～244 mm',null,{foot:[230,244],system:'Alpine'}],
  ['BOOT-255','Nordica','舒适雪靴','雪靴适配脚长 245～259 mm',null,{foot:[245,259],system:'Alpine'}],
  ['BOOT-270','Atomic','支撑雪靴','雪靴适配脚长 260～274 mm',null,{foot:[260,274],system:'Alpine'}],
  ['BOOT-285','Tecnica','全山雪靴','雪靴适配脚长 275～295 mm',null,{foot:[275,295],system:'Alpine'}],
  ['POLE-105','Leki','铝合金雪杖','105 cm',null,{height:[140,164]}],
  ['POLE-115','Leki','铝合金雪杖','115 cm',null,{height:[158,182]}],
  ['POLE-125','Swix','铝合金雪杖','125 cm',null,{height:[176,205]}],
  ['HELMET-M','Giro','滑雪头盔','M',null,{}],
  ['HELMET-L','Giro','滑雪头盔','L',null,{}],
  ['SKI-X','Salomon','雪地双板','155 cm','初级',{height:[155,178],weight:[45,88],system:'Touring'}]
];

async function mergeDemoContractors(db) {
  const primary = await db.one("SELECT * FROM repair_contractor WHERE contractor_code='RC-01'");
  if (!primary) return;
  const secondary = await db.one("SELECT contractor_id FROM repair_contractor WHERE contractor_code='RC-02' AND active=1");
  const changes = [];
  if (primary.name !== '维修承包商') {
    changes.push(db.q("UPDATE repair_contractor SET name='维修承包商' WHERE contractor_id=?",primary.contractor_id));
  }
  if (secondary) {
    const id = secondary.contractor_id;
    changes.push(
      db.q('UPDATE repair_order SET contractor_id=?,version=version+1 WHERE contractor_id=?',primary.contractor_id,id),
      db.q("UPDATE user_account SET active=0 WHERE contractor_id=? AND username='repair.alt'",id),
      db.q('UPDATE repair_contractor SET active=0 WHERE contractor_id=?',id)
    );
  }
  if (changes.length) await db.batch(changes);
}

export async function expandDemoInventory(db) {
  const catalog=[];
  for (const [system,tag] of [['Alpine','A'],['Touring','T']]) {
    for (let mm=190;mm<=320;mm+=10) {
      catalog.push([2,`DEMO2-BOOT-${tag}-${mm}`,'课程演示雪靴',`雪靴适配脚长 ${mm-5}～${mm+9} mm`,null,
        {foot:[mm-5,mm+9],system}]);
    }
    for (let cm=100;cm<=190;cm+=10)
      catalog.push([1,`DEMO2-SKI-${tag}-${cm}`,'课程演示双板',`${cm} cm`,'初级',
        {height:[cm+5,cm+30],weight:[15,130],system}]);
  }
  for (let cm=80;cm<=135;cm+=5)
    catalog.push([3,`DEMO2-POLE-${cm}`,'课程演示雪杖',`${cm} cm`,null,{height:[cm+35,cm+75]}]);
  for (const size of ['XS','S','M','L','XL'])
    catalog.push([4,`DEMO2-HELMET-${size}`,'课程演示头盔',size,null,{}]);
  const existing=await db.one("SELECT count(*) AS n FROM equipment JOIN equipment_model USING(model_id) WHERE model_code LIKE 'DEMO2-%'");
  if (existing.n>=catalog.length*4) return;
  const t=now();
  const queries=[];
  const hasLegacy=(await db.all('PRAGMA table_info(equipment)')).some(c=>c.name==='legacy_asset_no');
  for (const [category,code,name,size,skill,rule] of catalog) {
    queries.push(db.q(`INSERT OR IGNORE INTO equipment_model(category_id,model_code,brand,model_name,size_spec,skill_level,compatibility_rule)
      VALUES(?,?,'BSR',?,?,?,?)`,category,code,name,sizeSpecification({category_id:category,size_spec:size,compatibility_rule:rule}),skill,JSON.stringify(rule)));
    for (const store of [1,2]) for (const copy of [1,2])
      queries.push(db.q(`INSERT OR IGNORE INTO equipment(asset_no,model_id,current_store_id,status,acquired_at)
        SELECT ?,model_id,?,'可租',? FROM equipment_model WHERE model_code=? AND NOT EXISTS (
          SELECT 1 FROM equipment WHERE asset_no=? ${hasLegacy?'OR legacy_asset_no=?':''})`,
        `${code}-${store}-${copy}`,store,day(t),code,`${code}-${store}-${copy}`,...(hasLegacy?[`${code}-${store}-${copy}`]:[])));
  }
  queries.push(db.q(`INSERT INTO safety_inspection(equipment_id,inspector_user_id,result,inspected_at,valid_until,note)
    SELECT e.equipment_id,u.user_id,'合格',?,date(?,'+8 hours','+'||c.safety_interval_days||' days'),'课程演示补充库存入库检查' FROM equipment e
    JOIN equipment_model m USING(model_id) JOIN equipment_category c USING(category_id)
    JOIN user_account u ON u.store_id=e.current_store_id AND u.username=CASE e.current_store_id WHEN 1 THEN 'north.staff' ELSE 'south.staff' END
    WHERE m.model_code LIKE 'DEMO2-%' AND NOT EXISTS (SELECT 1 FROM safety_inspection s WHERE s.equipment_id=e.equipment_id)`,t,t),
    ...audit(db,null,'演示库存补充',null,'已入库',[['store',1],['store',2]],'新增多尺码双板、雪靴、雪杖和头盔'));
  await db.batch(queries);
}

export async function seed(db) {
  if (await db.one('SELECT store_id FROM store LIMIT 1')) {
    await mergeDemoContractors(db);
    await expandDemoInventory(db);
    return normalizeModelSizing(db);
  }
  const q = db.q;
  const t = now();
  const inserts = [
    q("INSERT OR IGNORE INTO store VALUES(1,'BSR-01','BSR 一店',NULL,1),(2,'BSR-02','BSR 二店',NULL,1)"),
    q("INSERT OR IGNORE INTO repair_contractor VALUES(1,'RC-01','维修承包商','000-0100',1)"),
    ...accounts.map((u, i) => q('INSERT OR IGNORE INTO user_account VALUES(?,?,?,?,?,?,1,NULL)',
      i + 1,u.username,u.store_id ?? null,u.contractor_id ?? null,u.role_type,u.display_name)),
    q("INSERT OR IGNORE INTO equipment_category VALUES(1,'SKI','双板',30,1),(2,'BOOT','雪靴',30,1),(3,'POLE','雪杖',60,1),(4,'HELMET','头盔',30,1)"),
    q("INSERT OR IGNORE INTO customer VALUES(1,'13000000001','林雪',NULL,?),(2,'13000000002','陈峰',NULL,?),(3,'13000000003','周宁',NULL,?)",t,t,t),
    q("INSERT OR IGNORE INTO customer_fit_profile VALUES(1,1,168,60,255,40,'初级','舒适',?),(2,2,182,76,270,42,'中级','全地形',?),(3,3,158,48,240,38,'初级','',?)",t,t,t),
    q("INSERT OR IGNORE INTO service_reservation(reservation_id,reservation_no,customer_id,store_id,requested_start_at,requested_end_at,source_type,status,created_at) VALUES(1,'BSR-RES-001',1,1,?,?,'线上','待接待',?),(2,'BSR-RES-002',2,2,?,?,'电话','待接待',?)",
      t,dateAfter(2,t),t,t,dateAfter(3,t),t)
  ];
  for (const [i, [code,brand,name,size,skill,rule]] of models.entries()) {
    const category = i < 4 || i === 13 ? 1 : i < 8 ? 2 : i < 11 ? 3 : 4;
    inserts.push(q('INSERT OR IGNORE INTO equipment_model VALUES(?,?,?,?,?,?,?,?)',
      i+1,category,code,brand,name,sizeSpecification({category_id:category,size_spec:size,compatibility_rule:rule}),skill,JSON.stringify(rule)));
  }
  const units = models.flatMap((model,i) => [1,2,3,4].map(unit => {
    const id = i*4+unit;
    return [id,model[0]+'-'+String(unit).padStart(2,'0'),i+1,unit<=2?1:2,id===4?'维修中':'可租',day(t)];
  }));
  inserts.push(q(`INSERT OR IGNORE INTO equipment(equipment_id,asset_no,model_id,current_store_id,status,acquired_at)
    SELECT value->>0,value->>1,value->>2,value->>3,value->>4,value->>5 FROM json_each(?)`, JSON.stringify(units)));
  inserts.push(q(`INSERT OR IGNORE INTO safety_inspection(inspection_id,equipment_id,inspector_user_id,result,inspected_at,valid_until,note)
    SELECT equipment_id,equipment_id,1,'合格',?,CASE WHEN equipment_id=5 THEN ? ELSE ? END,'演示装备入库检查'
    FROM equipment WHERE equipment_id<=56`,t,day(dateAfter(-1,t)),day(dateAfter(30,t))));
  inserts.push(q(`INSERT OR IGNORE INTO repair_order(repair_order_id,ticket_no,equipment_id,contractor_id,
    created_by_user_id,status,fault_description,opened_at,responsible_store_id,severity)
    VALUES(1,'BSR-RP-001',4,1,2,'待接收','固定器卡扣磨损',?,2,'中')`,t));
  inserts.push(q("INSERT OR IGNORE INTO repair_update VALUES(1,1,2,'待接收','严重程度：中；责任门店：BSR 二店',?)",t));
  await db.batch(inserts);
  await expandDemoInventory(db);
  await normalizeModelSizing(db);
}
