import { inventorySQL } from './data.js';
import { rankEquipment } from './domain.js';

export async function recommend(db, fit, range, categories, pickup, system = 'Alpine') {
  const [units, occupancy] = await Promise.all([
    db.all(inventorySQL+' WHERE c.active=1 AND s.active=1 AND e.retired_at IS NULL'),
    db.all(`SELECT DISTINCT ri.equipment_id FROM rental_item ri JOIN rental_contract rc USING(contract_id)
      WHERE ri.item_status IN ('待支付','已预留','租出') AND ri.rented_from < ? AND rc.end_at > ?
      UNION SELECT json_extract(rc.price_snapshot,'$.pending.replacement.equipment_id') AS equipment_id
      FROM rental_contract rc WHERE json_extract(rc.price_snapshot,'$.pending.type')='换装'
        AND json_extract(rc.price_snapshot,'$.pending.at') < ? AND rc.end_at > ?`,range.end,range.start,range.end,range.start)
  ]);
  const occupied = new Set(occupancy.map(row=>row.equipment_id));
  return rankEquipment({units,occupied},fit,range,categories,pickup,system);
}
