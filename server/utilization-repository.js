// Ownership intervals preserve the store recorded at each movement, including
// the store before the first recorded movement.
export async function equipmentUtilization(db,store,from,to,cutoff) {
  const result = await db.one(`
    WITH bounds AS (SELECT julianday(?) AS start,julianday(min(?,?)) AS finish),
    moves AS (
      SELECT equipment_id,from_store_id,to_store_id,julianday(moved_at) AS moved,
        lead(julianday(moved_at)) OVER timeline AS next_move,
        row_number() OVER timeline AS sequence
      FROM equipment_location_history
      WINDOW timeline AS (PARTITION BY equipment_id ORDER BY moved_at,movement_id)
    ), locations AS (
      SELECT e.equipment_id,coalesce(m.from_store_id,e.current_store_id) AS store_id,
        julianday(e.acquired_at||'T00:00:00+08:00') AS start,m.moved AS finish
      FROM equipment e LEFT JOIN moves m ON m.equipment_id=e.equipment_id AND m.sequence=1
      UNION ALL
      SELECT equipment_id,to_store_id,moved,next_move FROM moves
    ), stock AS (
      SELECT l.equipment_id,max(l.start,b.start) AS start,
        min(coalesce(l.finish,b.finish),b.finish,coalesce(julianday(
          (SELECT max(si.inspected_at) FROM safety_inspection si
            WHERE si.equipment_id=e.equipment_id AND si.result='确认退役')
        ),julianday(e.retired_at||'T00:00:00+08:00'),b.finish)) AS finish
      FROM locations l JOIN equipment e USING(equipment_id) CROSS JOIN bounds b
      WHERE (? IS NULL OR l.store_id=?)
    ), eligible AS (
      SELECT * FROM stock WHERE finish>start
    ), rented AS (
      SELECT sum(max(0,min(s.finish,coalesce(julianday(ri.rented_to),s.finish))
        -max(s.start,julianday(ri.rented_from)))) AS days
      FROM eligible s JOIN rental_item ri USING(equipment_id)
      WHERE ri.item_status IN ('租出','已归还','已换出')
    )
    SELECT CASE WHEN sum(e.finish-e.start)>0 THEN
      round(100*coalesce((SELECT days FROM rented),0)/sum(e.finish-e.start),1)
      END AS utilization FROM eligible e`,from,to,cutoff,store,store);
  return result.utilization;
}
