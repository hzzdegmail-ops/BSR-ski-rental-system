export const now = () => new Date().toISOString();
export const day = value => new Date(Date.parse(value)+8*3600000).toISOString().slice(0,10);
export const dateAfter = (days, from = now()) => new Date(Date.parse(from) + days * 86400000).toISOString();

export class BusinessError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export function requireRule(condition, message, status) {
  if (!condition) throw new BusinessError(message, status);
}
export function dbFor(binding) {
  const statement = (sql, ...values) => binding.prepare(sql).bind(...values);
  return {
    q: statement,
    one: (sql, ...values) => statement(sql, ...values).first(),
    all: async (sql, ...values) => (await statement(sql, ...values).all()).results,
    batch: statements => binding.batch(statements)
  };
}
export function audit(db, actor, event, from, to, targets, result = '成功', storeId = actor?.store_id) {
  const addEvent = db.q(
    'INSERT INTO audit_event(actor_user_id,event_type,from_status,to_status,result,occurred_at,event_store_id) VALUES(?,?,?,?,?,?,?)',
    actor?.user_id ?? null, event, from, to, result, now(),storeId ?? null
  );
  const addTargets = db.q(
    `INSERT INTO audit_event_target(audit_event_id,entity_type,entity_id)
     SELECT (SELECT max(audit_event_id) FROM audit_event),json_extract(value,'$[0]'),json_extract(value,'$[1]')
     FROM json_each(?)`, JSON.stringify(targets)
  );
  return [addEvent, addTargets];
}

export const inventorySQL = `
  SELECT e.*, m.brand,m.model_name,m.size_spec,m.skill_level,m.compatibility_rule,
         c.category_code,c.name AS category_name,c.safety_interval_days,s.name AS store_name,
         si.valid_until,si.result AS inspection_result,
         r.ticket_no AS open_ticket,r.repair_order_id AS open_repair_id
  FROM equipment e JOIN equipment_model m USING(model_id) JOIN equipment_category c USING(category_id)
  JOIN store s ON s.store_id=e.current_store_id
  LEFT JOIN safety_inspection si ON si.inspection_id=(
    SELECT inspection_id FROM safety_inspection WHERE equipment_id=e.equipment_id
    ORDER BY inspected_at DESC,inspection_id DESC LIMIT 1
  )
  LEFT JOIN repair_order r ON r.equipment_id=e.equipment_id AND r.completed_at IS NULL
`;
export function guard(db, table, idColumn, id, version) {
  return db.q(`UPDATE ${table} SET version=CASE WHEN version=? THEN version+1 ELSE NULL END WHERE ${idColumn}=?`, version, id);
}
export function textField(value, name, max, optional = false) {
  const result = typeof value === 'string' ? value.trim() : '';
  requireRule((optional || result.length > 0) && result.length <= max, `${name}须${optional ? '' : '填写且'}在 ${max} 字以内`);
  return result || null;
}
export function positiveId(value, name) {
  const id = Number(value);
  requireRule(Number.isSafeInteger(id) && id > 0, `请选择${name}`);
  return id;
}
export async function pageRows(db, sql, params, order, requestedPage) {
  const size = 25;
  const pageNumber = requestedPage == null ? 1 : positiveId(requestedPage,'页码');
  const {total} = await db.one(`SELECT count(*) AS total FROM (${sql})`,...params);
  const pages = Math.max(1,Math.ceil(total/size));
  const page = Math.min(pageNumber,pages);
  const rows = await db.all(`${sql} ORDER BY ${order} LIMIT ? OFFSET ?`,...params,size,(page-1)*size);
  return {rows,total,page,pages};
}
export function integerList(values) {
  requireRule(Array.isArray(values) && values.length <= 30, '请核对所选装备');
  return [...new Set(values.map(value => positiveId(value, '装备')))];
}
export function inList(value, choices, name) {
  requireRule(choices.includes(value), `请选择有效的${name}`);
  return value;
}
export function iso(value, name) {
  requireRule(typeof value === 'string' && Number.isFinite(Date.parse(value)), `请填写有效的${name}`);
  return new Date(value).toISOString();
}
export async function activeStore(db, id) {
  const store = await db.one('SELECT * FROM store WHERE store_id=? AND active=1', positiveId(id, '门店'));
  requireRule(store, '所选门店不可用');
  return store.store_id;
}
export const uid = prefix => prefix + '-' + crypto.randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase();
export const snapshot = contract => JSON.parse(contract.price_snapshot);
