ALTER TABLE service_task ADD COLUMN task_type VARCHAR(20) NOT NULL DEFAULT '现场接待';
--> statement-breakpoint
DROP TRIGGER IF EXISTS reservation_capacity_insert;
--> statement-breakpoint
DROP TRIGGER IF EXISTS reservation_capacity_update;
--> statement-breakpoint
DROP INDEX IF EXISTS reservation_customer_slot;
--> statement-breakpoint
DROP TRIGGER IF EXISTS one_active_reception;
--> statement-breakpoint
CREATE TRIGGER one_active_reception_insert BEFORE INSERT ON service_task
 WHEN NEW.task_type='现场接待' AND NEW.status IN ('排队中','办理中','待合同确认')
 BEGIN SELECT RAISE(ABORT,'ACTIVE_RECEPTION_EXISTS') WHERE EXISTS(
  SELECT 1 FROM service_task t WHERE t.task_type='现场接待' AND t.customer_id=NEW.customer_id AND t.store_id=NEW.store_id
   AND t.status IN ('排队中','办理中','待合同确认') AND t.task_id<>NEW.task_id); END;
--> statement-breakpoint
CREATE TRIGGER one_active_reception_update BEFORE UPDATE ON service_task
 WHEN NEW.task_type='现场接待' AND NEW.status IN ('排队中','办理中','待合同确认')
 BEGIN SELECT RAISE(ABORT,'ACTIVE_RECEPTION_EXISTS') WHERE EXISTS(
  SELECT 1 FROM service_task t WHERE t.task_type='现场接待' AND t.customer_id=NEW.customer_id AND t.store_id=NEW.store_id
   AND t.status IN ('排队中','办理中','待合同确认') AND t.task_id<>NEW.task_id); END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS item_reservation_guard;
--> statement-breakpoint
CREATE TRIGGER item_reservation_guard BEFORE INSERT ON rental_item
 WHEN NEW.item_status IN ('待支付','已预留','租出') BEGIN
 SELECT RAISE(ABORT,'ASSET_UNAVAILABLE') WHERE NOT EXISTS(
  SELECT 1 FROM equipment e JOIN safety_inspection si ON si.inspection_id=(SELECT inspection_id FROM safety_inspection
   WHERE equipment_id=e.equipment_id ORDER BY inspected_at DESC,inspection_id DESC LIMIT 1)
  JOIN rental_contract rc ON rc.contract_id=NEW.contract_id WHERE e.equipment_id=NEW.equipment_id
   AND e.status IN ('可租','已预留','临时锁定') AND e.retired_at IS NULL AND si.result='合格'
   AND si.valid_until>=date(rc.end_at,'+8 hours') AND si.valid_until>=date('now','+8 hours'));
 SELECT RAISE(ABORT,'ASSET_CONFLICT') WHERE EXISTS(SELECT 1 FROM rental_item ri JOIN rental_contract rc USING(contract_id)
  JOIN rental_contract nc ON nc.contract_id=NEW.contract_id WHERE ri.equipment_id=NEW.equipment_id
   AND ri.item_status IN ('待支付','已预留','租出') AND ri.rented_from<nc.end_at AND rc.end_at>NEW.rented_from);
 SELECT RAISE(ABORT,'ASSET_CONFLICT') WHERE EXISTS(SELECT 1 FROM rental_contract rc
  JOIN rental_contract nc ON nc.contract_id=NEW.contract_id WHERE rc.contract_id<>NEW.contract_id
   AND json_extract(rc.price_snapshot,'$.pending.type')='换装'
   AND json_extract(rc.price_snapshot,'$.pending.replacement.equipment_id')=NEW.equipment_id
   AND json_extract(rc.price_snapshot,'$.pending.at')<nc.end_at AND rc.end_at>NEW.rented_from);
 END;
--> statement-breakpoint
DROP VIEW vw_operating_metric;
--> statement-breakpoint
CREATE VIEW vw_operating_metric AS
 SELECT date(t.started_at,'+8 hours') metric_date,t.store_id,'reception_count' metric_code,count(*) metric_value,CURRENT_TIMESTAMP calculated_at
 FROM service_task t WHERE t.task_type='现场接待' GROUP BY date(t.started_at,'+8 hours'),t.store_id
 UNION ALL SELECT date(start_at,'+8 hours'),pickup_store_id,'contract_count',count(*),CURRENT_TIMESTAMP
 FROM rental_contract WHERE status NOT IN ('待支付','已取消') GROUP BY date(start_at,'+8 hours'),pickup_store_id
 UNION ALL SELECT date(moved_at,'+8 hours'),to_store_id,'cross_store_returns',count(*),CURRENT_TIMESTAMP
 FROM equipment_location_history WHERE movement_type='跨店归还' GROUP BY date(moved_at,'+8 hours'),to_store_id
 UNION ALL SELECT date('now','+8 hours'),current_store_id,'rented_equipment',sum(status='租出'),CURRENT_TIMESTAMP
 FROM equipment GROUP BY current_store_id
 UNION ALL SELECT date('now','+8 hours'),current_store_id,'equipment_count',count(*),CURRENT_TIMESTAMP
 FROM equipment WHERE retired_at IS NULL GROUP BY current_store_id;
