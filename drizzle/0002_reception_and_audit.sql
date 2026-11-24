ALTER TABLE service_task ADD COLUMN enqueued_at TIMESTAMP;
--> statement-breakpoint
CREATE INDEX service_task_customer_store_status ON service_task(customer_id,store_id,status);
--> statement-breakpoint
CREATE TRIGGER one_active_reception BEFORE INSERT ON service_task
WHEN NEW.status IN ('排队中','办理中','待合同确认')
BEGIN
  SELECT RAISE(ABORT,'ACTIVE_RECEPTION_EXISTS') WHERE EXISTS (
    SELECT 1 FROM service_task t WHERE t.customer_id=NEW.customer_id AND t.store_id=NEW.store_id
      AND t.status IN ('排队中','办理中','待合同确认')
  );
END;
--> statement-breakpoint
ALTER TABLE audit_event ADD COLUMN event_store_id INTEGER REFERENCES store(store_id);
--> statement-breakpoint
CREATE INDEX rental_contract_status_id ON rental_contract(status,contract_id);
--> statement-breakpoint
CREATE INDEX payment_request_contract_type ON payment_request(contract_id,request_type,payment_request_id);
