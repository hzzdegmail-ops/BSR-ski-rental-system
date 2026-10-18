DROP VIEW IF EXISTS `vw_operating_metric`;--> statement-breakpoint
ALTER TABLE `customer_fit_profile` RENAME TO `__old_customer_fit_profile`;--> statement-breakpoint
ALTER TABLE `equipment_model` RENAME TO `__old_equipment_model`;--> statement-breakpoint
ALTER TABLE `equipment` RENAME TO `__old_equipment`;--> statement-breakpoint
ALTER TABLE `rental_contract` RENAME TO `__old_rental_contract`;--> statement-breakpoint
ALTER TABLE `rental_item` RENAME TO `__old_rental_item`;--> statement-breakpoint
ALTER TABLE `payment_request` RENAME TO `__old_payment_request`;--> statement-breakpoint
ALTER TABLE `payment_transaction` RENAME TO `__old_payment_transaction`;--> statement-breakpoint
ALTER TABLE `equipment_location_history` RENAME TO `__old_equipment_location_history`;--> statement-breakpoint
ALTER TABLE `repair_order` RENAME TO `__old_repair_order`;--> statement-breakpoint
ALTER TABLE `repair_update` RENAME TO `__old_repair_update`;--> statement-breakpoint
ALTER TABLE `safety_inspection` RENAME TO `__old_safety_inspection`;--> statement-breakpoint

