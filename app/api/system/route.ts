import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "edge";

type Row = Record<string, unknown>;

function database() {
  if (!env.DB) throw new Error("云端数据库尚未连接");
  return env.DB;
}

const nowIso = () => new Date().toISOString();
const token = (prefix: string) =>
  `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;

function text(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field}不能为空`);
  }
  return value.trim();
}

function integer(value: unknown, field: string) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${field}无效`);
  return number;
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
    .prepare(
      "INSERT INTO audit_event (actor_user_id,event_type,from_status,to_status,result) VALUES (?,?,?,?,?)",
    )
    .bind(actorUserId, eventType, fromStatus, toStatus, "SUCCESS")
    .run();
  await db
    .prepare(
      "INSERT INTO audit_event_target (audit_event_id,entity_type,entity_id) VALUES (?,?,?)",
    )
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
    ["INSERT INTO equipment_model (model_id,category_id,model_code,brand,model_name,size_spec,skill_level,compatibility_rule) VALUES (5,3,'SMITH-MISS-M','Smith','Mission MIPS','M','ALL','{}')", []],
    ["INSERT INTO equipment_model (model_id,category_id,model_code,brand,model_name,size_spec,skill_level,compatibility_rule) VALUES (6,4,'LEKI-NEOLITE','Leki','Neolite Airfoil','115 cm','ALL','{}')", []],
    ["INSERT INTO equipment (equipment_id,asset_no,model_id,current_store_id,status,condition_grade,acquired_at) VALUES (1,'SKI-1001',1,1,'AVAILABLE','A','2025-11-02')", []],
    ["INSERT INTO equipment (equipment_id,asset_no,model_id,current_store_id,status,condition_grade,acquired_at) VALUES (2,'SKI-1002',1,2,'AVAILABLE','B','2024-12-10')", []],
    ["INSERT INTO equipment (equipment_id,asset_no,model_id,current_store_id,status,condition_grade,acquired_at) VALUES (3,'SKI-2001',2,1,'RENTED','A','2025-10-18')", []],
    ["INSERT INTO equipment (equipment_id,asset_no,model_id,current_store_id,status,condition_grade,acquired_at) VALUES (4,'SKI-2002',2,2,'AVAILABLE','A','2025-10-18')", []],
    ["INSERT INTO equipment (equipment_id,asset_no,model_id,current_store_id,status,condition_grade,acquired_at) VALUES (5,'BOOT-4201',3,1,'RENTED','A','2025-12-01')", []],
    ["INSERT INTO equipment (equipment_id,asset_no,model_id,current_store_id,status,condition_grade,acquired_at) VALUES (6,'BOOT-4202',3,2,'AVAILABLE','B','2024-12-01')", []],
    ["INSERT INTO equipment (equipment_id,asset_no,model_id,current_store_id,status,condition_grade,acquired_at) VALUES (7,'BOOT-3901',4,1,'AVAILABLE','A','2026-01-12')", []],
    ["INSERT INTO equipment (equipment_id,asset_no,model_id,current_store_id,status,condition_grade,acquired_at) VALUES (8,'BOOT-3902',4,2,'MAINTENANCE','B','2025-01-12')", []],
    ["INSERT INTO equipment (equipment_id,asset_no,model_id,current_store_id,status,condition_grade,acquired_at) VALUES (9,'HELMET-101',5,1,'AVAILABLE','A','2026-02-05')", []],
    ["INSERT INTO equipment (equipment_id,asset_no,model_id,current_store_id,status,condition_grade,acquired_at) VALUES (10,'HELMET-102',5,2,'AVAILABLE','A','2026-02-05')", []],
    ["INSERT INTO equipment (equipment_id,asset_no,model_id,current_store_id,status,condition_grade,acquired_at) VALUES (11,'POLE-101',6,1,'AVAILABLE','B','2024-10-09')", []],
    ["INSERT INTO equipment (equipment_id,asset_no,model_id,current_store_id,status,condition_grade,acquired_at) VALUES (12,'POLE-102',6,2,'AVAILABLE','A','2025-10-09')", []],
    ["INSERT INTO safety_inspection (equipment_id,inspector_user_id,result,inspected_at,valid_until,note) SELECT equipment_id,1,'PASS','2026-10-01T08:00:00Z','2026-12-01','雪季开场安全检查' FROM equipment WHERE equipment_id != 8", []],
    ["INSERT INTO customer (customer_id,phone,name,email) VALUES (1,'13800001001','陈雨桐','yutong@example.com')", []],
    ["INSERT INTO customer_fit_profile (customer_id,height_cm,weight_kg,foot_length_mm,shoe_size,skill_level,equipment_preference) VALUES (1,168,58,266,42,'INTERMEDIATE','偏好操控稳定、轻量装备')", []],
    ["INSERT INTO customer (customer_id,phone,name,email) VALUES (2,'13800001002','周明远','mingyuan@example.com')", []],
    ["INSERT INTO customer_fit_profile (customer_id,height_cm,weight_kg,foot_length_mm,shoe_size,skill_level,equipment_preference) VALUES (2,172,72,252,39,'BEGINNER','首次滑雪，需要舒适和安全提示')", []],
    ["INSERT INTO service_reservation (reservation_id,reservation_no,customer_id,store_id,requested_start_at,requested_end_at,source_type,status) VALUES (1,'RSV-260101',1,1,'2026-10-14T08:00:00Z','2026-10-16T16:00:00Z','ONLINE','FULFILLED')", []],
    ["INSERT INTO service_task (task_id,reservation_id,customer_id,store_id,assigned_user_id,queue_no,current_stage,status,started_at,finished_at) VALUES (1,1,1,1,1,3,'COMPLETED','COMPLETED','2026-10-14T08:14:00Z','2026-10-14T08:28:00Z')", []],
    ["INSERT INTO service_task (task_id,customer_id,store_id,assigned_user_id,queue_no,current_stage,status,started_at) VALUES (2,2,2,1,7,'FIT_PROFILE','IN_PROGRESS','2026-10-14T09:31:00Z')", []],
    ["INSERT INTO rental_contract (contract_id,contract_no,service_task_id,customer_id,pickup_store_id,start_at,end_at,status,amount_due,price_snapshot) VALUES (1,'BSR-20261014-001',1,1,1,'2026-10-14T08:30:00Z','2026-10-16T16:00:00Z','ACTIVE',720,'{\"rental\":620,\"deposit\":100,\"currency\":\"CNY\"}')", []],
    ["INSERT INTO rental_item (contract_id,equipment_id,rented_from,quoted_price,item_status) VALUES (1,3,'2026-10-14T08:30:00Z',420,'RENTED')", []],
    ["INSERT INTO rental_item (contract_id,equipment_id,rented_from,quoted_price,item_status) VALUES (1,5,'2026-10-14T08:30:00Z',200,'RENTED')", []],
    ["INSERT INTO payment_request (payment_request_id,request_no,contract_id,request_type,amount,status) VALUES (1,'PAY-20261014-001',1,'CHARGE',720,'SUCCEEDED')", []],
    ["INSERT INTO payment_transaction (payment_request_id,provider_transaction_no,attempt_no,amount,status,response_code,processed_at) VALUES (1,'DEMO-TXN-001',1,720,'SUCCEEDED','00','2026-10-14T08:27:00Z')", []],
    ["INSERT INTO repair_order (repair_order_id,ticket_no,equipment_id,contractor_id,created_by_user_id,responsible_store_id,status,severity,fault_description,opened_at) VALUES (1,'REP-20261013-001',8,1,1,2,'IN_PROGRESS','MEDIUM','右侧鞋扣松动，需更换锁扣组件','2026-10-13T10:20:00Z')", []],
    ["INSERT INTO repair_update (repair_order_id,submitted_by_user_id,progress_status,note,created_at) VALUES (1,3,'IN_PROGRESS','已拆检，确认锁扣组件磨损，备件已到位。','2026-10-14T07:40:00Z')", []],
    ["INSERT INTO audit_event (audit_event_id,actor_user_id,event_type,from_status,to_status,result,occurred_at) VALUES (1,1,'CONTRACT_ACTIVATED','CONFIRMED','ACTIVE','SUCCESS','2026-10-14T08:30:00Z')", []],
    ["INSERT INTO audit_event_target (audit_event_id,entity_type,entity_id) VALUES (1,'RENTAL_CONTRACT',1)", []],
    ["INSERT INTO audit_event (audit_event_id,actor_user_id,event_type,from_status,to_status,result,occurred_at) VALUES (2,3,'REPAIR_PROGRESS_UPDATED','PENDING','IN_PROGRESS','SUCCESS','2026-10-14T07:40:00Z')", []],
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
    db.prepare(`SELECT e.equipment_id AS id,e.asset_no AS assetNo,e.status,e.condition_grade AS conditionGrade,
      e.current_store_id AS storeId,s.name AS storeName,ec.category_code AS categoryCode,ec.name AS categoryName,
      em.brand,em.model_name AS modelName,em.size_spec AS sizeSpec,em.skill_level AS skillLevel,
      (SELECT si.valid_until FROM safety_inspection si WHERE si.equipment_id=e.equipment_id AND si.result='PASS' ORDER BY si.inspected_at DESC LIMIT 1) AS safetyValidUntil
      FROM equipment e JOIN equipment_model em ON em.model_id=e.model_id
      JOIN equipment_category ec ON ec.category_id=em.category_id JOIN store s ON s.store_id=e.current_store_id
      ORDER BY ec.category_id,e.asset_no`),
    db.prepare(`SELECT st.task_id AS id,st.queue_no AS queueNo,st.current_stage AS currentStage,st.status,
      st.started_at AS startedAt,c.name AS customerName,c.phone,s.name AS storeName,st.store_id AS storeId,
      fp.skill_level AS skillLevel,fp.shoe_size AS shoeSize,fp.height_cm AS heightCm
      FROM service_task st JOIN customer c ON c.customer_id=st.customer_id
      LEFT JOIN customer_fit_profile fp ON fp.customer_id=c.customer_id JOIN store s ON s.store_id=st.store_id
      ORDER BY CASE WHEN st.status='COMPLETED' THEN 1 ELSE 0 END,st.started_at DESC LIMIT 30`),
    db.prepare(`SELECT rc.contract_id AS id,rc.contract_no AS contractNo,rc.status,rc.start_at AS startAt,rc.end_at AS endAt,
      rc.returned_at AS returnedAt,rc.amount_due AS amountDue,rc.pickup_store_id AS pickupStoreId,rc.return_store_id AS returnStoreId,
      c.name AS customerName,c.phone,s.name AS pickupStore,
      GROUP_CONCAT(e.asset_no || ' · ' || em.model_name, ' / ') AS equipmentLabel,
      GROUP_CONCAT(ri.rental_item_id, ',') AS itemIds
      FROM rental_contract rc JOIN customer c ON c.customer_id=rc.customer_id JOIN store s ON s.store_id=rc.pickup_store_id
      LEFT JOIN rental_item ri ON ri.contract_id=rc.contract_id AND ri.item_status NOT IN ('SWAPPED','CANCELLED')
      LEFT JOIN equipment e ON e.equipment_id=ri.equipment_id LEFT JOIN equipment_model em ON em.model_id=e.model_id
      GROUP BY rc.contract_id ORDER BY rc.start_at DESC LIMIT 30`),
    db.prepare(`SELECT ro.repair_order_id AS id,ro.ticket_no AS ticketNo,ro.status,ro.severity,ro.fault_description AS description,
      ro.opened_at AS openedAt,ro.completed_at AS completedAt,ro.equipment_id AS equipmentId,e.asset_no AS assetNo,
      em.model_name AS modelName,s.name AS storeName,co.name AS contractorName,
      (SELECT ru.note FROM repair_update ru WHERE ru.repair_order_id=ro.repair_order_id ORDER BY ru.created_at DESC LIMIT 1) AS latestNote,
      (SELECT ru.created_at FROM repair_update ru WHERE ru.repair_order_id=ro.repair_order_id ORDER BY ru.created_at DESC LIMIT 1) AS latestUpdateAt
      FROM repair_order ro JOIN equipment e ON e.equipment_id=ro.equipment_id
      JOIN equipment_model em ON em.model_id=e.model_id JOIN store s ON s.store_id=ro.responsible_store_id
      LEFT JOIN repair_contractor co ON co.contractor_id=ro.contractor_id ORDER BY ro.opened_at DESC LIMIT 30`),
    db.prepare(`SELECT ae.audit_event_id AS id,ae.event_type AS eventType,ae.from_status AS fromStatus,ae.to_status AS toStatus,
      ae.result,ae.occurred_at AS occurredAt,ua.display_name AS actorName,aet.entity_type AS entityType,aet.entity_id AS entityId
      FROM audit_event ae LEFT JOIN user_account ua ON ua.user_id=ae.actor_user_id
      LEFT JOIN audit_event_target aet ON aet.audit_event_id=ae.audit_event_id ORDER BY ae.occurred_at DESC LIMIT 40`),
    db.prepare("SELECT metric_key AS metricKey,metric_value AS metricValue,data_cutoff AS dataCutoff FROM vw_operating_metric"),
  ]);

  const [stores, users, equipmentRows, tasks, contracts, repairs, audits, metrics] = queries.map((result) => result.results as Row[]);
  const available = equipmentRows.filter((item) => item.status === "AVAILABLE").length;
  const rented = equipmentRows.filter((item) => item.status === "RENTED" || item.status === "RESERVED").length;
  const utilization = equipmentRows.length ? Math.round((rented / equipmentRows.length) * 100) : 0;
  const activeTasks = tasks.filter((task) => task.status !== "COMPLETED");
  const openRepairs = repairs.filter((repair) => !["CLOSED", "RETIRED"].includes(String(repair.status)));
  const overdue = contracts.filter((contract) => contract.status === "ACTIVE" && new Date(String(contract.endAt)) < new Date()).length;
  const alerts = [
    ...activeTasks.filter((task) => Date.now() - new Date(String(task.startedAt)).getTime() > 25 * 60 * 1000).map((task) => ({
      level: "high", title: `队列 ${task.queueNo} 等待偏长`, detail: `${task.customerName} · ${task.storeName}`, kind: "SERVICE_TASK", id: task.id,
    })),
    ...openRepairs.filter((repair) => Date.now() - new Date(String(repair.openedAt)).getTime() > 36 * 60 * 60 * 1000).map((repair) => ({
      level: "medium", title: `${repair.ticketNo} 维修已超 36 小时`, detail: `${repair.assetNo} · ${repair.status}`, kind: "REPAIR_ORDER", id: repair.id,
    })),
    ...contracts.filter((contract) => contract.status === "ACTIVE" && new Date(String(contract.endAt)) < new Date()).map((contract) => ({
      level: "high", title: `${contract.contractNo} 已逾期`, detail: `${contract.customerName} · ${contract.equipmentLabel}`, kind: "RENTAL_CONTRACT", id: contract.id,
    })),
  ];

  return {
    generatedAt: nowIso(), stores, users, equipment: equipmentRows, tasks, contracts, repairs, audits,
    metricRows: metrics,
    summary: {
      activeContracts: contracts.filter((contract) => ["CONFIRMED", "ACTIVE"].includes(String(contract.status))).length,
      waitingTasks: activeTasks.length,
      availableEquipment: available,
      utilization,
      openRepairs: openRepairs.length,
      overdue,
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

async function createReception(body: Row) {
  const db = database();
  const name = text(body.name, "顾客姓名");
  const phone = text(body.phone, "联系电话");
  const storeId = integer(body.storeId, "办理门店");
  const startAt = text(body.startAt, "开始时间");
  const endAt = text(body.endAt, "结束时间");
  const skillLevel = text(body.skillLevel, "技能水平");
  if (new Date(endAt) <= new Date(startAt)) throw new Error("结束时间必须晚于开始时间");

  await db.prepare("INSERT INTO customer (phone,name,email) VALUES (?,?,?) ON CONFLICT(phone) DO UPDATE SET name=excluded.name,email=excluded.email")
    .bind(phone, name, typeof body.email === "string" ? body.email.trim() : null).run();
  const customer = await db.prepare("SELECT customer_id AS id FROM customer WHERE phone=?").bind(phone).first<{ id: number }>();
  if (!customer) throw new Error("顾客资料保存失败");
  await db.prepare(`INSERT INTO customer_fit_profile
      (customer_id,height_cm,weight_kg,foot_length_mm,shoe_size,skill_level,equipment_preference,updated_at)
      VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(customer_id) DO UPDATE SET height_cm=excluded.height_cm,weight_kg=excluded.weight_kg,
      foot_length_mm=excluded.foot_length_mm,shoe_size=excluded.shoe_size,skill_level=excluded.skill_level,
      equipment_preference=excluded.equipment_preference,updated_at=CURRENT_TIMESTAMP`)
    .bind(customer.id, Number(body.heightCm) || null, Number(body.weightKg) || null, Number(body.footLengthMm) || null,
      Number(body.shoeSize) || null, skillLevel, typeof body.preference === "string" ? body.preference.trim() : null).run();
  const queue = await db.prepare("SELECT COALESCE(MAX(queue_no),0)+1 AS nextNo FROM service_task WHERE store_id=? AND date(started_at)=date('now')")
    .bind(storeId).first<{ nextNo: number }>();
  const taskResult = await db.prepare(`INSERT INTO service_task
      (customer_id,store_id,assigned_user_id,queue_no,current_stage,status) VALUES (?,?,?,?,?,?)`)
    .bind(customer.id, storeId, integer(body.actorUserId ?? 1, "操作人"), Number(queue?.nextNo ?? 1), "RECOMMENDATION", "IN_PROGRESS").run();
  const taskId = Number(taskResult.meta.last_row_id);
  const recommended = await db.prepare(`SELECT e.equipment_id AS id,e.asset_no AS assetNo,e.current_store_id AS storeId,
      s.name AS storeName,ec.category_code AS categoryCode,ec.name AS categoryName,em.brand,em.model_name AS modelName,
      em.size_spec AS sizeSpec,em.skill_level AS skillLevel,e.condition_grade AS conditionGrade,
      CASE WHEN e.current_store_id=? THEN 0 ELSE 1 END AS remoteRank
      FROM equipment e JOIN equipment_model em ON em.model_id=e.model_id JOIN equipment_category ec ON ec.category_id=em.category_id
      JOIN store s ON s.store_id=e.current_store_id
      WHERE e.status='AVAILABLE' AND (em.skill_level IN (?, 'ALL', 'BEGINNER') OR ?='ADVANCED')
      AND EXISTS (SELECT 1 FROM safety_inspection si WHERE si.equipment_id=e.equipment_id AND si.result='PASS' AND date(si.valid_until)>=date('now'))
      ORDER BY remoteRank,CASE WHEN em.skill_level=? THEN 0 ELSE 1 END,ec.category_id,e.condition_grade LIMIT 12`)
    .bind(storeId, skillLevel, skillLevel, skillLevel).all();
  await audit(integer(body.actorUserId ?? 1, "操作人"), "RECEPTION_CREATED", null, "IN_PROGRESS", "SERVICE_TASK", taskId);
  return { taskId, queueNo: Number(queue?.nextNo ?? 1), customerId: customer.id, startAt, endAt, recommendations: recommended.results };
}

async function createContract(body: Row) {
  const db = database();
  const taskId = integer(body.taskId, "办理任务");
  const actorUserId = integer(body.actorUserId ?? 1, "操作人");
  const equipmentIds = Array.isArray(body.equipmentIds) ? [...new Set(body.equipmentIds.map(Number).filter(Number.isInteger))] : [];
  if (!equipmentIds.length) throw new Error("请至少选择一件装备");
  const task = await db.prepare("SELECT customer_id AS customerId,store_id AS storeId,status FROM service_task WHERE task_id=?")
    .bind(taskId).first<{ customerId: number; storeId: number; status: string }>();
  if (!task || task.status === "COMPLETED") throw new Error("办理任务不存在或已经完成");
  const placeholders = equipmentIds.map(() => "?").join(",");
  const selected = await db.prepare(`SELECT e.equipment_id AS id,e.asset_no AS assetNo,e.status,ec.category_code AS categoryCode,
      ec.name AS categoryName,em.model_name AS modelName,e.current_store_id AS storeId
      FROM equipment e JOIN equipment_model em ON em.model_id=e.model_id JOIN equipment_category ec ON ec.category_id=em.category_id
      WHERE e.equipment_id IN (${placeholders})`).bind(...equipmentIds).all<Row>();
  if (selected.results.length !== equipmentIds.length || selected.results.some((item) => item.status !== "AVAILABLE")) {
    throw new Error("所选装备已不可租，请刷新后重新选择");
  }
  const startAt = text(body.startAt, "开始时间");
  const endAt = text(body.endAt, "结束时间");
  const days = Math.max(1, Math.ceil((new Date(endAt).getTime() - new Date(startAt).getTime()) / 86_400_000));
  const rates: Record<string, number> = { SKI: 180, BOOT: 90, HELMET: 45, POLE: 35 };
  const items: Array<Row & { price: number }> = (selected.results as Row[]).map((item) => ({
    ...item,
    price: (rates[String(item.categoryCode)] ?? 60) * days,
  }));
  const rental = items.reduce((sum, item) => sum + Number(item.price), 0);
  const deposit = 100;
  const amount = rental + deposit;
  const contractNo = token("BSR");
  const requestNo = token("PAY");
  const txNo = token("DEMO-TXN");
  const contractInsert = await db.prepare(`INSERT INTO rental_contract
      (contract_no,service_task_id,customer_id,pickup_store_id,start_at,end_at,status,amount_due,price_snapshot)
      VALUES (?,?,?,?,?,?,?,?,?)`)
    .bind(contractNo, taskId, task.customerId, task.storeId, startAt, endAt, "CONFIRMED", amount,
      JSON.stringify({ rental, deposit, currency: "CNY", items })).run();
  const contractId = Number(contractInsert.meta.last_row_id);
  const batch = [];
  for (const item of items) {
    batch.push(db.prepare("INSERT INTO rental_item (contract_id,equipment_id,rented_from,quoted_price,item_status) VALUES (?,?,?,?,?)")
      .bind(contractId, Number(item.id), startAt, Number(item.price), "RESERVED"));
    batch.push(db.prepare("UPDATE equipment SET status='RESERVED',version=version+1 WHERE equipment_id=? AND status='AVAILABLE'")
      .bind(Number(item.id)));
  }
  batch.push(db.prepare("INSERT INTO payment_request (request_no,contract_id,request_type,amount,status) VALUES (?,?,?,?,?)")
    .bind(requestNo, contractId, "CHARGE", amount, "SUCCEEDED"));
  batch.push(db.prepare(`INSERT INTO payment_transaction
      (payment_request_id,provider_transaction_no,attempt_no,amount,status,response_code,processed_at)
      SELECT payment_request_id,?,1,?,'SUCCEEDED','00',CURRENT_TIMESTAMP FROM payment_request WHERE request_no=?`)
    .bind(txNo, amount, requestNo));
  batch.push(db.prepare("UPDATE service_task SET current_stage='COMPLETED',status='COMPLETED',finished_at=CURRENT_TIMESTAMP WHERE task_id=?").bind(taskId));
  await db.batch(batch);
  await audit(actorUserId, "CONTRACT_CREATED_AND_PAID", null, "CONFIRMED", "RENTAL_CONTRACT", contractId);
  return { contractId, contractNo, amount, requestNo };
}

async function activateContract(body: Row) {
  const db = database();
  const contractId = integer(body.contractId, "合同");
  const actorUserId = integer(body.actorUserId ?? 1, "操作人");
  const contract = await db.prepare("SELECT status,pickup_store_id AS storeId FROM rental_contract WHERE contract_id=?").bind(contractId).first<{ status: string; storeId: number }>();
  if (!contract || contract.status !== "CONFIRMED") throw new Error("只有已确认合同可以交付");
  const items = await db.prepare("SELECT equipment_id AS id FROM rental_item WHERE contract_id=? AND item_status='RESERVED'").bind(contractId).all<{ id: number }>();
  const statements = [
    db.prepare("UPDATE rental_contract SET status='ACTIVE',version=version+1 WHERE contract_id=? AND status='CONFIRMED'").bind(contractId),
    db.prepare("UPDATE rental_item SET item_status='RENTED' WHERE contract_id=? AND item_status='RESERVED'").bind(contractId),
    db.prepare("UPDATE equipment SET status='RENTED',version=version+1 WHERE equipment_id IN (SELECT equipment_id FROM rental_item WHERE contract_id=?)").bind(contractId),
  ];
  for (const item of items.results) {
    statements.push(db.prepare(`INSERT INTO equipment_location_history
      (equipment_id,from_store_id,to_store_id,contract_id,recorded_by_user_id,movement_type,note)
      VALUES (?,?,?,?,?,'RENT_OUT','装备已交付顾客')`).bind(item.id, contract.storeId, contract.storeId, contractId, actorUserId));
  }
  await db.batch(statements);
  await audit(actorUserId, "CONTRACT_ACTIVATED", "CONFIRMED", "ACTIVE", "RENTAL_CONTRACT", contractId);
  return { contractId };
}

async function returnContract(body: Row) {
  const db = database();
  const contractId = integer(body.contractId, "合同");
  const actorUserId = integer(body.actorUserId ?? 1, "操作人");
  const returnStoreId = integer(body.returnStoreId, "归还门店");
  const condition = ["OK", "DAMAGED", "MISSING"].includes(String(body.condition)) ? String(body.condition) : "OK";
  const contract = await db.prepare("SELECT status,pickup_store_id AS pickupStoreId FROM rental_contract WHERE contract_id=?")
    .bind(contractId).first<{ status: string; pickupStoreId: number }>();
  if (!contract || !["ACTIVE", "CONFIRMED"].includes(contract.status)) throw new Error("合同不存在或已经完成归还");
  const items = await db.prepare("SELECT rental_item_id AS itemId,equipment_id AS equipmentId FROM rental_item WHERE contract_id=? AND item_status IN ('RENTED','RESERVED')")
    .bind(contractId).all<{ itemId: number; equipmentId: number }>();
  const statements = [];
  for (const item of items.results) {
    const itemStatus = condition === "OK" ? "RETURNED" : condition;
    const equipmentStatus = condition === "OK" ? "AVAILABLE" : condition === "DAMAGED" ? "MAINTENANCE" : "MISSING";
    statements.push(db.prepare("UPDATE rental_item SET item_status=?,rented_to=CURRENT_TIMESTAMP WHERE rental_item_id=?").bind(itemStatus, item.itemId));
    statements.push(db.prepare("UPDATE equipment SET status=?,current_store_id=?,version=version+1 WHERE equipment_id=?").bind(equipmentStatus, returnStoreId, item.equipmentId));
    statements.push(db.prepare(`INSERT INTO equipment_location_history
      (equipment_id,from_store_id,to_store_id,contract_id,recorded_by_user_id,movement_type,note)
      VALUES (?,?,?,?,?,'RETURN',?)`).bind(item.equipmentId, contract.pickupStoreId, returnStoreId, contractId, actorUserId,
      returnStoreId === contract.pickupStoreId ? "原店归还" : "跨店归还"));
    if (condition === "DAMAGED") {
      statements.push(db.prepare(`INSERT INTO repair_order
        (ticket_no,equipment_id,contractor_id,created_by_user_id,responsible_store_id,status,severity,fault_description)
        VALUES (?, ?, 1, ?, ?, 'PENDING', 'MEDIUM', ?)`)
        .bind(token("REP"), item.equipmentId, actorUserId, returnStoreId, text(body.damageNote || "归还检查发现异常", "损坏说明")));
    }
  }
  const newStatus = condition === "MISSING" ? "EXCEPTION" : "RETURNED";
  statements.push(db.prepare("UPDATE rental_contract SET status=?,return_store_id=?,returned_at=CURRENT_TIMESTAMP,version=version+1 WHERE contract_id=?")
    .bind(newStatus, returnStoreId, contractId));
  const adjustment = Number(body.adjustment) || 0;
  if (adjustment !== 0) {
    const requestNo = token(adjustment > 0 ? "SUP" : "REF");
    statements.push(db.prepare("INSERT INTO payment_request (request_no,contract_id,request_type,amount,status) VALUES (?,?,?,?,?)")
      .bind(requestNo, contractId, adjustment > 0 ? "SUPPLEMENT" : "REFUND", Math.abs(adjustment), "SUCCEEDED"));
    statements.push(db.prepare(`INSERT INTO payment_transaction
      (payment_request_id,provider_transaction_no,attempt_no,amount,status,response_code,processed_at)
      SELECT payment_request_id,?,1,?,'SUCCEEDED','00',CURRENT_TIMESTAMP FROM payment_request WHERE request_no=?`)
      .bind(token("DEMO-TXN"), Math.abs(adjustment), requestNo));
  }
  await db.batch(statements);
  await audit(actorUserId, "CONTRACT_RETURNED", contract.status, newStatus, "RENTAL_CONTRACT", contractId);
  return { contractId, status: newStatus };
}

async function exchangeEquipment(body: Row) {
  const db = database();
  const contractId = integer(body.contractId, "合同");
  const oldItemId = integer(body.oldItemId, "原装备明细");
  const newEquipmentId = integer(body.newEquipmentId, "替换装备");
  const actorUserId = integer(body.actorUserId ?? 1, "操作人");
  const original = await db.prepare(`SELECT ri.equipment_id AS equipmentId,ri.item_status AS itemStatus,ri.quoted_price AS quotedPrice,
      rc.status AS contractStatus,rc.return_store_id AS returnStoreId,rc.pickup_store_id AS pickupStoreId
      FROM rental_item ri JOIN rental_contract rc ON rc.contract_id=ri.contract_id
      WHERE ri.rental_item_id=? AND ri.contract_id=?`).bind(oldItemId, contractId).first<Row>();
  const replacement = await db.prepare("SELECT status,current_store_id AS storeId FROM equipment WHERE equipment_id=?").bind(newEquipmentId).first<Row>();
  if (!original || original.contractStatus !== "ACTIVE" || original.itemStatus !== "RENTED") throw new Error("原装备不处于可换装状态");
  if (!replacement || replacement.status !== "AVAILABLE") throw new Error("替换装备当前不可用");
  const difference = Number(body.adjustment) || 0;
  const statements = [
    db.prepare("UPDATE rental_item SET item_status='SWAPPED',rented_to=CURRENT_TIMESTAMP WHERE rental_item_id=?").bind(oldItemId),
    db.prepare("UPDATE equipment SET status='AVAILABLE',version=version+1 WHERE equipment_id=?").bind(Number(original.equipmentId)),
    db.prepare("INSERT INTO rental_item (contract_id,equipment_id,replaces_item_id,rented_from,quoted_price,item_status) VALUES (?,?,?,CURRENT_TIMESTAMP,?,'RENTED')")
      .bind(contractId, newEquipmentId, oldItemId, Number(original.quotedPrice) + difference),
    db.prepare("UPDATE equipment SET status='RENTED',version=version+1 WHERE equipment_id=?").bind(newEquipmentId),
  ];
  if (difference !== 0) {
    const requestNo = token(difference > 0 ? "SUP" : "REF");
    statements.push(db.prepare("INSERT INTO payment_request (request_no,contract_id,request_type,amount,status) VALUES (?,?,?,?,?)")
      .bind(requestNo, contractId, difference > 0 ? "SUPPLEMENT" : "REFUND", Math.abs(difference), "SUCCEEDED"));
    statements.push(db.prepare(`INSERT INTO payment_transaction
      (payment_request_id,provider_transaction_no,attempt_no,amount,status,response_code,processed_at)
      SELECT payment_request_id,?,1,?,'SUCCEEDED','00',CURRENT_TIMESTAMP FROM payment_request WHERE request_no=?`)
      .bind(token("DEMO-TXN"), Math.abs(difference), requestNo));
  }
  await db.batch(statements);
  await audit(actorUserId, "EQUIPMENT_EXCHANGED", "RENTED", "SWAPPED", "RENTAL_CONTRACT", contractId);
  return { contractId };
}

async function createRepair(body: Row) {
  const db = database();
  const equipmentId = integer(body.equipmentId, "装备");
  const actorUserId = integer(body.actorUserId ?? 1, "操作人");
  const equipmentRow = await db.prepare("SELECT status,current_store_id AS storeId FROM equipment WHERE equipment_id=?").bind(equipmentId).first<Row>();
  if (!equipmentRow || ["RENTED", "RESERVED", "RETIRED"].includes(String(equipmentRow.status))) throw new Error("该装备当前不能直接送修");
  const open = await db.prepare("SELECT ticket_no AS ticketNo FROM repair_order WHERE equipment_id=? AND status NOT IN ('CLOSED','RETIRED') LIMIT 1")
    .bind(equipmentId).first<Row>();
  if (open) throw new Error(`该装备已有未关闭工单 ${open.ticketNo}`);
  const ticketNo = token("REP");
  const inserted = await db.prepare(`INSERT INTO repair_order
      (ticket_no,equipment_id,contractor_id,created_by_user_id,responsible_store_id,status,severity,fault_description)
      VALUES (?,?,1,?,?, 'PENDING',?,?)`)
    .bind(ticketNo, equipmentId, actorUserId, Number(equipmentRow.storeId), text(body.severity, "严重程度"), text(body.description, "故障说明")).run();
  const repairId = Number(inserted.meta.last_row_id);
  await db.prepare("UPDATE equipment SET status='MAINTENANCE',version=version+1 WHERE equipment_id=?").bind(equipmentId).run();
  await audit(actorUserId, "REPAIR_ORDER_CREATED", String(equipmentRow.status), "MAINTENANCE", "REPAIR_ORDER", repairId);
  return { repairId, ticketNo };
}

async function updateRepair(body: Row) {
  const db = database();
  const repairId = integer(body.repairId, "维修工单");
  const actorUserId = integer(body.actorUserId ?? 3, "操作人");
  const nextStatus = text(body.progressStatus, "维修进度");
  if (!["IN_PROGRESS", "WAITING_PARTS", "AWAITING_INSPECTION", "RETIRE_RECOMMENDED"].includes(nextStatus)) throw new Error("维修进度无效");
  const order = await db.prepare("SELECT status,equipment_id AS equipmentId FROM repair_order WHERE repair_order_id=?")
    .bind(repairId).first<{ status: string; equipmentId: number }>();
  if (!order || ["CLOSED", "RETIRED"].includes(order.status)) throw new Error("工单不存在或已关闭");
  await db.batch([
    db.prepare("INSERT INTO repair_update (repair_order_id,submitted_by_user_id,progress_status,note) VALUES (?,?,?,?)")
      .bind(repairId, actorUserId, nextStatus, text(body.note, "处理说明")),
    db.prepare("UPDATE repair_order SET status=?,version=version+1 WHERE repair_order_id=?").bind(nextStatus, repairId),
    db.prepare("UPDATE equipment SET status=?,version=version+1 WHERE equipment_id=?")
      .bind(nextStatus === "AWAITING_INSPECTION" ? "AWAITING_INSPECTION" : "MAINTENANCE", order.equipmentId),
  ]);
  await audit(actorUserId, "REPAIR_PROGRESS_UPDATED", order.status, nextStatus, "REPAIR_ORDER", repairId);
  return { repairId, status: nextStatus };
}

async function inspectRepair(body: Row) {
  const db = database();
  const repairId = integer(body.repairId, "维修工单");
  const actorUserId = integer(body.actorUserId ?? 1, "操作人");
  const result = body.result === "PASS" ? "PASS" : "FAIL";
  const order = await db.prepare("SELECT status,equipment_id AS equipmentId FROM repair_order WHERE repair_order_id=?")
    .bind(repairId).first<{ status: string; equipmentId: number }>();
  if (!order || order.status !== "AWAITING_INSPECTION") throw new Error("该工单尚未进入待验收状态");
  const validUntil = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  await db.batch([
    db.prepare("INSERT INTO safety_inspection (equipment_id,repair_order_id,inspector_user_id,result,valid_until,note) VALUES (?,?,?,?,?,?)")
      .bind(order.equipmentId, repairId, actorUserId, result, result === "PASS" ? validUntil : null, typeof body.note === "string" ? body.note.trim() : null),
    db.prepare("UPDATE repair_order SET status=?,completed_at=CASE WHEN ?='PASS' THEN CURRENT_TIMESTAMP ELSE NULL END,version=version+1 WHERE repair_order_id=?")
      .bind(result === "PASS" ? "CLOSED" : "IN_PROGRESS", result, repairId),
    db.prepare("UPDATE equipment SET status=?,version=version+1 WHERE equipment_id=?")
      .bind(result === "PASS" ? "AVAILABLE" : "MAINTENANCE", order.equipmentId),
  ]);
  await audit(actorUserId, "SAFETY_INSPECTION_RECORDED", order.status, result === "PASS" ? "CLOSED" : "IN_PROGRESS", "REPAIR_ORDER", repairId);
  return { repairId, result };
}

export async function POST(request: NextRequest) {
  try {
    await ensureSeeded();
    const body = (await request.json()) as Row;
    const action = text(body.action, "操作类型");
    const handlers: Record<string, (payload: Row) => Promise<unknown>> = {
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
    const result = await handler(body);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "业务操作失败";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
