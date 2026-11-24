export const repairOrderSQL = `SELECT r.*,e.asset_no,e.status AS equipment_status,e.current_store_id,
  e.version AS equipment_version,s.name AS store_name,c.name AS contractor_name
  FROM repair_order r JOIN equipment e USING(equipment_id)
  LEFT JOIN store s ON s.store_id=r.responsible_store_id
  LEFT JOIN repair_contractor c USING(contractor_id)`;

export async function backfillRepairStores(db) {
  if (!await db.one('SELECT 1 FROM repair_order WHERE responsible_store_id IS NULL LIMIT 1')) return;
  await db.batch([db.q(`UPDATE repair_order AS r SET responsible_store_id=coalesce(
      (SELECT s.store_id FROM repair_update u JOIN store s
        ON s.name=trim(substr(u.note,instr(u.note,'；责任门店：')+length('；责任门店：')))
        WHERE u.repair_order_id=r.repair_order_id AND u.note LIKE '严重程度：%；责任门店：%'
        ORDER BY u.repair_update_id LIMIT 1),
      (SELECT store_id FROM user_account WHERE user_id=r.created_by_user_id)
    ) WHERE responsible_store_id IS NULL`)]);
}
