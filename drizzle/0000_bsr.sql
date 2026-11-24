CREATE TABLE customer (
  customer_id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone VARCHAR(30) NOT NULL UNIQUE,
  name NVARCHAR(100) NOT NULL,
  email VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE customer_fit_profile (
  profile_id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id BIGINT NOT NULL UNIQUE REFERENCES customer(customer_id),
  height_cm DECIMAL(5,2),
  weight_kg DECIMAL(5,2),
  foot_length_mm SMALLINT,
  shoe_size DECIMAL(4,1),
  skill_level VARCHAR(20),
  equipment_preference NVARCHAR(255),
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE store (
  store_id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_code VARCHAR(20) NOT NULL UNIQUE,
  name NVARCHAR(100) NOT NULL,
  address NVARCHAR(255),
  active BOOLEAN NOT NULL DEFAULT 1
);
--> statement-breakpoint
CREATE TABLE repair_contractor (
  contractor_id INTEGER PRIMARY KEY AUTOINCREMENT,
  contractor_code VARCHAR(30) NOT NULL UNIQUE,
  name NVARCHAR(120) NOT NULL,
  contact_phone VARCHAR(30) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT 1
);
--> statement-breakpoint
CREATE TABLE user_account (
  user_id INTEGER PRIMARY KEY AUTOINCREMENT,
  username VARCHAR(80) NOT NULL UNIQUE,
  store_id BIGINT REFERENCES store(store_id),
  contractor_id BIGINT REFERENCES repair_contractor(contractor_id),
  role_type VARCHAR(30) NOT NULL CHECK(role_type IN ('staff','contractor','manager')),
  display_name NVARCHAR(100) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT 1,
  last_login_at TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE service_reservation (
  reservation_id INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_no VARCHAR(40) NOT NULL UNIQUE,
  customer_id BIGINT NOT NULL REFERENCES customer(customer_id),
  store_id BIGINT NOT NULL REFERENCES store(store_id),
  requested_start_at TIMESTAMP NOT NULL,
  requested_end_at TIMESTAMP NOT NULL,
  source_type VARCHAR(20) NOT NULL,
  status VARCHAR(30) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(requested_start_at < requested_end_at)
);
--> statement-breakpoint
CREATE TABLE service_task (
  task_id INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id BIGINT REFERENCES service_reservation(reservation_id),
  customer_id BIGINT NOT NULL REFERENCES customer(customer_id),
  store_id BIGINT NOT NULL REFERENCES store(store_id),
  assigned_user_id BIGINT REFERENCES user_account(user_id),
  queue_no INTEGER NOT NULL,
  current_stage VARCHAR(30) NOT NULL,
  status VARCHAR(30) NOT NULL,
  started_at TIMESTAMP NOT NULL,
  finished_at TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE equipment_category (
  category_id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_code VARCHAR(30) NOT NULL UNIQUE,
  name NVARCHAR(80) NOT NULL,
  safety_interval_days INTEGER NOT NULL CHECK(safety_interval_days > 0),
  active BOOLEAN NOT NULL DEFAULT 1
);
--> statement-breakpoint
CREATE TABLE equipment_model (
  model_id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id BIGINT NOT NULL REFERENCES equipment_category(category_id),
  model_code VARCHAR(40) NOT NULL UNIQUE,
  brand NVARCHAR(80) NOT NULL,
  model_name NVARCHAR(120) NOT NULL,
  size_spec VARCHAR(30) NOT NULL,
  skill_level VARCHAR(20),
  compatibility_rule TEXT CHECK(compatibility_rule IS NULL OR json_valid(compatibility_rule))
);
--> statement-breakpoint
CREATE TABLE equipment (
  equipment_id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_no VARCHAR(40) NOT NULL UNIQUE,
  model_id BIGINT NOT NULL REFERENCES equipment_model(model_id),
  current_store_id BIGINT NOT NULL REFERENCES store(store_id),
  status VARCHAR(30) NOT NULL,
  acquired_at DATE NOT NULL,
  retired_at DATE,
  version INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE rental_contract (
  contract_id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_no VARCHAR(40) NOT NULL UNIQUE,
  service_task_id BIGINT NOT NULL UNIQUE REFERENCES service_task(task_id),
  customer_id BIGINT NOT NULL REFERENCES customer(customer_id),
  pickup_store_id BIGINT NOT NULL REFERENCES store(store_id),
  return_store_id BIGINT REFERENCES store(store_id),
  start_at TIMESTAMP NOT NULL,
  end_at TIMESTAMP NOT NULL,
  status VARCHAR(30) NOT NULL,
  amount_due DECIMAL(12,2) NOT NULL DEFAULT 0,
  price_snapshot TEXT NOT NULL CHECK(json_valid(price_snapshot)),
  version INTEGER NOT NULL DEFAULT 0,
  CHECK(start_at < end_at)
);
--> statement-breakpoint
CREATE TABLE equipment_location_history (
  movement_id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_id BIGINT NOT NULL REFERENCES equipment(equipment_id),
  from_store_id BIGINT REFERENCES store(store_id),
  to_store_id BIGINT NOT NULL REFERENCES store(store_id),
  contract_id BIGINT REFERENCES rental_contract(contract_id),
  recorded_by_user_id BIGINT NOT NULL REFERENCES user_account(user_id),
  movement_type VARCHAR(30) NOT NULL,
  moved_at TIMESTAMP NOT NULL,
  note NVARCHAR(255)
);
--> statement-breakpoint
CREATE TABLE rental_item (
  rental_item_id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id BIGINT NOT NULL REFERENCES rental_contract(contract_id),
  equipment_id BIGINT NOT NULL REFERENCES equipment(equipment_id),
  replaces_item_id BIGINT REFERENCES rental_item(rental_item_id),
  rented_from TIMESTAMP NOT NULL,
  rented_to TIMESTAMP,
  quoted_price DECIMAL(12,2) NOT NULL,
  item_status VARCHAR(30) NOT NULL,
  UNIQUE(contract_id, equipment_id, rented_from)
);
--> statement-breakpoint
CREATE TABLE payment_request (
  payment_request_id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_no VARCHAR(64) NOT NULL UNIQUE,
  contract_id BIGINT NOT NULL REFERENCES rental_contract(contract_id),
  request_type VARCHAR(20) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  status VARCHAR(30) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE payment_transaction (
  transaction_id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_request_id BIGINT NOT NULL REFERENCES payment_request(payment_request_id),
  provider_transaction_no VARCHAR(80) UNIQUE,
  attempt_no INTEGER NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  status VARCHAR(30) NOT NULL,
  response_code VARCHAR(40),
  processed_at TIMESTAMP,
  UNIQUE(payment_request_id, attempt_no)
);
--> statement-breakpoint
CREATE TABLE repair_order (
  repair_order_id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_no VARCHAR(40) NOT NULL UNIQUE,
  equipment_id BIGINT NOT NULL REFERENCES equipment(equipment_id),
  contractor_id BIGINT REFERENCES repair_contractor(contractor_id),
  created_by_user_id BIGINT NOT NULL REFERENCES user_account(user_id),
  status VARCHAR(30) NOT NULL,
  fault_description NVARCHAR(500) NOT NULL,
  opened_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP,
  version INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE repair_update (
  repair_update_id INTEGER PRIMARY KEY AUTOINCREMENT,
  repair_order_id BIGINT NOT NULL REFERENCES repair_order(repair_order_id),
  submitted_by_user_id BIGINT NOT NULL REFERENCES user_account(user_id),
  progress_status VARCHAR(30) NOT NULL,
  note NVARCHAR(500) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE safety_inspection (
  inspection_id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_id BIGINT NOT NULL REFERENCES equipment(equipment_id),
  repair_order_id BIGINT REFERENCES repair_order(repair_order_id),
  inspector_user_id BIGINT NOT NULL REFERENCES user_account(user_id),
  result VARCHAR(30) NOT NULL,
  inspected_at TIMESTAMP NOT NULL,
  valid_until DATE,
  note NVARCHAR(500)
);
--> statement-breakpoint
CREATE TABLE audit_event (
  audit_event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id BIGINT REFERENCES user_account(user_id),
  event_type VARCHAR(40) NOT NULL,
  from_status VARCHAR(30),
  to_status VARCHAR(30),
  result VARCHAR(30) NOT NULL,
  occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE audit_event_target (
  audit_target_id INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_event_id BIGINT NOT NULL REFERENCES audit_event(audit_event_id),
  entity_type VARCHAR(40) NOT NULL,
  entity_id BIGINT NOT NULL,
  UNIQUE(audit_event_id, entity_type, entity_id)
);
--> statement-breakpoint
CREATE INDEX rental_item_asset_status ON rental_item(equipment_id,item_status,rented_from);
--> statement-breakpoint
CREATE INDEX safety_inspection_latest ON safety_inspection(equipment_id,inspected_at DESC,inspection_id DESC);
--> statement-breakpoint
CREATE INDEX audit_target_entity ON audit_event_target(entity_type,entity_id);
--> statement-breakpoint
CREATE UNIQUE INDEX open_repair_per_asset ON repair_order(equipment_id) WHERE completed_at IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX active_task_per_reservation ON service_task(reservation_id) WHERE status <> '已取消';
--> statement-breakpoint
CREATE UNIQUE INDEX one_success_per_payment ON payment_transaction(payment_request_id) WHERE status = '成功';
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
      AND si.result='合格' AND si.valid_until>=date(rc.end_at) AND si.valid_until>=date('now')
  );
  SELECT RAISE(ABORT,'ASSET_CONFLICT') WHERE EXISTS (
    SELECT 1 FROM rental_item ri
    JOIN rental_contract rc ON rc.contract_id=ri.contract_id
    JOIN rental_contract new_rc ON new_rc.contract_id=NEW.contract_id
    WHERE ri.equipment_id=NEW.equipment_id AND ri.item_status IN ('待支付','已预留','租出')
      AND ri.rented_from<new_rc.end_at AND rc.end_at>NEW.rented_from
  );
END;
--> statement-breakpoint
CREATE TRIGGER audit_event_immutable_update BEFORE UPDATE ON audit_event
BEGIN SELECT RAISE(ABORT,'AUDIT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER audit_event_immutable_delete BEFORE DELETE ON audit_event
BEGIN SELECT RAISE(ABORT,'AUDIT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER audit_target_immutable_update BEFORE UPDATE ON audit_event_target
BEGIN SELECT RAISE(ABORT,'AUDIT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER audit_target_immutable_delete BEFORE DELETE ON audit_event_target
BEGIN SELECT RAISE(ABORT,'AUDIT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE VIEW vw_operating_metric AS
SELECT date(st.started_at) AS metric_date, st.store_id, 'reception_count' AS metric_code,
       count(*) AS metric_value, CURRENT_TIMESTAMP AS calculated_at
FROM service_task st GROUP BY date(st.started_at), st.store_id
UNION ALL
SELECT date(start_at),pickup_store_id,'contract_count',count(*),CURRENT_TIMESTAMP
FROM rental_contract WHERE status NOT IN ('待支付','已取消') GROUP BY date(start_at), pickup_store_id
UNION ALL
SELECT date(moved_at),to_store_id,'cross_store_returns',count(*),CURRENT_TIMESTAMP
FROM equipment_location_history WHERE movement_type='跨店归还' GROUP BY date(moved_at),to_store_id
UNION ALL
SELECT date('now'),current_store_id,'rented_equipment',sum(status='租出'),CURRENT_TIMESTAMP
FROM equipment GROUP BY current_store_id
UNION ALL
SELECT date('now'),current_store_id,'equipment_count',count(*),CURRENT_TIMESTAMP
FROM equipment WHERE retired_at IS NULL GROUP BY current_store_id;
