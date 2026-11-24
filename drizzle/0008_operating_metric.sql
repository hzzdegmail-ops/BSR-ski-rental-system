DROP VIEW vw_operating_metric;
CREATE VIEW vw_operating_metric AS
 SELECT date(t.started_at,'+8 hours') metric_date,t.store_id,'reception_count' metric_code,count(*) metric_value,CURRENT_TIMESTAMP calculated_at
 FROM service_task t WHERE t.task_type='现场接待' GROUP BY date(t.started_at,'+8 hours'),t.store_id
 UNION ALL SELECT date(start_at,'+8 hours'),pickup_store_id,'contract_count',count(*),CURRENT_TIMESTAMP
 FROM rental_contract WHERE status NOT IN ('待支付','已取消') GROUP BY date(start_at,'+8 hours'),pickup_store_id
 UNION ALL SELECT date(moved_at,'+8 hours'),to_store_id,'cross_store_returns',count(*),CURRENT_TIMESTAMP
 FROM equipment_location_history WHERE movement_type='跨店归还' AND from_store_id IS NOT NULL AND from_store_id<>to_store_id GROUP BY date(moved_at,'+8 hours'),to_store_id
 UNION ALL SELECT date('now','+8 hours'),current_store_id,'rented_equipment',sum(status='租出'),CURRENT_TIMESTAMP
 FROM equipment GROUP BY current_store_id
 UNION ALL SELECT date('now','+8 hours'),current_store_id,'equipment_count',count(*),CURRENT_TIMESTAMP
 FROM equipment WHERE retired_at IS NULL GROUP BY current_store_id;