CREATE TABLE `customer_fit_profile` (
	`profile_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer NOT NULL,
	`height_cm` real,
	`weight_kg` real,
	`foot_length_mm` integer,
	`shoe_size` real,
	`skill_level` text,
	`equipment_preference` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customer`(`customer_id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE TABLE `equipment_model` (
	`model_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category_id` integer NOT NULL,
	`model_code` text NOT NULL,
	`brand` text NOT NULL,
	`model_name` text NOT NULL,
	`size_spec` text NOT NULL,
	`skill_level` text,
	`compatibility_rule` text,
	FOREIGN KEY (`category_id`) REFERENCES `equipment_category`(`category_id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE TABLE `equipment` (
	`equipment_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`asset_no` text NOT NULL,
	`model_id` integer NOT NULL,
	`current_store_id` integer NOT NULL,
	`status` text DEFAULT 'AVAILABLE' NOT NULL,
	`acquired_at` text NOT NULL,
	`retired_at` text,
	`version` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`model_id`) REFERENCES `equipment_model`(`model_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_store_id`) REFERENCES `store`(`store_id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE TABLE `rental_contract` (
	`contract_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contract_no` text NOT NULL,
	`service_task_id` integer NOT NULL,
	`customer_id` integer NOT NULL,
	`pickup_store_id` integer NOT NULL,
	`return_store_id` integer,
	`start_at` text NOT NULL,
	`end_at` text NOT NULL,
	`status` text NOT NULL,
	`amount_due` real DEFAULT 0 NOT NULL,
	`price_snapshot` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`service_task_id`) REFERENCES `service_task`(`task_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customer`(`customer_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pickup_store_id`) REFERENCES `store`(`store_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`return_store_id`) REFERENCES `store`(`store_id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE TABLE `rental_item` (
	`rental_item_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contract_id` integer NOT NULL,
	`equipment_id` integer NOT NULL,
	`replaces_item_id` integer,
	`rented_from` text NOT NULL,
	`rented_to` text,
	`quoted_price` real NOT NULL,
	`item_status` text NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `rental_contract`(`contract_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`equipment_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`replaces_item_id`) REFERENCES `rental_item`(`rental_item_id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE TABLE `payment_request` (
	`payment_request_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_no` text NOT NULL,
	`contract_id` integer NOT NULL,
	`request_type` text NOT NULL,
	`amount` real NOT NULL,
	`status` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `rental_contract`(`contract_id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE TABLE `payment_transaction` (
	`transaction_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`payment_request_id` integer NOT NULL,
	`provider_transaction_no` text,
	`attempt_no` integer NOT NULL,
	`amount` real NOT NULL,
	`status` text NOT NULL,
	`response_code` text,
	`processed_at` text,
	FOREIGN KEY (`payment_request_id`) REFERENCES `payment_request`(`payment_request_id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE TABLE `equipment_location_history` (
	`movement_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`equipment_id` integer NOT NULL,
	`from_store_id` integer,
	`to_store_id` integer NOT NULL,
	`contract_id` integer,
	`recorded_by_user_id` integer NOT NULL,
	`movement_type` text NOT NULL,
	`moved_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`note` text,
	FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`equipment_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_store_id`) REFERENCES `store`(`store_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_store_id`) REFERENCES `store`(`store_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contract_id`) REFERENCES `rental_contract`(`contract_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by_user_id`) REFERENCES `user_account`(`user_id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE TABLE `repair_order` (
	`repair_order_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticket_no` text NOT NULL,
	`equipment_id` integer NOT NULL,
	`contractor_id` integer,
	`created_by_user_id` integer NOT NULL,
	`status` text NOT NULL,
	`fault_description` text NOT NULL,
	`opened_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text,
	`version` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`equipment_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contractor_id`) REFERENCES `repair_contractor`(`contractor_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user_account`(`user_id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE TABLE `repair_update` (
	`repair_update_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`repair_order_id` integer NOT NULL,
	`submitted_by_user_id` integer NOT NULL,
	`progress_status` text NOT NULL,
	`note` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`repair_order_id`) REFERENCES `repair_order`(`repair_order_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`submitted_by_user_id`) REFERENCES `user_account`(`user_id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE TABLE `safety_inspection` (
	`inspection_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`equipment_id` integer NOT NULL,
	`repair_order_id` integer,
	`inspector_user_id` integer NOT NULL,
	`result` text NOT NULL,
	`inspected_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`valid_until` text,
	`note` text,
	FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`equipment_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`repair_order_id`) REFERENCES `repair_order`(`repair_order_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`inspector_user_id`) REFERENCES `user_account`(`user_id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint

INSERT INTO `customer_fit_profile` SELECT `profile_id`,`customer_id`,`height_cm`,`weight_kg`,`foot_length_mm`,`shoe_size`,`skill_level`,`equipment_preference`,`updated_at` FROM `__old_customer_fit_profile`;--> statement-breakpoint
INSERT INTO `equipment_model` SELECT `model_id`,`category_id`,`model_code`,`brand`,`model_name`,`size_spec`,`skill_level`,`compatibility_rule` FROM `__old_equipment_model`;--> statement-breakpoint
INSERT INTO `equipment` SELECT `equipment_id`,`asset_no`,`model_id`,`current_store_id`,`status`,`acquired_at`,`retired_at`,`version` FROM `__old_equipment`;--> statement-breakpoint
INSERT INTO `rental_contract` SELECT `contract_id`,`contract_no`,`service_task_id`,`customer_id`,`pickup_store_id`,`return_store_id`,`start_at`,`end_at`,`status`,`amount_due`,`price_snapshot`,`version` FROM `__old_rental_contract`;--> statement-breakpoint
INSERT INTO `rental_item` SELECT `rental_item_id`,`contract_id`,`equipment_id`,`replaces_item_id`,`rented_from`,`rented_to`,`quoted_price`,`item_status` FROM `__old_rental_item`;--> statement-breakpoint
INSERT INTO `payment_request` SELECT `payment_request_id`,`request_no`,`contract_id`,`request_type`,`amount`,`status`,`created_at` FROM `__old_payment_request`;--> statement-breakpoint
INSERT INTO `payment_transaction` SELECT `transaction_id`,`payment_request_id`,`provider_transaction_no`,`attempt_no`,`amount`,`status`,`response_code`,`processed_at` FROM `__old_payment_transaction`;--> statement-breakpoint
INSERT INTO `equipment_location_history` SELECT `movement_id`,`equipment_id`,`from_store_id`,`to_store_id`,`contract_id`,`recorded_by_user_id`,`movement_type`,`moved_at`,`note` FROM `__old_equipment_location_history`;--> statement-breakpoint
INSERT INTO `repair_order` SELECT `repair_order_id`,`ticket_no`,`equipment_id`,`contractor_id`,`created_by_user_id`,`status`,`fault_description`,`opened_at`,`completed_at`,`version` FROM `__old_repair_order`;--> statement-breakpoint
INSERT INTO `repair_update` SELECT `repair_update_id`,`repair_order_id`,`submitted_by_user_id`,`progress_status`,`note`,`created_at` FROM `__old_repair_update`;--> statement-breakpoint
INSERT INTO `safety_inspection` SELECT `inspection_id`,`equipment_id`,`repair_order_id`,`inspector_user_id`,`result`,`inspected_at`,`valid_until`,`note` FROM `__old_safety_inspection`;--> statement-breakpoint

DROP TABLE `__old_payment_transaction`;--> statement-breakpoint
DROP TABLE `__old_payment_request`;--> statement-breakpoint
DROP TABLE `__old_repair_update`;--> statement-breakpoint
DROP TABLE `__old_safety_inspection`;--> statement-breakpoint
DROP TABLE `__old_rental_item`;--> statement-breakpoint
DROP TABLE `__old_equipment_location_history`;--> statement-breakpoint
DROP TABLE `__old_repair_order`;--> statement-breakpoint
DROP TABLE `__old_rental_contract`;--> statement-breakpoint
DROP TABLE `__old_equipment`;--> statement-breakpoint
DROP TABLE `__old_equipment_model`;--> statement-breakpoint
DROP TABLE `__old_customer_fit_profile`;--> statement-breakpoint

CREATE UNIQUE INDEX `customer_fit_profile_customer_id_unique` ON `customer_fit_profile` (`customer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `equipment_model_model_code_unique` ON `equipment_model` (`model_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `equipment_asset_no_unique` ON `equipment` (`asset_no`);--> statement-breakpoint
CREATE INDEX `idx_equipment_store_status_model` ON `equipment` (`current_store_id`,`status`,`model_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `rental_contract_contract_no_unique` ON `rental_contract` (`contract_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `rental_contract_service_task_id_unique` ON `rental_contract` (`service_task_id`);--> statement-breakpoint
CREATE INDEX `idx_rental_contract_status_end` ON `rental_contract` (`status`,`end_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_rental_item_contract_equipment_start` ON `rental_item` (`contract_id`,`equipment_id`,`rented_from`);--> statement-breakpoint
CREATE INDEX `idx_rental_item_equipment_period` ON `rental_item` (`equipment_id`,`rented_from`,`rented_to`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_request_request_no_unique` ON `payment_request` (`request_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_transaction_provider_transaction_no_unique` ON `payment_transaction` (`provider_transaction_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_payment_transaction_request_attempt` ON `payment_transaction` (`payment_request_id`,`attempt_no`);--> statement-breakpoint
CREATE INDEX `idx_equipment_location_history_equipment_time` ON `equipment_location_history` (`equipment_id`,`moved_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `repair_order_ticket_no_unique` ON `repair_order` (`ticket_no`);--> statement-breakpoint
CREATE INDEX `idx_repair_order_status_contractor` ON `repair_order` (`status`,`contractor_id`);--> statement-breakpoint

UPDATE `repair_contractor` SET `contact_phone`='未登记' WHERE `contact_phone` IS NULL;--> statement-breakpoint
CREATE TRIGGER `repair_contractor_contact_phone_insert`
BEFORE INSERT ON `repair_contractor`
WHEN NEW.`contact_phone` IS NULL
BEGIN
	SELECT RAISE(ABORT, 'contact_phone is required');
END;--> statement-breakpoint
CREATE TRIGGER `repair_contractor_contact_phone_update`
BEFORE UPDATE OF `contact_phone` ON `repair_contractor`
WHEN NEW.`contact_phone` IS NULL
BEGIN
	SELECT RAISE(ABORT, 'contact_phone is required');
END;--> statement-breakpoint
CREATE VIEW `vw_operating_metric` AS
SELECT date('now') AS metric_date,s.store_id,'AVAILABLE_EQUIPMENT' AS metric_code,
  CAST(SUM(CASE WHEN e.status='AVAILABLE' THEN 1 ELSE 0 END) AS REAL) AS metric_value,
  CURRENT_TIMESTAMP AS calculated_at
FROM store s LEFT JOIN equipment e ON e.current_store_id=s.store_id GROUP BY s.store_id
UNION ALL
SELECT date('now'),s.store_id,'ACTIVE_CONTRACTS',
  CAST(COUNT(DISTINCT CASE WHEN rc.status IN ('CONFIRMED','ACTIVE','REFUND_PROCESSING') THEN rc.contract_id END) AS REAL),
  CURRENT_TIMESTAMP
FROM store s LEFT JOIN rental_contract rc ON rc.pickup_store_id=s.store_id GROUP BY s.store_id
UNION ALL
SELECT date('now'),s.store_id,'WAITING_TASKS',
  CAST(COUNT(DISTINCT CASE WHEN st.status!='COMPLETED' THEN st.task_id END) AS REAL),
  CURRENT_TIMESTAMP
FROM store s LEFT JOIN service_task st ON st.store_id=s.store_id GROUP BY s.store_id
UNION ALL
SELECT date('now'),s.store_id,'OPEN_REPAIRS',
  CAST(COUNT(DISTINCT CASE WHEN ro.status NOT IN ('CLOSED','RETIRED') THEN ro.repair_order_id END) AS REAL),
  CURRENT_TIMESTAMP
FROM store s LEFT JOIN equipment e ON e.current_store_id=s.store_id
LEFT JOIN repair_order ro ON ro.equipment_id=e.equipment_id GROUP BY s.store_id;
