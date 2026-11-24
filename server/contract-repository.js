import { positiveId, requireRule, snapshot, textField } from './data.js';
import { paymentHoldUntil } from './payment.js';
import { sizeSpecification } from './sizing.js';

export const contractSQL = `SELECT rc.*,c.name AS customer_name,c.phone,
  ps.name AS pickup_name,rs.name AS return_name,st.store_id AS task_store_id,st.task_type,st.status AS task_status,st.reservation_id
  FROM rental_contract rc JOIN customer c USING(customer_id) JOIN store ps ON ps.store_id=rc.pickup_store_id
  JOIN service_task st ON st.task_id=rc.service_task_id LEFT JOIN store rs ON rs.store_id=rc.return_store_id`;
const itemSQL = `SELECT ri.*,e.asset_no,e.legacy_asset_no,e.current_store_id,e.status AS equipment_status,e.version AS equipment_version,
  m.brand,m.model_name,m.size_spec,m.compatibility_rule,c.category_code,s.name AS store_name
  FROM rental_item ri JOIN equipment e USING(equipment_id) JOIN equipment_model m USING(model_id)
  JOIN equipment_category c USING(category_id) JOIN store s ON s.store_id=e.current_store_id WHERE ri.contract_id=?`;
export const contractById = (db,id) => db.one(contractSQL+' WHERE rc.contract_id=?',id);
export const contractItems = async (db,id) => (await db.all(itemSQL+' ORDER BY ri.rental_item_id',id))
  .map(item=>({...item,size_spec:sizeSpecification(item)}));
export async function contractDetail(db,id) {
  const [contract,items,payments] = await Promise.all([
    contractById(db,id),contractItems(db,id),
    db.all(`SELECT p.*,t.provider_transaction_no,t.response_code,t.processed_at,t.attempt_no FROM payment_request p
      LEFT JOIN payment_transaction t ON t.transaction_id=(
        SELECT transaction_id FROM payment_transaction WHERE payment_request_id=p.payment_request_id ORDER BY attempt_no DESC LIMIT 1
      ) WHERE p.contract_id=? ORDER BY p.payment_request_id DESC`,id)
  ]);
  requireRule(contract,'合同不存在',404);
  const price=snapshot(contract);
  const code=value=>items.find(item=>item.legacy_asset_no===value||item.asset_no===value)?.asset_no||value;
  for (const key of ['lines','currentLines']) if (price[key])
    price[key]=price[key].map(line=>{
      const item=items.find(item=>item.equipment_id===line.equipment_id);
      return {...line,asset_no:item?.asset_no||code(line.asset_no),model:item?[item.brand,item.model_name].filter(Boolean).join(' '):line.model,size:item?.size_spec||line.size};
    });
  for (const adjustment of price.adjustments||[]) {
    if (adjustment.from) adjustment.from=code(adjustment.from);
    if (adjustment.to) adjustment.to=code(adjustment.to);
    for (const detail of adjustment.details||[]) detail.asset_no=code(detail.asset_no);
  }
  const held=payments.find(p=>
    (contract.status==='待支付' && p.request_type==='收费' && ['待支付','处理中'].includes(p.status)) ||
    (price.pending?.type==='换装' && price.pending.requestNo===p.request_no));
  return { contract,items,payments,price,holdUntil:held?paymentHoldUntil(held.created_at):null };
}
export async function findContract(db,raw) {
  const key = textField(raw.key,'合同号或装备编号',40);
  const exact = await db.one(contractSQL+' WHERE upper(rc.contract_no)=upper(?)',key);
  if (exact) return contractDetail(db,exact.contract_id);
  const match = await db.one(`SELECT ri.contract_id FROM rental_item ri
    JOIN equipment e USING(equipment_id) JOIN rental_contract rc USING(contract_id)
    WHERE upper(e.asset_no)=upper(?) OR upper(e.legacy_asset_no)=upper(?) OR CAST(e.equipment_id AS TEXT)=?
    ORDER BY CASE
      WHEN ri.item_status='租出' AND rc.status IN ('租出','处理异常') THEN 1
      WHEN ri.item_status='已预留' AND rc.status='已确认' THEN 2
      WHEN ri.item_status='待支付' AND rc.status='待支付' THEN 3
      ELSE 4 END,
      coalesce(ri.rented_to,ri.rented_from) DESC,ri.rental_item_id DESC LIMIT 1`,key,key,key);
  requireRule(match,'未找到对应合同，请核对合同号或装备编号',404);
  return contractDetail(db,match.contract_id);
}
const activeContracts = `rc.status IN ('待支付','已确认','租出','处理异常') OR EXISTS (
  SELECT 1 FROM payment_request p WHERE p.contract_id=rc.contract_id AND p.request_type<>'收费'
    AND p.status IN ('待支付','处理中','失败')
    AND (json_extract(rc.price_snapshot,'$.pending.requestNo')=p.request_no OR EXISTS (
      SELECT 1 FROM json_each(rc.price_snapshot,'$.adjustments') a
      WHERE json_extract(a.value,'$.requestNo')=p.request_no AND coalesce(json_extract(a.value,'$.cancelled'),0)=0
    ))
)`;
const contractScopes = {
  active:activeContracts,
  history:`NOT (${activeContracts})`,
  rental:"rc.status IN ('租出','处理异常')"
};

export async function contractList(db, filter={}) {
  // Keep the original list response for clients without a scope.
  if (filter.scope===undefined) return db.all(`SELECT * FROM (${contractSQL} WHERE ${contractScopes.active}
    UNION ALL SELECT * FROM (${contractSQL} WHERE ${contractScopes.history} ORDER BY rc.contract_id DESC LIMIT 100))
    ORDER BY contract_id DESC`);
  requireRule(Object.hasOwn(contractScopes,filter.scope),'请选择有效的合同范围');
  const page=filter.page==null?1:positiveId(filter.page,'页码');
  requireRule(page<=100000,'页码超出范围');
  const key=textField(filter.key,'查询关键词',80,true)?.toLowerCase()??null;
  const size=25;
  const rows=await db.all(`${contractSQL} WHERE (${contractScopes[filter.scope]})
    AND (? IS NULL OR instr(lower(rc.contract_no),?)>0 OR instr(lower(c.name),?)>0)
    ORDER BY rc.contract_id DESC LIMIT ? OFFSET ?`,key,key,key,size+1,(page-1)*size);
  return {rows:rows.slice(0,size),page,hasMore:rows.length>size};
}
