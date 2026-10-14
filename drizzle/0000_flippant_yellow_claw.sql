CREATE TABLE `audit_event_target` (
	`audit_target_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`audit_event_id` integer NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer NOT NULL,
	FOREIGN KEY (`audit_event_id`) REFERENCES `audit_event`(`audit_event_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_audit_event_target` ON `audit_event_target` (`audit_event_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `audit_event` (
	`audit_event_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_user_id` integer,
	`event_type` text NOT NULL,
	`from_status` text,
	`to_status` text,
	`result` text NOT NULL,
	`occurred_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user_account`(`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_audit_event_occurred_at` ON `audit_event` (`occurred_at`);--> statement-breakpoint
CREATE TABLE `customer_fit_profile` (
	`profile_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer NOT NULL,
	`height_cm` real,
	`weight_kg` real,
	`foot_length_mm` integer,
	`shoe_size` real,
	`skill_level` text DEFAULT 'BEGINNER' NOT NULL,
	`equipment_preference` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customer`(`customer_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_fit_profile_customer_id_unique` ON `customer_fit_profile` (`customer_id`);--> statement-breakpoint
CREATE TABLE `customer` (
	`customer_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`phone` text NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_phone_unique` ON `customer` (`phone`);--> statement-breakpoint
CREATE TABLE `equipment` (
	`equipment_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`asset_no` text NOT NULL,
	`model_id` integer NOT NULL,
	`current_store_id` integer NOT NULL,
	`status` text DEFAULT 'AVAILABLE' NOT NULL,
	`condition_grade` text DEFAULT 'A' NOT NULL,
	`acquired_at` text NOT NULL,
	`retired_at` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`model_id`) REFERENCES `equipment_model`(`model_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_store_id`) REFERENCES `store`(`store_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `equipment_asset_no_unique` ON `equipment` (`asset_no`);--> statement-breakpoint
CREATE INDEX `idx_equipment_store_status_model` ON `equipment` (`current_store_id`,`status`,`model_id`);--> statement-breakpoint
CREATE TABLE `equipment_category` (
	`category_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category_code` text NOT NULL,
	`name` text NOT NULL,
	`safety_interval_days` integer DEFAULT 30 NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `equipment_category_category_code_unique` ON `equipment_category` (`category_code`);--> statement-breakpoint
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
	FOREIGN KEY (`recorded_by_user_id`) REFERENCES `user_account`(`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_equipment_location_history_equipment_time` ON `equipment_location_history` (`equipment_id`,`moved_at`);--> statement-breakpoint
CREATE TABLE `equipment_model` (
	`model_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category_id` integer NOT NULL,
	`model_code` text NOT NULL,
	`brand` text NOT NULL,
	`model_name` text NOT NULL,
	`size_spec` text NOT NULL,
	`skill_level` text NOT NULL,
	`compatibility_rule` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `equipment_category`(`category_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `equipment_model_model_code_unique` ON `equipment_model` (`model_code`);--> statement-breakpoint
CREATE TABLE `payment_request` (
	`payment_request_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_no` text NOT NULL,
	`contract_id` integer NOT NULL,
	`request_type` text NOT NULL,
	`amount` real NOT NULL,
	`status` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `rental_contract`(`contract_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_request_request_no_unique` ON `payment_request` (`request_no`);--> statement-breakpoint
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
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_transaction_provider_transaction_no_unique` ON `payment_transaction` (`provider_transaction_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_payment_transaction_request_attempt` ON `payment_transaction` (`payment_request_id`,`attempt_no`);--> statement-breakpoint
CREATE TABLE `rental_contract` (
	`contract_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contract_no` text NOT NULL,
	`service_task_id` integer NOT NULL,
	`customer_id` integer NOT NULL,
	`pickup_store_id` integer NOT NULL,
	`return_store_id` integer,
	`start_at` text NOT NULL,
	`end_at` text NOT NULL,
	`returned_at` text,
	`status` text NOT NULL,
	`amount_due` real NOT NULL,
	`price_snapshot` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`service_task_id`) REFERENCES `service_task`(`task_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customer`(`customer_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pickup_store_id`) REFERENCES `store`(`store_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`return_store_id`) REFERENCES `store`(`store_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rental_contract_contract_no_unique` ON `rental_contract` (`contract_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `rental_contract_service_task_id_unique` ON `rental_contract` (`service_task_id`);--> statement-breakpoint
CREATE INDEX `idx_rental_contract_status_end` ON `rental_contract` (`status`,`end_at`);--> statement-breakpoint
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
	FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`equipment_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_rental_item_contract_equipment_start` ON `rental_item` (`contract_id`,`equipment_id`,`rented_from`);--> statement-breakpoint
CREATE INDEX `idx_rental_item_equipment_period` ON `rental_item` (`equipment_id`,`rented_from`,`rented_to`);--> statement-breakpoint
CREATE TABLE `repair_contractor` (
	`contractor_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contractor_code` text NOT NULL,
	`name` text NOT NULL,
	`contact_phone` text,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `repair_contractor_contractor_code_unique` ON `repair_contractor` (`contractor_code`);--> statement-breakpoint
CREATE TABLE `repair_order` (
	`repair_order_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticket_no` text NOT NULL,
	`equipment_id` integer NOT NULL,
	`contractor_id` integer,
	`created_by_user_id` integer NOT NULL,
	`responsible_store_id` integer NOT NULL,
	`status` text NOT NULL,
	`severity` text NOT NULL,
	`fault_description` text NOT NULL,
	`opened_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`equipment_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contractor_id`) REFERENCES `repair_contractor`(`contractor_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user_account`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`responsible_store_id`) REFERENCES `store`(`store_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `repair_order_ticket_no_unique` ON `repair_order` (`ticket_no`);--> statement-breakpoint
CREATE INDEX `idx_repair_order_status_contractor` ON `repair_order` (`status`,`contractor_id`);--> statement-breakpoint
CREATE TABLE `repair_update` (
	`repair_update_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`repair_order_id` integer NOT NULL,
	`submitted_by_user_id` integer NOT NULL,
	`progress_status` text NOT NULL,
	`note` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`repair_order_id`) REFERENCES `repair_order`(`repair_order_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`submitted_by_user_id`) REFERENCES `user_account`(`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
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
);
--> statement-breakpoint
CREATE TABLE `service_reservation` (
	`reservation_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`reservation_no` text NOT NULL,
	`customer_id` integer NOT NULL,
	`store_id` integer NOT NULL,
	`requested_start_at` text NOT NULL,
	`requested_end_at` text NOT NULL,
	`source_type` text DEFAULT 'ONLINE' NOT NULL,
	`status` text DEFAULT 'BOOKED' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customer`(`customer_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`store_id`) REFERENCES `store`(`store_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `service_reservation_reservation_no_unique` ON `service_reservation` (`reservation_no`);--> statement-breakpoint
CREATE TABLE `service_task` (
	`task_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`reservation_id` integer,
	`customer_id` integer NOT NULL,
	`store_id` integer NOT NULL,
	`assigned_user_id` integer,
	`queue_no` integer NOT NULL,
	`current_stage` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`reservation_id`) REFERENCES `service_reservation`(`reservation_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customer`(`customer_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`store_id`) REFERENCES `store`(`store_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assigned_user_id`) REFERENCES `user_account`(`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_service_task_store_status_stage` ON `service_task` (`store_id`,`status`,`current_stage`);--> statement-breakpoint
CREATE TABLE `store` (
	`store_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_code` text NOT NULL,
	`name` text NOT NULL,
	`address` text,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_store_code_unique` ON `store` (`store_code`);--> statement-breakpoint
CREATE TABLE `user_account` (
	`user_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`store_id` integer,
	`contractor_id` integer,
	`role_type` text NOT NULL,
	`display_name` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`last_login_at` text,
	FOREIGN KEY (`store_id`) REFERENCES `store`(`store_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contractor_id`) REFERENCES `repair_contractor`(`contractor_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_account_username_unique` ON `user_account` (`username`);--> statement-breakpoint
CREATE VIEW `vw_operating_metric` AS
SELECT 'active_contracts' AS metric_key,
       COUNT(*) AS metric_value,
       CURRENT_TIMESTAMP AS data_cutoff
FROM rental_contract
WHERE status IN ('CONFIRMED', 'ACTIVE')
UNION ALL
SELECT 'available_equipment', COUNT(*), CURRENT_TIMESTAMP
FROM equipment
WHERE status = 'AVAILABLE'
UNION ALL
SELECT 'open_repairs', COUNT(*), CURRENT_TIMESTAMP
FROM repair_order
WHERE status NOT IN ('CLOSED', 'RETIRED')
UNION ALL
SELECT 'waiting_tasks', COUNT(*), CURRENT_TIMESTAMP
FROM service_task
WHERE status != 'COMPLETED';
