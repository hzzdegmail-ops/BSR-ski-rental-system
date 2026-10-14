import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const createdAt = () =>
  text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`);

export const stores = sqliteTable("store", {
  id: integer("store_id").primaryKey({ autoIncrement: true }),
  code: text("store_code").notNull().unique(),
  name: text("name").notNull(),
  address: text("address"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const customers = sqliteTable("customer", {
  id: integer("customer_id").primaryKey({ autoIncrement: true }),
  phone: text("phone").notNull().unique(),
  name: text("name").notNull(),
  email: text("email"),
  createdAt: createdAt(),
});

export const customerFitProfiles = sqliteTable("customer_fit_profile", {
  id: integer("profile_id").primaryKey({ autoIncrement: true }),
  customerId: integer("customer_id")
    .notNull()
    .unique()
    .references(() => customers.id),
  heightCm: real("height_cm"),
  weightKg: real("weight_kg"),
  footLengthMm: integer("foot_length_mm"),
  shoeSize: real("shoe_size"),
  skillLevel: text("skill_level").notNull().default("BEGINNER"),
  equipmentPreference: text("equipment_preference"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const repairContractors = sqliteTable("repair_contractor", {
  id: integer("contractor_id").primaryKey({ autoIncrement: true }),
  code: text("contractor_code").notNull().unique(),
  name: text("name").notNull(),
  contactPhone: text("contact_phone"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const userAccounts = sqliteTable("user_account", {
  id: integer("user_id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  storeId: integer("store_id").references(() => stores.id),
  contractorId: integer("contractor_id").references(() => repairContractors.id),
  roleType: text("role_type").notNull(),
  displayName: text("display_name").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  lastLoginAt: text("last_login_at"),
});

export const serviceReservations = sqliteTable("service_reservation", {
  id: integer("reservation_id").primaryKey({ autoIncrement: true }),
  reservationNo: text("reservation_no").notNull().unique(),
  customerId: integer("customer_id")
    .notNull()
    .references(() => customers.id),
  storeId: integer("store_id")
    .notNull()
    .references(() => stores.id),
  requestedStartAt: text("requested_start_at").notNull(),
  requestedEndAt: text("requested_end_at").notNull(),
  sourceType: text("source_type").notNull().default("ONLINE"),
  status: text("status").notNull().default("BOOKED"),
  createdAt: createdAt(),
});

export const serviceTasks = sqliteTable(
  "service_task",
  {
    id: integer("task_id").primaryKey({ autoIncrement: true }),
    reservationId: integer("reservation_id").references(
      () => serviceReservations.id,
    ),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id),
    storeId: integer("store_id")
      .notNull()
      .references(() => stores.id),
    assignedUserId: integer("assigned_user_id").references(() => userAccounts.id),
    queueNo: integer("queue_no").notNull(),
    currentStage: text("current_stage").notNull(),
    status: text("status").notNull(),
    startedAt: text("started_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    finishedAt: text("finished_at"),
  },
  (table) => [index("idx_service_task_store_status_stage").on(table.storeId, table.status, table.currentStage)],
);

export const equipmentCategories = sqliteTable("equipment_category", {
  id: integer("category_id").primaryKey({ autoIncrement: true }),
  code: text("category_code").notNull().unique(),
  name: text("name").notNull(),
  safetyIntervalDays: integer("safety_interval_days").notNull().default(30),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const equipmentModels = sqliteTable("equipment_model", {
  id: integer("model_id").primaryKey({ autoIncrement: true }),
  categoryId: integer("category_id")
    .notNull()
    .references(() => equipmentCategories.id),
  modelCode: text("model_code").notNull().unique(),
  brand: text("brand").notNull(),
  modelName: text("model_name").notNull(),
  sizeSpec: text("size_spec").notNull(),
  skillLevel: text("skill_level").notNull(),
  compatibilityRule: text("compatibility_rule").notNull().default("{}"),
});

export const equipment = sqliteTable(
  "equipment",
  {
    id: integer("equipment_id").primaryKey({ autoIncrement: true }),
    assetNo: text("asset_no").notNull().unique(),
    modelId: integer("model_id")
      .notNull()
      .references(() => equipmentModels.id),
    currentStoreId: integer("current_store_id")
      .notNull()
      .references(() => stores.id),
    status: text("status").notNull().default("AVAILABLE"),
    conditionGrade: text("condition_grade").notNull().default("A"),
    acquiredAt: text("acquired_at").notNull(),
    retiredAt: text("retired_at"),
    version: integer("version").notNull().default(1),
  },
  (table) => [index("idx_equipment_store_status_model").on(table.currentStoreId, table.status, table.modelId)],
);

export const equipmentLocationHistory = sqliteTable(
  "equipment_location_history",
  {
    id: integer("movement_id").primaryKey({ autoIncrement: true }),
    equipmentId: integer("equipment_id")
      .notNull()
      .references(() => equipment.id),
    fromStoreId: integer("from_store_id").references(() => stores.id),
    toStoreId: integer("to_store_id")
      .notNull()
      .references(() => stores.id),
    contractId: integer("contract_id"),
    recordedByUserId: integer("recorded_by_user_id")
      .notNull()
      .references(() => userAccounts.id),
    movementType: text("movement_type").notNull(),
    movedAt: text("moved_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    note: text("note"),
  },
  (table) => [index("idx_equipment_location_history_equipment_time").on(table.equipmentId, table.movedAt)],
);

export const rentalContracts = sqliteTable(
  "rental_contract",
  {
    id: integer("contract_id").primaryKey({ autoIncrement: true }),
    contractNo: text("contract_no").notNull().unique(),
    serviceTaskId: integer("service_task_id")
      .notNull()
      .unique()
      .references(() => serviceTasks.id),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id),
    pickupStoreId: integer("pickup_store_id")
      .notNull()
      .references(() => stores.id),
    returnStoreId: integer("return_store_id").references(() => stores.id),
    startAt: text("start_at").notNull(),
    endAt: text("end_at").notNull(),
    returnedAt: text("returned_at"),
    status: text("status").notNull(),
    amountDue: real("amount_due").notNull(),
    priceSnapshot: text("price_snapshot").notNull(),
    version: integer("version").notNull().default(1),
  },
  (table) => [index("idx_rental_contract_status_end").on(table.status, table.endAt)],
);

export const rentalItems = sqliteTable(
  "rental_item",
  {
    id: integer("rental_item_id").primaryKey({ autoIncrement: true }),
    contractId: integer("contract_id")
      .notNull()
      .references(() => rentalContracts.id),
    equipmentId: integer("equipment_id")
      .notNull()
      .references(() => equipment.id),
    replacesItemId: integer("replaces_item_id"),
    rentedFrom: text("rented_from").notNull(),
    rentedTo: text("rented_to"),
    quotedPrice: real("quoted_price").notNull(),
    itemStatus: text("item_status").notNull(),
  },
  (table) => [
    uniqueIndex("uq_rental_item_contract_equipment_start").on(table.contractId, table.equipmentId, table.rentedFrom),
    index("idx_rental_item_equipment_period").on(table.equipmentId, table.rentedFrom, table.rentedTo),
  ],
);

export const paymentRequests = sqliteTable("payment_request", {
  id: integer("payment_request_id").primaryKey({ autoIncrement: true }),
  requestNo: text("request_no").notNull().unique(),
  contractId: integer("contract_id")
    .notNull()
    .references(() => rentalContracts.id),
  requestType: text("request_type").notNull(),
  amount: real("amount").notNull(),
  status: text("status").notNull(),
  createdAt: createdAt(),
});

export const paymentTransactions = sqliteTable(
  "payment_transaction",
  {
    id: integer("transaction_id").primaryKey({ autoIncrement: true }),
    paymentRequestId: integer("payment_request_id")
      .notNull()
      .references(() => paymentRequests.id),
    providerTransactionNo: text("provider_transaction_no").unique(),
    attemptNo: integer("attempt_no").notNull(),
    amount: real("amount").notNull(),
    status: text("status").notNull(),
    responseCode: text("response_code"),
    processedAt: text("processed_at"),
  },
  (table) => [uniqueIndex("uq_payment_transaction_request_attempt").on(table.paymentRequestId, table.attemptNo)],
);

export const repairOrders = sqliteTable(
  "repair_order",
  {
    id: integer("repair_order_id").primaryKey({ autoIncrement: true }),
    ticketNo: text("ticket_no").notNull().unique(),
    equipmentId: integer("equipment_id")
      .notNull()
      .references(() => equipment.id),
    contractorId: integer("contractor_id").references(() => repairContractors.id),
    createdByUserId: integer("created_by_user_id")
      .notNull()
      .references(() => userAccounts.id),
    responsibleStoreId: integer("responsible_store_id")
      .notNull()
      .references(() => stores.id),
    status: text("status").notNull(),
    severity: text("severity").notNull(),
    faultDescription: text("fault_description").notNull(),
    openedAt: text("opened_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    completedAt: text("completed_at"),
    version: integer("version").notNull().default(1),
  },
  (table) => [index("idx_repair_order_status_contractor").on(table.status, table.contractorId)],
);

export const repairUpdates = sqliteTable("repair_update", {
  id: integer("repair_update_id").primaryKey({ autoIncrement: true }),
  repairOrderId: integer("repair_order_id")
    .notNull()
    .references(() => repairOrders.id),
  submittedByUserId: integer("submitted_by_user_id")
    .notNull()
    .references(() => userAccounts.id),
  progressStatus: text("progress_status").notNull(),
  note: text("note").notNull(),
  createdAt: createdAt(),
});

export const safetyInspections = sqliteTable("safety_inspection", {
  id: integer("inspection_id").primaryKey({ autoIncrement: true }),
  equipmentId: integer("equipment_id")
    .notNull()
    .references(() => equipment.id),
  repairOrderId: integer("repair_order_id").references(() => repairOrders.id),
  inspectorUserId: integer("inspector_user_id")
    .notNull()
    .references(() => userAccounts.id),
  result: text("result").notNull(),
  inspectedAt: text("inspected_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  validUntil: text("valid_until"),
  note: text("note"),
});

export const auditEvents = sqliteTable(
  "audit_event",
  {
    id: integer("audit_event_id").primaryKey({ autoIncrement: true }),
    actorUserId: integer("actor_user_id").references(() => userAccounts.id),
    eventType: text("event_type").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    result: text("result").notNull(),
    occurredAt: text("occurred_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_audit_event_occurred_at").on(table.occurredAt)],
);

export const auditEventTargets = sqliteTable(
  "audit_event_target",
  {
    id: integer("audit_target_id").primaryKey({ autoIncrement: true }),
    auditEventId: integer("audit_event_id")
      .notNull()
      .references(() => auditEvents.id),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
  },
  (table) => [uniqueIndex("uq_audit_event_target").on(table.auditEventId, table.entityType, table.entityId)],
);
