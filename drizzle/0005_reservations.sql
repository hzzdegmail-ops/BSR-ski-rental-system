ALTER TABLE service_reservation ADD COLUMN appointment_at TIMESTAMP;
--> statement-breakpoint
ALTER TABLE service_reservation ADD COLUMN requirements TEXT;
--> statement-breakpoint
ALTER TABLE service_reservation ADD COLUMN preparation TEXT;
--> statement-breakpoint
ALTER TABLE service_reservation ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TRIGGER reservation_capacity_insert BEFORE INSERT ON service_reservation
    WHEN NEW.appointment_at IS NOT NULL AND NEW.status IN ('待接待','已接待')
    BEGIN SELECT CASE WHEN (SELECT count(*) FROM service_reservation WHERE store_id=NEW.store_id
      AND appointment_at=NEW.appointment_at AND status IN ('待接待','已接待') AND reservation_id<>NEW.reservation_id)>=4
      THEN RAISE(ABORT,'RESERVATION_SLOT_FULL') END; END;
--> statement-breakpoint
CREATE TRIGGER reservation_capacity_update BEFORE UPDATE ON service_reservation
    WHEN NEW.appointment_at IS NOT NULL AND NEW.status IN ('待接待','已接待')
    BEGIN SELECT CASE WHEN (SELECT count(*) FROM service_reservation WHERE store_id=NEW.store_id
      AND appointment_at=NEW.appointment_at AND status IN ('待接待','已接待') AND reservation_id<>NEW.reservation_id)>=4
      THEN RAISE(ABORT,'RESERVATION_SLOT_FULL') END; END;
--> statement-breakpoint
CREATE UNIQUE INDEX reservation_customer_slot ON service_reservation(customer_id,store_id,appointment_at)
    WHERE appointment_at IS NOT NULL AND status IN ('待接待','已接待');
