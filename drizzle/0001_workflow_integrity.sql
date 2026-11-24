ALTER TABLE service_task ADD COLUMN recommendation_revision INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE repair_order ADD COLUMN responsible_store_id INTEGER REFERENCES store(store_id);
--> statement-breakpoint
DROP VIEW vw_operating_metric;
--> statement-breakpoint
CREATE VIEW vw_operating_metric AS
SELECT date(t.started_at,'+8 hours') AS metric_date,t.store_id,'reception_count' AS metric_code,
       count(*) AS metric_value,CURRENT_TIMESTAMP AS calculated_at
FROM service_task t GROUP BY date(t.started_at,'+8 hours'),t.store_id
UNION ALL
SELECT date(start_at,'+8 hours'),pickup_store_id,'contract_count',count(*),CURRENT_TIMESTAMP
FROM rental_contract WHERE status NOT IN ('待支付','已取消') GROUP BY date(start_at,'+8 hours'),pickup_store_id
UNION ALL
SELECT date(moved_at,'+8 hours'),to_store_id,'cross_store_returns',count(*),CURRENT_TIMESTAMP
FROM equipment_location_history WHERE movement_type='跨店归还' GROUP BY date(moved_at,'+8 hours'),to_store_id
UNION ALL
SELECT date('now','+8 hours'),current_store_id,'rented_equipment',sum(status='租出'),CURRENT_TIMESTAMP
FROM equipment GROUP BY current_store_id
UNION ALL
SELECT date('now','+8 hours'),current_store_id,'equipment_count',count(*),CURRENT_TIMESTAMP
FROM equipment WHERE retired_at IS NULL GROUP BY current_store_id;
--> statement-breakpoint
DROP TRIGGER item_reservation_guard;
--> statement-breakpoint
CREATE TRIGGER item_reservation_guard BEFORE INSERT ON rental_item
WHEN NEW.item_status IN ('待支付','已预留','租出')
BEGIN
  SELECT RAISE(ABORT,'ASSET_UNAVAILABLE') WHERE NOT EXISTS (
    SELECT 1 FROM equipment e
    JOIN safety_inspection si ON si.inspection_id = (
      SELECT inspection_id FROM safety_inspection WHERE equipment_id=e.equipment_id
      ORDER BY inspected_at DESC,inspection_id DESC LIMIT 1
    )
    JOIN rental_contract rc ON rc.contract_id=NEW.contract_id
    WHERE e.equipment_id=NEW.equipment_id AND e.status='可租' AND e.retired_at IS NULL
      AND si.result='合格' AND si.valid_until>=date(rc.end_at,'+8 hours') AND si.valid_until>=date('now','+8 hours')
  );
  SELECT RAISE(ABORT,'ASSET_CONFLICT') WHERE EXISTS (
    SELECT 1 FROM rental_item ri
    JOIN rental_contract rc ON rc.contract_id=ri.contract_id
    JOIN rental_contract new_rc ON new_rc.contract_id=NEW.contract_id
    WHERE ri.equipment_id=NEW.equipment_id AND ri.item_status IN ('待支付','已预留','租出')
      AND ri.rented_from<new_rc.end_at AND rc.end_at>NEW.rented_from
  );
END;
