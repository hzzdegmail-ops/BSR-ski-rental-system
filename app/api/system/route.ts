import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "edge";

type Row = Record<string, unknown>;

const dailyRates: Record<string, number> = { SKI: 180, BOOT: 90, HELMET: 45, POLE: 35 };

function database() {
  if (!env.DB) throw new Error("云端数据库尚未连接");
  return env.DB;
}

const nowIso = () => new Date().toISOString();
const token = (prefix: string) =>
  `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;

function text(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field}不能为空`);
  return value.trim();
}

function integer(value: unknown, field: string) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${field}无效`);
  return number;
}

function optionalNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function rentalDays(startAt: string, endAt: string) {
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw new Error("租赁结束时间必须晚于开始时间");
  }
  return Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86_400_000));
}

async function audit(
  actorUserId: number | null,
  eventType: string,
  fromStatus: string | null,
  toStatus: string | null,
  entityType: string,
  entityId: number,
) {
  const db = database();
  const event = await db
    .prepare("INSERT INTO audit_event (actor_user_id,event_type,from_status,to_status,result) VALUES (?,?,?,?,?)")
    .bind(actorUserId, eventType, fromStatus, toStatus, "SUCCESS")
    .run();
  await db
    .prepare("INSERT INTO audit_event_target (audit_event_id,entity_type,entity_id) VALUES (?,?,?)")
    .bind(Number(event.meta.last_row_id), entityType, entityId)
    .run();
}

async function ensureSeeded() {
  const db = database();
  const existing = await db.prepare("SELECT COUNT(*) AS count FROM store").first<{ count: number }>();
  if (Number(existing?.count ?? 0) > 0) return;

  const statements = [
    ["INSERT INTO store (store_id,store_code,name,address,active) VALUES (1,'VALLEY','山谷服务中心','Skardalen 度假村入口',1)", []],
    ["INSERT INTO store (store_id,store_code,name,address,active) VALUES (2,'SUMMIT','雪岭取还中心','Fjordal 高山缆车站',1)", []],
    ["INSERT INTO repair_contractor (contractor_id,contractor_code,name,contact_phone,active) VALUES (1,'ALPINE','Alpine Gear Service','+47 555 0142',1)", []],
    ["INSERT INTO user_account (user_id,username,store_id,role_type,display_name,active) VALUES (1,'linnea',1,'STAFF','Linnea · 门店员工',1)", []],
    ["INSERT INTO user_account (user_id,username,store_id,role_type,display_name,active) VALUES (2,'ole',1,'MANAGER','Ole Fjordal · 经理',1)", []],
    ["INSERT INTO user_account (user_id,username,contractor_id,role_type,display_name,active) VALUES (3,'erik',1,'CONTRACTOR','Erik · 维修承包商',1)", []],
    ["INSERT INTO equipment_category (category_id,category_code,name,safety_interval_days,active) VALUES (1,'SKI','双板滑雪板',30,1)", []],
    ["INSERT INTO equipment_category (category_id,category_code,name,safety_interval_days,active) VALUES (2,'BOOT','滑雪靴',30,1)", []],
    ["INSERT INTO equipment_category (category_id,category_code,name,safety_interval_days,active) VALUES (3,'HELMET','头盔',14,1)", []],
    ["INSERT INTO equipment_category (category_id,category_code,name,safety_interval_days,active) VALUES (4,'POLE','雪杖',45,1)", []],
    ["INSERT INTO equipment_model (model_id,category_id,model_code,brand,model_name,size_spec,skill_level,compatibility_rule) VALUES (1,1,'ROSS-EXP76-152','Rossignol','Experience 76','152 cm','BEGINNER','{\"height\":[155,170]}')", []],
    ["INSERT INTO equipment_model (model_id,category_id,model_code,brand,model_name,size_spec,skill_level,compatibility_rule) VALUES (2,1,'ATOM-X5-160','Atomic','Redster X5','160 cm','INTERMEDIATE','{\"height\":[165,180]}')", []],
    ["INSERT INTO equipment_model (model_id,category_id,model_code,brand,model_name,size_spec,skill_level,compatibility_rule) VALUES (3,2,'SALO-SPRO-42','Salomon','S/Pro 90','EU 42','INTERMEDIATE','{\"shoeSize\":[41,43]}')", []],
    ["INSERT INTO equipment_model (model_id,category_id,model_code,brand,model_name,size_spec,skill_level,compatibility_rule) VALUES (4,2,'NORD-SPEED-39','Nordica','Speedmachine 3','EU 39','BEGINNER','{\"shoeSize\":[38,40]}')", []],
    ["INSERT INTO equipment_model (model_id,category_id,model_code,brand,model_name,size_spec,skill_level,compatibility_rule) VALUES (5,3,'SMITH-MISS-M','Smith','Mission MIPS','M',NULL,'{}')", []],
    ["INSERT INTO equipment_model (model_id,category_id,model_code,brand,model_name,size_spec,skill_level,compatibility_rule) VALUES (6,4,'LEKI-NEOLITE','Leki','Neolite Airfoil','115 cm',NULL,'{}')", []],
    ["INSERT INTO equipment (equipment_id,asset_no,model_id,current_store_id,status,acquired_at) VALUES (1,'SKI-1001',1,1,'AVAILABLE','2025-11-02')", []],
    ["INSERT INTO equipment (equipment_id,asset_no,model_id,current_store_id,status,acquired_at) VALUES (2,'SKI-1002',1,2,'AVAILABLE','2024-12-10')", []],
    ["INSERT INTO equipment (equipment_id,asset_no,model_id,current_store_id,status,acquired_at) VALUES (3,'SKI-2001',2,1,'RENTED','2025-10-18')", []],
    ["INSERT INTO equipment (equipment_id,asset_no,model_id,current_store_id,status,acquired_at) VALUES (4,'SKI-2002',2,2,'AVAILABLE','2025-10-18')", []],
    ["INSERT INTO equipment (equipment_id,asset_no,model_id,current_store_id,status,acquired_at) VALUES (5,'BOOT-4201',3,1,'RENTED','2025-12-01')", []],
    ["INSERT INTO equipment (equipment_id,asset_no,model_id,current_store_id,status,acquired_at) VALUES (6,'BOOT-4202',3,2,'AVAILABLE','2024-12-01')", []],
    ["INSERT INTO equipment (equipment_id,asset_no,model_id,current_store_id,status,acquired_at) VALUES (7,'BOOT-3901',4,1,'AVAILABLE','2026-01-12')", []],
    ["INSERT INTO equipment (equipment_id,asset_no,model_id,current_store_id,status,acquired_at) VALUES (8,'BOOT-3902',4,2,'MAINTENANCE','2025-01-12')", []],
    ["INSERT INTO equipment (equipment_id,asset_no,model_id,current_store_id,status,acquired_at) VALUES (9,'HELMET-101',5,1,'AVAILABLE','2026-02-05')", []],
    ["INSERT INTO equipment (equipment_id,asset_no,model_id,current_store_id,status,acquired_at) VALUES (10,'HELMET-102',5,2,'AVAILABLE','2026-02-05')", []],
    ["INSERT INTO equipment (equipment_id,asset_no,model_id,current_store_id,status,acquired_at) VALUES (11,'POLE-101',6,1,'AVAILABLE','2024-10-09')", []],
    ["INSERT INTO equipment (equipment_id,asset_no,model_id,current_store_id,status,acquired_at) VALUES (12,'POLE-102',6,2,'AVAILABLE','2025-10-09')", []],
    ["INSERT INTO safety_inspection (equipment_id,inspector_user_id,result,inspected_at,valid_until,note) SELECT equipment_id,1,'PASS',datetime('now','-1 day'),date('now','+90 days'),'雪季例行安全检查' FROM equipment WHERE equipment_id != 8", []],
    ["INSERT INTO customer (customer_id,phone,name,email) VALUES (1,'13800001001','陈雨桐','yutong@example.com')", []],
    ["INSERT INTO customer_fit_profile (customer_id,height_cm,weight_kg,foot_length_mm,shoe_size,skill_level,equipment_preference) VALUES (1,168,58,266,42,'INTERMEDIATE','偏好操控稳定、轻量装备')", []],
    ["INSERT INTO customer (customer_id,phone,name,email) VALUES (2,'13800001002','周明远','mingyuan@example.com')", []],
    ["INSERT INTO customer_fit_profile (customer_id,height_cm,weight_kg,foot_length_mm,shoe_size,skill_level,equipment_preference) VALUES (2,172,72,252,39,'BEGINNER','首次滑雪，需要舒适和安全提示')", []],
    ["INSERT INTO service_reservation (reservation_id,reservation_no,customer_id,store_id,requested_start_at,requested_end_at,source_type,status) VALUES (1,'RSV-260101',1,1,datetime('now','+3 days'),datetime('now','+6 days'),'ONLINE','BOOKED')", []],
    ["INSERT INTO service_task (task_id,customer_id,store_id,assigned_user_id,queue_no,current_stage,status,started_at,finished_at) VALUES (1,2,1,1,3,'COMPLETED','COMPLETED',datetime('now','-1 day'),datetime('now','-1 day','+14 minutes'))", []],
    ["INSERT INTO service_task (task_id,customer_id,store_id,assigned_user_id,queue_no,current_stage,status,started_at) VALUES (2,2,2,1,7,'PROFILE_INCOMPLETE','IN_PROGRESS',datetime('now','-35 minutes'))", []],
    ["INSERT INTO rental_contract (contract_id,contract_no,service_task_id,customer_id,pickup_store_id,start_at,end_at,status,amount_due,price_snapshot) VALUES (1,'BSR-ACTIVE-001',1,2,1,datetime('now','-1 day'),datetime('now','+2 days'),'ACTIVE',720,'{\"rental\":620,\"deposit\":100,\"currency\":\"CNY\"}')", []],
    ["INSERT INTO rental_item (contract_id,equipment_id,rented_from,quoted_price,item_status) VALUES (1,3,datetime('now','-1 day'),420,'RENTED')", []],
    ["INSERT INTO rental_item (contract_id,equipment_id,rented_from,quoted_price,item_status) VALUES (1,5,datetime('now','-1 day'),200,'RENTED')", []],
    ["INSERT INTO payment_request (payment_request_id,request_no,contract_id,request_type,amount,status) VALUES (1,'PAY-ACTIVE-001',1,'CHARGE',720,'SUCCEEDED')", []],
    ["INSERT INTO payment_transaction (payment_request_id,provider_transaction_no,attempt_no,amount,status,response_code,processed_at) VALUES (1,'TXN-ACTIVE-001',1,720,'SUCCEEDED','00',datetime('now','-1 day'))", []],
    ["INSERT INTO repair_order (repair_order_id,ticket_no,equipment_id,contractor_id,created_by_user_id,status,fault_description,opened_at) VALUES (1,'REP-OPEN-001',8,1,1,'IN_PROGRESS','右侧鞋扣松动，需更换锁扣组件',datetime('now','-5 hours'))", []],
    ["INSERT INTO repair_update (repair_order_id,submitted_by_user_id,progress_status,note,created_at) VALUES (1,3,'IN_PROGRESS','已拆检，确认锁扣组件磨损，备件已到位。',datetime('now','-2 hours'))", []],
    ["INSERT INTO audit_event (audit_event_id,actor_user_id,event_type,from_status,to_status,result,occurred_at) VALUES (1,1,'CONTRACT_ACTIVATED','CONFIRMED','ACTIVE','SUCCESS',datetime('now','-1 day'))", []],
    ["INSERT INTO audit_event_target (audit_event_id,entity_type,entity_id) VALUES (1,'RENTAL_CONTRACT',1)", []],
    ["INSERT INTO audit_event (audit_event_id,actor_user_id,event_type,from_status,to_status,result,occurred_at) VALUES (2,3,'REPAIR_PROGRESS_UPDATED','PENDING','IN_PROGRESS','SUCCESS',datetime('now','-2 hours'))", []],
    ["INSERT INTO audit_event_target (audit_event_id,entity_type,entity_id) VALUES (2,'REPAIR_ORDER',1)", []],
  ] as const;

  await db.batch(statements.map(([query, values]) => db.prepare(query).bind(...values)));
}

async function readState() {
  const db = database();
  await ensureSeeded();
  const queries = await db.batch([
    db.prepare("SELECT store_id AS id,store_code AS code,name,address FROM store WHERE active=1 ORDER BY store_id"),
    db.prepare("SELECT user_id AS id,role_type AS role,display_name AS name,store_id AS storeId,contractor_id AS contractorId FROM user_account WHERE active=1 ORDER BY user_id"),
    db.prepare("SELECT contractor_id AS id,contractor_code AS code,name,contact_phone AS contactPhone FROM repair_contractor WHERE active=1 ORDER BY contractor_id"),
    db.prepare(`SELECT e.equipment_id AS id,e.asset_no AS assetNo,e.status,e.acquired_at AS acquiredAt,
      e.current_store_id AS storeId,s.name AS storeName,ec.category_code AS categoryCode,ec.name AS categoryName,
      em.brand,em.model_name AS modelName,em.size_spec AS sizeSpec,em.skill_level AS skillLevel,
      (SELECT si.valid_until FROM safety_inspection si WHERE si.equipment_id=e.equipment_id AND si.result='PASS' ORDER BY si.inspected_at DESC LIMIT 1) AS safetyValidUntil,
      EXISTS(SELECT 1 FROM repair_order ro WHERE ro.equipment_id=e.equipment_id AND ro.status NOT IN ('CLOSED','RETIRED')) AS hasOpenRepair
      FROM equipment e JOIN equipment_model em ON em.model_id=e.model_id
      JOIN equipment_category ec ON ec.category_id=em.category_id JOIN store s ON s.store_id=e.current_store_id
      ORDER BY ec.category_id,e.asset_no`),
    db.prepare(`SELECT st.task_id AS id,st.queue_no AS queueNo,st.current_stage AS currentStage,st.status,
      st.started_at AS startedAt,st.finished_at AS finishedAt,c.name AS customerName,c.phone,s.name AS storeName,st.store_id AS storeId,
      sr.reservation_no AS reservationNo,fp.skill_level AS skillLevel,fp.shoe_size AS shoeSize,fp.height_cm AS heightCm
      FROM service_task st JOIN customer c ON c.customer_id=st.customer_id
      LEFT JOIN service_reservation sr ON sr.reservation_id=st.reservation_id
      LEFT JOIN customer_fit_profile fp ON fp.customer_id=c.customer_id JOIN store s ON s.store_id=st.store_id
      ORDER BY CASE WHEN st.status='COMPLETED' THEN 1 ELSE 0 END,st.started_at DESC LIMIT 30`),
    db.prepare(`SELECT rc.contract_id AS id,rc.contract_no AS contractNo,rc.status,rc.start_at AS startAt,rc.end_at AS endAt,
      rc.amount_due AS amountDue,rc.pickup_store_id AS pickupStoreId,rc.return_store_id AS returnStoreId,
      c.name AS customerName,c.phone,s.name AS pickupStore,
      GROUP_CONCAT(e.asset_no || ' · ' || em.model_name, ' / ') AS equipmentLabel,
      GROUP_CONCAT(CASE WHEN ri.item_status IN ('RENTED','RESERVED') THEN ri.rental_item_id END, ',') AS itemIds,
      MAX(ri.rented_to) AS lastReturnedAt,
      (SELECT pr.status FROM payment_request pr WHERE pr.contract_id=rc.contract_id ORDER BY pr.created_at DESC,pr.payment_request_id DESC LIMIT 1) AS paymentStatus,
      (SELECT pr.request_no FROM payment_request pr WHERE pr.contract_id=rc.contract_id ORDER BY pr.created_at DESC,pr.payment_request_id DESC LIMIT 1) AS paymentRequestNo
      FROM rental_contract rc JOIN customer c ON c.customer_id=rc.customer_id JOIN store s ON s.store_id=rc.pickup_store_id
      LEFT JOIN rental_item ri ON ri.contract_id=rc.contract_id AND ri.item_status!='CANCELLED'
      LEFT JOIN equipment e ON e.equipment_id=ri.equipment_id LEFT JOIN equipment_model em ON em.model_id=e.model_id
      GROUP BY rc.contract_id ORDER BY rc.start_at DESC LIMIT 30`),
    db.prepare(`SELECT ro.repair_order_id AS id,ro.ticket_no AS ticketNo,ro.status,ro.fault_description AS description,
      ro.opened_at AS openedAt,ro.completed_at AS completedAt,ro.equipment_id AS equipmentId,e.asset_no AS assetNo,
      em.model_name AS modelName,s.name AS storeName,ro.contractor_id AS contractorId,co.name AS contractorName,
      (SELECT ru.note FROM repair_update ru WHERE ru.repair_order_id=ro.repair_order_id ORDER BY ru.created_at DESC LIMIT 1) AS latestNote,
      (SELECT ru.created_at FROM repair_update ru WHERE ru.repair_order_id=ro.repair_order_id ORDER BY ru.created_at DESC LIMIT 1) AS latestUpdateAt
      FROM repair_order ro JOIN equipment e ON e.equipment_id=ro.equipment_id
      JOIN equipment_model em ON em.model_id=e.model_id JOIN store s ON s.store_id=e.current_store_id
      LEFT JOIN repair_contractor co ON co.contractor_id=ro.contractor_id ORDER BY ro.opened_at DESC LIMIT 30`),
    db.prepare(`SELECT ae.audit_event_id AS id,ae.event_type AS eventType,ae.from_status AS fromStatus,ae.to_status AS toStatus,
      ae.result,ae.occurred_at AS occurredAt,ua.display_name AS actorName,aet.entity_type AS entityType,aet.entity_id AS entityId
      FROM audit_event ae LEFT JOIN user_account ua ON ua.user_id=ae.actor_user_id
      LEFT JOIN audit_event_target aet ON aet.audit_event_id=ae.audit_event_id ORDER BY ae.occurred_at DESC LIMIT 40`),
    db.prepare("SELECT metric_date AS metricDate,store_id AS storeId,metric_code AS metricCode,metric_value AS metricValue,calculated_at AS calculatedAt FROM vw_operating_metric ORDER BY store_id,metric_code"),
    db.prepare(`SELECT pr.payment_request_id AS id,pr.contract_id AS contractId,pr.request_type AS requestType,
      pr.status,pr.created_at AS createdAt,rc.contract_no AS contractNo,c.name AS customerName
      FROM payment_request pr JOIN rental_contract rc ON rc.contract_id=pr.contract_id
      JOIN customer c ON c.customer_id=rc.customer_id ORDER BY pr.created_at DESC LIMIT 30`),
  ]);

  const [stores, users, contractors, equipmentRows, tasks, contracts, repairs, audits, metrics, payments] =
    queries.map((result) => result.results as Row[]);
  const available = equipmentRows.filter((item) => item.status === "AVAILABLE").length;
  const occupied = equipmentRows.filter((item) => ["RENTED", "RESERVED"].includes(String(item.status))).length;
  const activeTasks = tasks.filter((task) => task.status !== "COMPLETED");
  const openRepairs = repairs.filter((repair) => !["CLOSED", "RETIRED"].includes(String(repair.status)));
  const overdueContracts = contracts.filter(
    (contract) => contract.status === "ACTIVE" && new Date(String(contract.endAt)) < new Date(),
  );
  const alerts = [
    ...activeTasks.filter((task) => Date.now() - new Date(String(task.startedAt)).getTime() > 25 * 60 * 1000).map((task) => ({
      level: "high", title: `队列 ${task.queueNo} 等待偏长`, detail: `${task.customerName} · ${task.storeName}`,
      alertType: "RECEPTION", kind: "SERVICE_TASK", id: task.id,
    })),
    ...payments.filter((payment) => ["PENDING", "FAILED", "TIMEOUT"].includes(String(payment.status))).map((payment) => ({
      level: "high", title: `${payment.contractNo} 支付待处理`, detail: `${payment.customerName} · ${payment.requestType}`,
      alertType: "PAYMENT", kind: "PAYMENT_REQUEST", id: payment.id,
    })),
    ...overdueContracts.map((contract) => ({
      level: "high", title: `${contract.contractNo} 已逾期`, detail: `${contract.customerName} · ${contract.equipmentLabel}`,
      alertType: "RETURN", kind: "RENTAL_CONTRACT", id: contract.id,
    })),
    ...openRepairs.filter((repair) => Date.now() - new Date(String(repair.openedAt)).getTime() > 36 * 60 * 60 * 1000).map((repair) => ({
      level: "medium", title: `${repair.ticketNo} 维修已超 36 小时`, detail: `${repair.assetNo} · ${repair.status}`,
      alertType: "REPAIR", kind: "REPAIR_ORDER", id: repair.id,
    })),
  ];

  return {
    generatedAt: nowIso(), dataCutoff: nowIso(), dataCompleteness: "完整",
    stores, users, contractors, equipment: equipmentRows, tasks, contracts, repairs, audits, metricRows: metrics,
    summary: {
      activeContracts: contracts.filter((contract) => ["CONFIRMED", "ACTIVE", "REFUND_PROCESSING"].includes(String(contract.status))).length,
      waitingTasks: activeTasks.length,
      availableEquipment: available,
      utilization: equipmentRows.length ? Math.round((occupied / equipmentRows.length) * 100) : 0,
      openRepairs: openRepairs.length,
      overdue: overdueContracts.length,
    },
    alerts,
  };
}

export async function GET() {
  try {
    return NextResponse.json(await readState());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "读取系统数据失败" }, { status: 500 });
  }
}

async function lookupReservation(body: Row) {
  const reservationNo = text(body.reservationNo, "预约单号");
  const row = await database().prepare(`SELECT sr.reservation_id AS reservationId,sr.reservation_no AS reservationNo,
      sr.store_id AS storeId,sr.requested_start_at AS startAt,sr.requested_end_at AS endAt,sr.status,
      c.name,c.phone,c.email,fp.height_cm AS heightCm,fp.weight_kg AS weightKg,
      fp.foot_length_mm AS footLengthMm,fp.shoe_size AS shoeSize,fp.skill_level AS skillLevel,
      fp.equipment_preference AS preference
      FROM service_reservation sr JOIN customer c ON c.customer_id=sr.customer_id
      LEFT JOIN customer_fit_profile fp ON fp.customer_id=c.customer_id
      WHERE sr.reservation_no=?`).bind(reservationNo).first<Row>();
  if (!row || !["BOOKED", "CONFIRMED"].includes(String(row.status))) throw new Error("预约不存在或当前不可办理");
  return row;
}

function fitsRule(ruleValue: unknown, profile: { heightCm: number | null; shoeSize: number | null }) {
  if (!ruleValue) return true;
  try {
    const rule = JSON.parse(String(ruleValue)) as { height?: number[]; shoeSize?: number[] };
    if (rule.height && profile.heightCm && (profile.heightCm < rule.height[0] || profile.heightCm > rule.height[1])) return false;
    if (rule.shoeSize && profile.shoeSize && (profile.shoeSize < rule.shoeSize[0] || profile.shoeSize > rule.shoeSize[1])) return false;
    return true;
  } catch {
    return false;
  }
}

async function recommendationRows(
  storeId: number,
  startAt: string,
  endAt: string,
  skillLevel: string,
  heightCm: number | null,
  shoeSize: number | null,
): Promise<Array<Row & { dailyRate: number; estimatedPrice: number; fitReason: string; safetyNote: string }>> {
  const rows = await database().prepare(`SELECT e.equipment_id AS id,e.asset_no AS assetNo,e.current_store_id AS storeId,
      s.name AS storeName,ec.category_code AS categoryCode,ec.name AS categoryName,em.brand,em.model_name AS modelName,
      em.size_spec AS sizeSpec,em.skill_level AS skillLevel,em.compatibility_rule AS compatibilityRule,
      (SELECT si.valid_until FROM safety_inspection si WHERE si.equipment_id=e.equipment_id AND si.result='PASS' ORDER BY si.inspected_at DESC LIMIT 1) AS safetyValidUntil,
      CASE WHEN e.current_store_id=? THEN 0 ELSE 1 END AS remoteRank
      FROM equipment e JOIN equipment_model em ON em.model_id=e.model_id
      JOIN equipment_category ec ON ec.category_id=em.category_id JOIN store s ON s.store_id=e.current_store_id
      WHERE e.status='AVAILABLE'
      AND (em.skill_level IS NULL OR em.skill_level=? OR em.skill_level='BEGINNER' OR ?='ADVANCED')
      AND EXISTS (SELECT 1 FROM safety_inspection si WHERE si.equipment_id=e.equipment_id AND si.result='PASS' AND date(si.valid_until)>=date(?))
      AND NOT EXISTS (SELECT 1 FROM rental_item ri JOIN rental_contract rc ON rc.contract_id=ri.contract_id
        WHERE ri.equipment_id=e.equipment_id AND ri.item_status NOT IN ('RETURNED','SWAPPED','CANCELLED','DAMAGED','MISSING')
        AND rc.status IN ('PENDING_PAYMENT','CONFIRMED','ACTIVE','REFUND_PROCESSING')
        AND datetime(rc.start_at)<datetime(?) AND datetime(rc.end_at)>datetime(?))
      ORDER BY remoteRank,CASE WHEN em.skill_level=? THEN 0 WHEN em.skill_level IS NULL THEN 1 ELSE 2 END,ec.category_id,e.asset_no`)
    .bind(storeId, skillLevel, skillLevel, startAt, endAt, startAt, skillLevel).all<Row>();
  const days = rentalDays(startAt, endAt);
  return rows.results.filter((row) => fitsRule(row.compatibilityRule, { heightCm, shoeSize })).map((row) => {
    const rate = dailyRates[String(row.categoryCode)] ?? 60;
    const fitReason = row.categoryCode === "BOOT"
      ? `鞋码与 ${row.sizeSpec} 适配`
      : row.categoryCode === "SKI"
        ? `身高、技能与 ${row.sizeSpec} 规格适配`
        : "通用安全装备，适合当前技能水平";
    return { ...row, dailyRate: rate, estimatedPrice: rate * days, fitReason, safetyNote: `安全检查有效至 ${row.safetyValidUntil}` } as Row & { dailyRate: number; estimatedPrice: number; fitReason: string; safetyNote: string };
  });
}

async function createReception(body: Row) {
  const db = database();
  const actorUserId = integer(body.actorUserId ?? 1, "操作人");
  const reservationNo = typeof body.reservationNo === "string" ? body.reservationNo.trim() : "";
  const reservation = reservationNo ? await lookupReservation({ reservationNo }) : null;
  const name = reservation ? String(reservation.name) : text(body.name, "顾客姓名");
  const phone = reservation ? String(reservation.phone) : text(body.phone, "联系电话");
  const email = typeof body.email === "string" && body.email.trim() ? body.email.trim() : reservation?.email ?? null;
  const storeId = reservation ? Number(reservation.storeId) : integer(body.storeId, "办理门店");
  const startAt = reservation ? String(reservation.startAt) : text(body.startAt, "开始时间");
  const endAt = reservation ? String(reservation.endAt) : text(body.endAt, "结束时间");
  rentalDays(startAt, endAt);
  const skillLevel = text(body.skillLevel || reservation?.skillLevel, "技能水平");
  const heightCm = optionalNumber(body.heightCm ?? reservation?.heightCm);
  const weightKg = optionalNumber(body.weightKg ?? reservation?.weightKg);
  const footLengthMm = optionalNumber(body.footLengthMm ?? reservation?.footLengthMm);
  const shoeSize = optionalNumber(body.shoeSize ?? reservation?.shoeSize);
  if (!heightCm || !shoeSize) throw new Error("请填写身高和鞋码后再进行适配推荐");
  await db.prepare("INSERT INTO customer (phone,name,email) VALUES (?,?,?) ON CONFLICT(phone) DO UPDATE SET name=excluded.name,email=excluded.email")
    .bind(phone, name, email).run();
  const customer = await db.prepare("SELECT customer_id AS id FROM customer WHERE phone=?").bind(phone).first<{ id: number }>();
  if (!customer) throw new Error("顾客资料保存失败");
  await db.prepare(`INSERT INTO customer_fit_profile
      (customer_id,height_cm,weight_kg,foot_length_mm,shoe_size,skill_level,equipment_preference,updated_at)
      VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(customer_id) DO UPDATE SET height_cm=excluded.height_cm,weight_kg=excluded.weight_kg,
      foot_length_mm=excluded.foot_length_mm,shoe_size=excluded.shoe_size,skill_level=excluded.skill_level,
      equipment_preference=excluded.equipment_preference,updated_at=CURRENT_TIMESTAMP`)
    .bind(customer.id, heightCm, weightKg, footLengthMm, shoeSize, skillLevel,
      typeof body.preference === "string" ? body.preference.trim() : reservation?.preference ?? null).run();
  const queue = await db.prepare("SELECT COALESCE(MAX(queue_no),0)+1 AS nextNo FROM service_task WHERE store_id=? AND date(started_at)=date('now')")
    .bind(storeId).first<{ nextNo: number }>();
  const recommendations = await recommendationRows(storeId, startAt, endAt, skillLevel, heightCm, shoeSize);
  const stage = recommendations.length ? "WAITING_CONTRACT" : "NO_EQUIPMENT";
  const taskResult = await db.prepare(`INSERT INTO service_task
      (reservation_id,customer_id,store_id,assigned_user_id,queue_no,current_stage,status) VALUES (?,?,?,?,?,?,?)`)
    .bind(reservation ? Number(reservation.reservationId) : null, customer.id, storeId, actorUserId,
      Number(queue?.nextNo ?? 1), stage, recommendations.length ? "IN_PROGRESS" : "ATTENTION").run();
  const taskId = Number(taskResult.meta.last_row_id);
  await audit(actorUserId, "RECEPTION_CREATED", null, stage, "SERVICE_TASK", taskId);
  return {
    taskId, queueNo: Number(queue?.nextNo ?? 1), customerId: customer.id, reservationNo: reservationNo || null,
    startAt, endAt, recommendations,
    alternativeAdvice: recommendations.length ? null : "当前租期没有符合条件的装备，可调整租期、门店或规格后重新查询。",
  };
}

async function createContract(body: Row) {
  const db = database();
  const taskId = integer(body.taskId, "办理任务");
  const actorUserId = integer(body.actorUserId ?? 1, "操作人");
  const existing = await db.prepare(`SELECT rc.contract_id AS contractId,rc.contract_no AS contractNo,rc.amount_due AS amount,
      rc.status,pr.request_no AS requestNo,pr.status AS paymentStatus
      FROM rental_contract rc LEFT JOIN payment_request pr ON pr.contract_id=rc.contract_id
      WHERE rc.service_task_id=? ORDER BY pr.payment_request_id DESC LIMIT 1`).bind(taskId).first<Row>();
  if (existing) return existing;
  const equipmentIds = Array.isArray(body.equipmentIds)
    ? [...new Set(body.equipmentIds.map(Number).filter((value) => Number.isInteger(value) && value > 0))]
    : [];
  if (!equipmentIds.length) throw new Error("请至少选择一件装备");
  const task = await db.prepare(`SELECT st.customer_id AS customerId,st.store_id AS storeId,st.status,
      fp.skill_level AS skillLevel,fp.height_cm AS heightCm,fp.shoe_size AS shoeSize
      FROM service_task st LEFT JOIN customer_fit_profile fp ON fp.customer_id=st.customer_id WHERE st.task_id=?`)
    .bind(taskId).first<Row>();
  if (!task || !["IN_PROGRESS", "ATTENTION"].includes(String(task.status))) throw new Error("办理任务不存在或已结束");
  const startAt = text(body.startAt, "开始时间");
  const endAt = text(body.endAt, "结束时间");
  const days = rentalDays(startAt, endAt);
  const current = await recommendationRows(
    Number(task.storeId), startAt, endAt, String(task.skillLevel || "BEGINNER"),
    Number(task.heightCm) || null, Number(task.shoeSize) || null,
  );
  const selected = current.filter((item) => equipmentIds.includes(Number(item.id)));
  if (selected.length !== equipmentIds.length) throw new Error("推荐结果已发生变化，请重新查询装备");
  const items = selected.map((item) => ({
    id: Number(item.id), assetNo: String(item.assetNo), categoryCode: String(item.categoryCode),
    modelName: String(item.modelName), price: (dailyRates[String(item.categoryCode)] ?? 60) * days,
  }));
  const rental = items.reduce((sum, item) => sum + item.price, 0);
  const deposit = 100;
  const amount = rental + deposit;
  const contractNo = token("BSR");
  const requestNo = token("PAY");
  const outcome = ["SUCCESS", "FAILED", "TIMEOUT"].includes(String(body.paymentOutcome)) ? String(body.paymentOutcome) : "SUCCESS";
  const contractInsert = await db.prepare(`INSERT INTO rental_contract
      (contract_no,service_task_id,customer_id,pickup_store_id,start_at,end_at,status,amount_due,price_snapshot)
      VALUES (?,?,?,?,?,?,'PENDING_PAYMENT',?,?)`)
    .bind(contractNo, taskId, Number(task.customerId), Number(task.storeId), startAt, endAt, amount,
      JSON.stringify({ rental, deposit, currency: "CNY", days, items })).run();
  const contractId = Number(contractInsert.meta.last_row_id);
  const statements = [];
  for (const item of items) {
    statements.push(db.prepare("INSERT INTO rental_item (contract_id,equipment_id,rented_from,quoted_price,item_status) VALUES (?,?,?,?,'RESERVED')")
      .bind(contractId, item.id, startAt, item.price));
    statements.push(db.prepare("UPDATE equipment SET status='RESERVED',version=version+1 WHERE equipment_id=? AND status='AVAILABLE'").bind(item.id));
  }
  statements.push(db.prepare("INSERT INTO payment_request (request_no,contract_id,request_type,amount,status) VALUES (?,?,?,?,?)")
    .bind(requestNo, contractId, "CHARGE", amount, outcome === "SUCCESS" ? "SUCCEEDED" : outcome));
  if (outcome !== "TIMEOUT") {
    statements.push(db.prepare(`INSERT INTO payment_transaction
      (payment_request_id,provider_transaction_no,attempt_no,amount,status,response_code,processed_at)
      SELECT payment_request_id,?,1,?,?,?,CURRENT_TIMESTAMP FROM payment_request WHERE request_no=?`)
      .bind(token("TXN"), amount, outcome === "SUCCESS" ? "SUCCEEDED" : "FAILED",
        outcome === "SUCCESS" ? "00" : "DECLINED", requestNo));
  }
  if (outcome === "SUCCESS") {
    statements.push(db.prepare("UPDATE rental_contract SET status='CONFIRMED',version=version+1 WHERE contract_id=?").bind(contractId));
    statements.push(db.prepare("UPDATE service_task SET current_stage='COMPLETED',status='COMPLETED',finished_at=CURRENT_TIMESTAMP WHERE task_id=?").bind(taskId));
  } else if (outcome === "FAILED") {
    statements.push(db.prepare("UPDATE rental_contract SET status='CANCELLED',version=version+1 WHERE contract_id=?").bind(contractId));
    statements.push(db.prepare("UPDATE rental_item SET item_status='CANCELLED' WHERE contract_id=?").bind(contractId));
    statements.push(db.prepare("UPDATE equipment SET status='AVAILABLE',version=version+1 WHERE equipment_id IN (SELECT equipment_id FROM rental_item WHERE contract_id=?)").bind(contractId));
  }
  await db.batch(statements);
  const finalStatus = outcome === "SUCCESS" ? "CONFIRMED" : outcome === "FAILED" ? "CANCELLED" : "PENDING_PAYMENT";
  await audit(actorUserId, "CONTRACT_PAYMENT_PROCESSED", "PENDING_PAYMENT", finalStatus, "RENTAL_CONTRACT", contractId);
  return { contractId, contractNo, amount, requestNo, status: finalStatus, paymentStatus: outcome };
}

async function activateContract(body: Row) {
  const db = database();
  const contractId = integer(body.contractId, "合同");
  const actorUserId = integer(body.actorUserId ?? 1, "操作人");
  const contract = await db.prepare("SELECT status,pickup_store_id AS storeId FROM rental_contract WHERE contract_id=?")
    .bind(contractId).first<{ status: string; storeId: number }>();
  if (!contract || contract.status !== "CONFIRMED") throw new Error("只有已确认合同可以交付");
  const items = await db.prepare("SELECT equipment_id AS id FROM rental_item WHERE contract_id=? AND item_status='RESERVED'")
    .bind(contractId).all<{ id: number }>();
  if (!items.results.length) throw new Error("合同没有待交付装备");
  const statements = [
    db.prepare("UPDATE rental_contract SET status='ACTIVE',version=version+1 WHERE contract_id=? AND status='CONFIRMED'").bind(contractId),
    db.prepare("UPDATE rental_item SET item_status='RENTED' WHERE contract_id=? AND item_status='RESERVED'").bind(contractId),
    db.prepare("UPDATE equipment SET status='RENTED',version=version+1 WHERE equipment_id IN (SELECT equipment_id FROM rental_item WHERE contract_id=? AND item_status='RENTED')").bind(contractId),
  ];
  for (const item of items.results) {
    statements.push(db.prepare(`INSERT INTO equipment_location_history
      (equipment_id,from_store_id,to_store_id,contract_id,recorded_by_user_id,movement_type,note)
      VALUES (?,?,?,?,?,'RENT_OUT','装备已交付顾客')`).bind(item.id, contract.storeId, contract.storeId, contractId, actorUserId));
  }
  await db.batch(statements);
  await audit(actorUserId, "CONTRACT_ACTIVATED", "CONFIRMED", "ACTIVE", "RENTAL_CONTRACT", contractId);
  return { contractId, status: "ACTIVE" };
}

async function returnContract(body: Row) {
  const db = database();
  const contractId = integer(body.contractId, "合同");
  const actorUserId = integer(body.actorUserId ?? 1, "操作人");
  const returnStoreId = integer(body.returnStoreId, "归还门店");
  const condition = ["OK", "DAMAGED", "MISSING"].includes(String(body.condition)) ? String(body.condition) : "OK";
  const contract = await db.prepare("SELECT status,pickup_store_id AS pickupStoreId FROM rental_contract WHERE contract_id=?")
    .bind(contractId).first<{ status: string; pickupStoreId: number }>();
  if (!contract || contract.status !== "ACTIVE") throw new Error("只有租赁中的合同可以办理归还");
  const items = await db.prepare("SELECT rental_item_id AS itemId,equipment_id AS equipmentId FROM rental_item WHERE contract_id=? AND item_status='RENTED'")
    .bind(contractId).all<{ itemId: number; equipmentId: number }>();
  if (!items.results.length) throw new Error("合同没有待归还装备");
  const adjustment = Number(body.adjustment) || 0;
  const outcome = ["SUCCESS", "FAILED", "TIMEOUT"].includes(String(body.paymentOutcome)) ? String(body.paymentOutcome) : "SUCCESS";
  if (adjustment > 0 && outcome !== "SUCCESS") throw new Error("补款未完成，合同与装备状态保持不变");
  const statements = [];
  let paymentRequestNo: string | null = null;
  if (adjustment !== 0) {
    paymentRequestNo = token(adjustment > 0 ? "SUP" : "REF");
    const paymentStatus = outcome === "SUCCESS" ? "SUCCEEDED" : outcome;
    statements.push(db.prepare("INSERT INTO payment_request (request_no,contract_id,request_type,amount,status) VALUES (?,?,?,?,?)")
      .bind(paymentRequestNo, contractId, adjustment > 0 ? "SUPPLEMENT" : "REFUND", Math.abs(adjustment), paymentStatus));
    if (outcome !== "TIMEOUT") {
      statements.push(db.prepare(`INSERT INTO payment_transaction
        (payment_request_id,provider_transaction_no,attempt_no,amount,status,response_code,processed_at)
        SELECT payment_request_id,?,1,?,?,?,CURRENT_TIMESTAMP FROM payment_request WHERE request_no=?`)
        .bind(token("TXN"), Math.abs(adjustment), outcome === "SUCCESS" ? "SUCCEEDED" : "FAILED",
          outcome === "SUCCESS" ? "00" : "DECLINED", paymentRequestNo));
    }
  }
  for (const item of items.results) {
    const itemStatus = condition === "OK" ? "RETURNED" : condition;
    const equipmentStatus = condition === "OK" ? "AVAILABLE" : condition === "DAMAGED" ? "MAINTENANCE" : "MISSING";
    statements.push(db.prepare("UPDATE rental_item SET item_status=?,rented_to=CURRENT_TIMESTAMP WHERE rental_item_id=?").bind(itemStatus, item.itemId));
    statements.push(db.prepare("UPDATE equipment SET status=?,current_store_id=?,version=version+1 WHERE equipment_id=?")
      .bind(equipmentStatus, returnStoreId, item.equipmentId));
    statements.push(db.prepare(`INSERT INTO equipment_location_history
      (equipment_id,from_store_id,to_store_id,contract_id,recorded_by_user_id,movement_type,note)
      VALUES (?,?,?,?,?,'RETURN',?)`).bind(item.equipmentId, contract.pickupStoreId, returnStoreId, contractId, actorUserId,
      returnStoreId === contract.pickupStoreId ? "原店归还" : "跨店归还"));
  }
  const newStatus = condition === "MISSING" ? "EXCEPTION"
    : adjustment < 0 && outcome !== "SUCCESS" ? "REFUND_PROCESSING" : "RETURNED";
  statements.push(db.prepare("UPDATE rental_contract SET status=?,return_store_id=?,amount_due=amount_due+?,version=version+1 WHERE contract_id=?")
    .bind(newStatus, returnStoreId, adjustment, contractId));
  await db.batch(statements);
  await audit(actorUserId, "CONTRACT_RETURNED", "ACTIVE", newStatus, "RENTAL_CONTRACT", contractId);
  return {
    contractId, status: newStatus, paymentRequestNo, repairRequired: condition === "DAMAGED",
    isolatedEquipmentIds: condition === "DAMAGED" ? items.results.map((item) => item.equipmentId) : [],
  };
}

async function exchangeEquipment(body: Row) {
  const db = database();
  const contractId = integer(body.contractId, "合同");
  const oldItemId = integer(body.oldItemId, "原装备明细");
  const newEquipmentId = integer(body.newEquipmentId, "替换装备");
  const actorUserId = integer(body.actorUserId ?? 1, "操作人");
  const original = await db.prepare(`SELECT ri.equipment_id AS equipmentId,ri.item_status AS itemStatus,ri.quoted_price AS quotedPrice,
      rc.status AS contractStatus,rc.pickup_store_id AS pickupStoreId,rc.start_at AS startAt,rc.end_at AS endAt,
      ec.category_code AS categoryCode
      FROM rental_item ri JOIN rental_contract rc ON rc.contract_id=ri.contract_id
      JOIN equipment e ON e.equipment_id=ri.equipment_id JOIN equipment_model em ON em.model_id=e.model_id
      JOIN equipment_category ec ON ec.category_id=em.category_id
      WHERE ri.rental_item_id=? AND ri.contract_id=?`).bind(oldItemId, contractId).first<Row>();
  if (!original || original.contractStatus !== "ACTIVE" || original.itemStatus !== "RENTED") {
    throw new Error("原装备不处于可换装状态");
  }
  const replacement = await db.prepare(`SELECT e.status,e.current_store_id AS storeId,ec.category_code AS categoryCode,
      EXISTS(SELECT 1 FROM safety_inspection si WHERE si.equipment_id=e.equipment_id AND si.result='PASS' AND date(si.valid_until)>=date('now')) AS safetyValid,
      EXISTS(SELECT 1 FROM rental_item ri JOIN rental_contract rc ON rc.contract_id=ri.contract_id
        WHERE ri.equipment_id=e.equipment_id AND ri.item_status NOT IN ('RETURNED','SWAPPED','CANCELLED','DAMAGED','MISSING')
        AND rc.status IN ('PENDING_PAYMENT','CONFIRMED','ACTIVE','REFUND_PROCESSING')
        AND datetime(rc.start_at)<datetime(?) AND datetime(rc.end_at)>datetime(?)) AS periodConflict
      FROM equipment e JOIN equipment_model em ON em.model_id=e.model_id
      JOIN equipment_category ec ON ec.category_id=em.category_id WHERE e.equipment_id=?`)
    .bind(String(original.endAt), String(original.startAt), newEquipmentId).first<Row>();
  if (!replacement || replacement.status !== "AVAILABLE" || !Number(replacement.safetyValid) || Number(replacement.periodConflict)) {
    throw new Error("替换装备当前不可用或存在租期冲突");
  }
  if (replacement.categoryCode !== original.categoryCode) throw new Error("替换装备必须属于同一类别");
  const difference = Number(body.adjustment) || 0;
  const outcome = ["SUCCESS", "FAILED", "TIMEOUT"].includes(String(body.paymentOutcome)) ? String(body.paymentOutcome) : "SUCCESS";
  if (difference !== 0 && outcome !== "SUCCESS") throw new Error("价差处理未完成，原合同与装备保持不变");
  const statements = [];
  let paymentRequestNo: string | null = null;
  if (difference !== 0) {
    paymentRequestNo = token(difference > 0 ? "SUP" : "REF");
    statements.push(db.prepare("INSERT INTO payment_request (request_no,contract_id,request_type,amount,status) VALUES (?,?,?,?,'SUCCEEDED')")
      .bind(paymentRequestNo, contractId, difference > 0 ? "SUPPLEMENT" : "REFUND", Math.abs(difference)));
    statements.push(db.prepare(`INSERT INTO payment_transaction
      (payment_request_id,provider_transaction_no,attempt_no,amount,status,response_code,processed_at)
      SELECT payment_request_id,?,1,?,'SUCCEEDED','00',CURRENT_TIMESTAMP FROM payment_request WHERE request_no=?`)
      .bind(token("TXN"), Math.abs(difference), paymentRequestNo));
  }
  statements.push(db.prepare("UPDATE rental_item SET item_status='SWAPPED',rented_to=CURRENT_TIMESTAMP WHERE rental_item_id=?").bind(oldItemId));
  statements.push(db.prepare("UPDATE equipment SET status='AVAILABLE',version=version+1 WHERE equipment_id=?").bind(Number(original.equipmentId)));
  statements.push(db.prepare("INSERT INTO rental_item (contract_id,equipment_id,replaces_item_id,rented_from,quoted_price,item_status) VALUES (?,?,?,CURRENT_TIMESTAMP,?,'RENTED')")
    .bind(contractId, newEquipmentId, oldItemId, Math.max(0, Number(original.quotedPrice) + difference)));
  statements.push(db.prepare("UPDATE equipment SET status='RENTED',version=version+1 WHERE equipment_id=?").bind(newEquipmentId));
  statements.push(db.prepare("UPDATE rental_contract SET amount_due=amount_due+?,version=version+1 WHERE contract_id=?").bind(difference, contractId));
  statements.push(db.prepare(`INSERT INTO equipment_location_history
    (equipment_id,from_store_id,to_store_id,contract_id,recorded_by_user_id,movement_type,note)
    VALUES (?,?,?,?,?,'EXCHANGE_OUT','换装后归还原装备')`)
    .bind(Number(original.equipmentId), Number(original.pickupStoreId), Number(replacement.storeId), contractId, actorUserId));
  statements.push(db.prepare(`INSERT INTO equipment_location_history
    (equipment_id,from_store_id,to_store_id,contract_id,recorded_by_user_id,movement_type,note)
    VALUES (?,?,?,?,?,'EXCHANGE_IN','替换装备交付顾客')`)
    .bind(newEquipmentId, Number(replacement.storeId), Number(replacement.storeId), contractId, actorUserId));
  await db.batch(statements);
  await audit(actorUserId, "EQUIPMENT_EXCHANGED", "RENTED", "SWAPPED", "RENTAL_CONTRACT", contractId);
  return { contractId, paymentRequestNo };
}

async function createRepair(body: Row) {
  const db = database();
  const equipmentId = integer(body.equipmentId, "装备");
  const actorUserId = integer(body.actorUserId ?? 1, "操作人");
  const contractorId = optionalNumber(body.contractorId);
  const equipmentRow = await db.prepare(`SELECT e.status,
      EXISTS(SELECT 1 FROM rental_item ri JOIN rental_contract rc ON rc.contract_id=ri.contract_id
        WHERE ri.equipment_id=e.equipment_id AND ri.item_status IN ('RENTED','RESERVED')
        AND rc.status IN ('PENDING_PAYMENT','CONFIRMED','ACTIVE','REFUND_PROCESSING')) AS activeRental
      FROM equipment e WHERE e.equipment_id=?`).bind(equipmentId).first<Row>();
  if (!equipmentRow || Number(equipmentRow.activeRental) || ["RENTED", "RESERVED", "RETIRED"].includes(String(equipmentRow.status))) {
    throw new Error("该装备当前不能建立维修工单");
  }
  const open = await db.prepare("SELECT ticket_no AS ticketNo FROM repair_order WHERE equipment_id=? AND status NOT IN ('CLOSED','RETIRED') LIMIT 1")
    .bind(equipmentId).first<Row>();
  if (open) throw new Error(`该装备已有未关闭工单 ${open.ticketNo}`);
  if (contractorId) {
    const contractor = await db.prepare("SELECT contractor_id FROM repair_contractor WHERE contractor_id=? AND active=1")
      .bind(contractorId).first();
    if (!contractor) throw new Error("维修承包商不可用");
  }
  const ticketNo = token("REP");
  const status = contractorId ? "PENDING" : "UNASSIGNED";
  const inserted = await db.prepare(`INSERT INTO repair_order
      (ticket_no,equipment_id,contractor_id,created_by_user_id,status,fault_description) VALUES (?,?,?,?,?,?)`)
    .bind(ticketNo, equipmentId, contractorId, actorUserId, status, text(body.description, "故障说明")).run();
  const repairId = Number(inserted.meta.last_row_id);
  await db.prepare("UPDATE equipment SET status='MAINTENANCE',version=version+1 WHERE equipment_id=?").bind(equipmentId).run();
  await audit(actorUserId, "REPAIR_ORDER_CREATED", String(equipmentRow.status), status, "REPAIR_ORDER", repairId);
  return { repairId, ticketNo, status };
}

async function updateRepair(body: Row) {
  const db = database();
  const repairId = integer(body.repairId, "维修工单");
  const actorUserId = integer(body.actorUserId ?? 3, "操作人");
  const nextStatus = text(body.progressStatus, "维修进度");
  if (!["IN_PROGRESS", "WAITING_PARTS", "AWAITING_INSPECTION", "RETIRE_RECOMMENDED"].includes(nextStatus)) {
    throw new Error("维修进度无效");
  }
  const order = await db.prepare(`SELECT ro.status,ro.equipment_id AS equipmentId,ro.contractor_id AS contractorId,
      ua.role_type AS actorRole,ua.contractor_id AS actorContractorId
      FROM repair_order ro JOIN user_account ua ON ua.user_id=? WHERE ro.repair_order_id=?`)
    .bind(actorUserId, repairId).first<Row>();
  if (!order || ["CLOSED", "RETIRED"].includes(String(order.status))) throw new Error("工单不存在或已关闭");
  if (order.actorRole !== "CONTRACTOR" || Number(order.actorContractorId) !== Number(order.contractorId)) {
    throw new Error("只能更新分配给当前承包商的工单");
  }
  await db.batch([
    db.prepare("INSERT INTO repair_update (repair_order_id,submitted_by_user_id,progress_status,note) VALUES (?,?,?,?)")
      .bind(repairId, actorUserId, nextStatus, text(body.note, "处理说明")),
    db.prepare("UPDATE repair_order SET status=?,version=version+1 WHERE repair_order_id=?").bind(nextStatus, repairId),
    db.prepare("UPDATE equipment SET status='MAINTENANCE',version=version+1 WHERE equipment_id=?").bind(Number(order.equipmentId)),
  ]);
  await audit(actorUserId, "REPAIR_PROGRESS_UPDATED", String(order.status), nextStatus, "REPAIR_ORDER", repairId);
  return { repairId, status: nextStatus };
}

async function inspectRepair(body: Row) {
  const db = database();
  const repairId = integer(body.repairId, "维修工单");
  const actorUserId = integer(body.actorUserId ?? 1, "操作人");
  const result = body.result === "PASS" ? "PASS" : "FAIL";
  const order = await db.prepare(`SELECT ro.status,ro.equipment_id AS equipmentId,ua.role_type AS actorRole
      FROM repair_order ro JOIN user_account ua ON ua.user_id=? WHERE ro.repair_order_id=?`)
    .bind(actorUserId, repairId).first<Row>();
  if (!order || order.status !== "AWAITING_INSPECTION") throw new Error("该工单尚未进入待验收状态");
  if (order.actorRole === "CONTRACTOR") throw new Error("维修承包商不能执行门店安全验收");
  const validUntil = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  await db.batch([
    db.prepare("INSERT INTO safety_inspection (equipment_id,repair_order_id,inspector_user_id,result,valid_until,note) VALUES (?,?,?,?,?,?)")
      .bind(Number(order.equipmentId), repairId, actorUserId, result, result === "PASS" ? validUntil : null,
        typeof body.note === "string" ? body.note.trim() : null),
    db.prepare("UPDATE repair_order SET status=?,completed_at=CASE WHEN ?='PASS' THEN CURRENT_TIMESTAMP ELSE NULL END,version=version+1 WHERE repair_order_id=?")
      .bind(result === "PASS" ? "CLOSED" : "IN_PROGRESS", result, repairId),
    db.prepare("UPDATE equipment SET status=?,version=version+1 WHERE equipment_id=?")
      .bind(result === "PASS" ? "AVAILABLE" : "MAINTENANCE", Number(order.equipmentId)),
  ]);
  await audit(actorUserId, "SAFETY_INSPECTION_RECORDED", String(order.status), result === "PASS" ? "CLOSED" : "IN_PROGRESS", "REPAIR_ORDER", repairId);
  return { repairId, result };
}

export async function POST(request: NextRequest) {
  try {
    await ensureSeeded();
    const body = (await request.json()) as Row;
    const action = text(body.action, "操作类型");
    const handlers: Record<string, (payload: Row) => Promise<unknown>> = {
      lookupReservation,
      createReception,
      createContract,
      activateContract,
      returnContract,
      exchangeEquipment,
      createRepair,
      updateRepair,
      inspectRepair,
    };
    const handler = handlers[action];
    if (!handler) throw new Error("不支持的业务操作");
    return NextResponse.json({ ok: true, result: await handler(body) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "业务操作失败";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
