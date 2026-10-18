"use client";

import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  BarChart3,
  Bell,
  Boxes,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Cloud,
  FileText,
  Gauge,
  HardHat,
  LayoutDashboard,
  LoaderCircle,
  Menu,
  PackageCheck,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  ShieldCheck,
  Snowflake,
  Store,
  UsersRound,
  Wrench,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Role = "STAFF" | "MANAGER" | "CONTRACTOR";
type View = "overview" | "reception" | "contracts" | "inventory" | "repairs" | "audit";

type SystemState = {
  generatedAt: string;
  dataCutoff: string;
  dataCompleteness: string;
  stores: Array<{ id: number; code: string; name: string; address: string }>;
  users: Array<{ id: number; role: Role; name: string; storeId?: number; contractorId?: number }>;
  contractors: Array<{ id: number; code: string; name: string; contactPhone: string }>;
  equipment: Array<Record<string, string | number | null>>;
  tasks: Array<Record<string, string | number | null>>;
  contracts: Array<Record<string, string | number | null>>;
  repairs: Array<Record<string, string | number | null>>;
  audits: Array<Record<string, string | number | null>>;
  metricRows: Array<Record<string, string | number | null>>;
  summary: {
    activeContracts: number;
    waitingTasks: number;
    availableEquipment: number;
    utilization: number;
    openRepairs: number;
    overdue: number;
  };
  alerts: Array<Record<string, string | number | null>>;
};

type Recommendation = {
  id: number;
  categoryCode: string;
  categoryName: string;
  brand: string;
  modelName: string;
  sizeSpec: string;
  assetNo: string;
  storeName: string;
  dailyRate: number;
  estimatedPrice: number;
  fitReason: string;
  safetyNote: string;
};

type ReceptionResult = Record<string, unknown> & {
  taskId: number;
  queueNo: number;
  recommendations: Recommendation[];
};

const roleLabels: Record<Role, string> = {
  STAFF: "门店员工",
  MANAGER: "经理",
  CONTRACTOR: "维修承包商",
};

const statusLabels: Record<string, string> = {
  AVAILABLE: "可出租",
  RESERVED: "已预留",
  RENTED: "租出中",
  MAINTENANCE: "维修中",
  AWAITING_INSPECTION: "待验收",
  MISSING: "装备缺失",
  RETIRED: "已退役",
  CONFIRMED: "已确认",
  ACTIVE: "租赁中",
  RETURNED: "已归还",
  EXCEPTION: "异常处理中",
  IN_PROGRESS: "处理中",
  COMPLETED: "已完成",
  PENDING: "待接收",
  UNASSIGNED: "待分配",
  PENDING_PAYMENT: "待支付",
  REFUND_PROCESSING: "退款处理中",
  CANCELLED: "已取消",
  ATTENTION: "需处理",
  WAITING_PARTS: "等待备件",
  RETIRE_RECOMMENDED: "建议退役",
  CLOSED: "已关闭",
  RECOMMENDATION: "装备推荐",
  FIT_PROFILE: "资料确认",
  PROFILE_INCOMPLETE: "资料待补充",
  WAITING_CONTRACT: "等待合同确认",
  NO_EQUIPMENT: "暂无适配装备",
};

const eventLabels: Record<string, string> = {
  RECEPTION_CREATED: "建立接待任务",
  CONTRACT_PAYMENT_PROCESSED: "合同收费处理",
  CONTRACT_ACTIVATED: "交付装备",
  CONTRACT_RETURNED: "办理装备归还",
  EQUIPMENT_EXCHANGED: "办理换装",
  REPAIR_ORDER_CREATED: "提交维修工单",
  REPAIR_PROGRESS_UPDATED: "更新维修进度",
  SAFETY_INSPECTION_RECORDED: "登记安全验收",
};

const cn = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(" ");
const isoForInput = (date: Date) => {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};
const formatDate = (value: unknown, withTime = true) => {
  if (!value) return "—";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  }).format(date);
};
const money = (value: unknown) => `¥${Number(value || 0).toLocaleString("zh-CN")}`;

function StatusBadge({ status }: { status: unknown }) {
  const value = String(status || "UNKNOWN");
  const tone =
    ["AVAILABLE", "RETURNED", "COMPLETED", "CLOSED"].includes(value)
      ? "ok"
      : ["MAINTENANCE", "AWAITING_INSPECTION", "WAITING_PARTS", "PENDING"].includes(value)
        ? "warn"
        : ["MISSING", "EXCEPTION", "RETIRE_RECOMMENDED"].includes(value)
          ? "danger"
          : "info";
  return <span className={`status-pill ${tone}`}>{statusLabels[value] || value}</span>;
}

function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="brand-mark"><Snowflake size={24} /></div>
      <LoaderCircle className="spin" size={22} />
      <p>正在连接 BSR 云端业务数据…</p>
    </div>
  );
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <div className="empty-icon"><ClipboardCheck size={22} /></div>
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

export default function Dashboard() {
  const [state, setState] = useState<SystemState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [role, setRole] = useState<Role>("STAFF");
  const [view, setView] = useState<View>("overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; message: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setError("");
      const response = await fetch("/api/system", { cache: "no-store" });
      const payload = (await response.json()) as SystemState & { error?: string };
      if (!response.ok) throw new Error(payload.error || "读取数据失败");
      setState(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法连接云端系统");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const actor = useMemo(
    () => state?.users.find((user) => user.role === role) ?? state?.users[0],
    [state, role],
  );

  const act = useCallback(async (action: string, payload: Record<string, unknown>) => {
    setBusy(action);
    try {
      const response = await fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, actorUserId: actor?.id ?? 1, ...payload }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        error?: string;
        result?: Record<string, unknown>;
      };
      if (!response.ok || !result.ok) throw new Error(result.error || "操作失败");
      setNotice({ tone: "success", message: action === "lookupReservation" ? "预约资料已载入" : "业务记录与审计日志已同步" });
      if (action !== "lookupReservation") await load();
      return result.result;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "操作失败";
      setNotice({ tone: "error", message });
      throw cause;
    } finally {
      setBusy("");
    }
  }, [actor, load]);

  if (!state && !error) return <LoadingScreen />;
  if (!state) {
    return (
      <div className="loading-screen">
        <AlertTriangle size={30} />
        <h1>系统暂时无法载入</h1>
        <p>{error}</p>
        <button className="primary-button" onClick={() => void load()}><RefreshCw size={16} />重新连接</button>
      </div>
    );
  }

  const navigation: Array<{ id: View; label: string; icon: typeof Gauge; roles: Role[] }> = [
    { id: "overview", label: "运营总览", icon: LayoutDashboard, roles: ["STAFF", "MANAGER", "CONTRACTOR"] },
    { id: "reception", label: "租赁接待", icon: UsersRound, roles: ["STAFF", "MANAGER"] },
    { id: "contracts", label: "合同与归还", icon: ReceiptText, roles: ["STAFF", "MANAGER"] },
    { id: "inventory", label: "装备库存", icon: Boxes, roles: ["STAFF", "MANAGER"] },
    { id: "repairs", label: "维修协同", icon: Wrench, roles: ["STAFF", "MANAGER", "CONTRACTOR"] },
    { id: "audit", label: "审计记录", icon: Activity, roles: ["MANAGER"] },
  ];
  const visibleNavigation = navigation.filter((item) => item.roles.includes(role));
  const current = navigation.find((item) => item.id === view) ?? navigation[0];

  function chooseRole(nextRole: Role) {
    setRole(nextRole);
    setMenuOpen(false);
    const allowed = navigation.find((item) => item.id === view)?.roles.includes(nextRole);
    if (!allowed) setView(nextRole === "CONTRACTOR" ? "repairs" : "overview");
  }

  return (
    <div className="app-shell">
      <aside className={cn("sidebar", menuOpen && "open")}>
        <div className="sidebar-brand">
          <div className="brand-mark"><Snowflake size={23} /></div>
          <div><strong>BSR</strong><span>Rental Operations</span></div>
          <button className="icon-button mobile-only" onClick={() => setMenuOpen(false)} aria-label="关闭菜单"><X size={18} /></button>
        </div>
        <nav className="nav-list" aria-label="主导航">
          <span className="nav-section">业务工作区</span>
          {visibleNavigation.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={cn("nav-item", view === item.id && "active")} onClick={() => { setView(item.id); setMenuOpen(false); }}>
                <Icon size={18} /><span>{item.label}</span>
                {item.id === "repairs" && state.summary.openRepairs > 0 && <b>{state.summary.openRepairs}</b>}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <div className="sync-state"><span className="live-dot" /><div><strong>云端数据已同步</strong><small>{formatDate(state.generatedAt)} 更新</small></div></div>
          <div className="season-card"><Snowflake size={16} /><div><strong>2026 雪季</strong><span>双门店协同运行中</span></div></div>
        </div>
      </aside>

      {menuOpen && <button className="scrim" onClick={() => setMenuOpen(false)} aria-label="关闭导航" />}

      <section className="workspace">
        <header className="topbar">
          <div className="topbar-title">
            <button className="icon-button mobile-only" onClick={() => setMenuOpen(true)} aria-label="打开菜单"><Menu size={20} /></button>
            <div><span>BSR 运营中心</span><h1>{current.label}</h1></div>
          </div>
          <div className="topbar-actions">
            <button className="icon-button" onClick={() => void load()} aria-label="刷新数据"><RefreshCw size={18} /></button>
            <div className="role-switch" role="group" aria-label="业务角色">
              {(Object.keys(roleLabels) as Role[]).map((item) => (
                <button key={item} className={role === item ? "active" : ""} onClick={() => chooseRole(item)}>{roleLabels[item]}</button>
              ))}
            </div>
            <div className="user-chip"><div className="avatar">{String(actor?.name || "B").slice(0, 1)}</div><div><strong>{actor?.name}</strong><span>{roleLabels[role]} · 当前工作区</span></div></div>
          </div>
        </header>

        <main className="content">
          {view === "overview" && <Overview state={state} role={role} onNavigate={setView} />}
          {view === "reception" && <Reception state={state} act={act} busy={busy} onDone={() => setView("contracts")} />}
          {view === "contracts" && <Contracts state={state} act={act} busy={busy} />}
          {view === "inventory" && <Inventory state={state} act={act} busy={busy} />}
          {view === "repairs" && <Repairs state={state} role={role} act={act} busy={busy} />}
          {view === "audit" && <Audit state={state} />}
        </main>
      </section>

      {notice && <div className={cn("toast", notice.tone)}>{notice.tone === "success" ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}<span>{notice.message}</span></div>}
    </div>
  );
}

function PageHeading({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail: string; action?: React.ReactNode }) {
  return (
    <div className="page-heading">
      <div><span>{eyebrow}</span><h2>{title}</h2><p>{detail}</p></div>
      {action}
    </div>
  );
}

function Overview({ state, role, onNavigate }: { state: SystemState; role: Role; onNavigate: (view: View) => void }) {
  const [storeFilter, setStoreFilter] = useState("ALL");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const inPeriod = (value: unknown) => {
    if (!value) return true;
    const time = new Date(String(value)).getTime();
    if (fromDate && time < new Date(`${fromDate}T00:00:00`).getTime()) return false;
    if (toDate && time > new Date(`${toDate}T23:59:59`).getTime()) return false;
    return true;
  };
  const inStore = (value: unknown) => storeFilter === "ALL" || Number(value) === Number(storeFilter);
  const scopedEquipment = state.equipment.filter((item) => inStore(item.storeId));
  const scopedContracts = state.contracts.filter((item) => inStore(item.pickupStoreId) && inPeriod(item.startAt));
  const scopedTasks = state.tasks.filter((item) => inStore(item.storeId) && inPeriod(item.startedAt));
  const scopedRepairs = state.repairs.filter((item) => {
    const equipment = state.equipment.find((entry) => Number(entry.id) === Number(item.equipmentId));
    return inStore(equipment?.storeId) && inPeriod(item.openedAt);
  });
  const occupied = scopedEquipment.filter((item) => ["RENTED", "RESERVED"].includes(String(item.status))).length;
  const summary = role === "MANAGER" ? {
    activeContracts: scopedContracts.filter((item) => ["CONFIRMED", "ACTIVE", "REFUND_PROCESSING"].includes(String(item.status))).length,
    waitingTasks: scopedTasks.filter((item) => item.status !== "COMPLETED").length,
    availableEquipment: scopedEquipment.filter((item) => item.status === "AVAILABLE").length,
    utilization: scopedEquipment.length ? Math.round((occupied / scopedEquipment.length) * 100) : 0,
    openRepairs: scopedRepairs.filter((item) => !["CLOSED", "RETIRED"].includes(String(item.status))).length,
    overdue: scopedContracts.filter((item) => item.status === "ACTIVE" && new Date(String(item.endAt)) < new Date()).length,
  } : state.summary;
  const cards = [
    { label: "进行中合同", value: summary.activeContracts, note: `${summary.overdue} 项逾期`, icon: ReceiptText, tone: "teal" },
    { label: "等待办理", value: summary.waitingTasks, note: "跨两家门店", icon: UsersRound, tone: "blue" },
    { label: "装备利用率", value: `${summary.utilization}%`, note: `${summary.availableEquipment} 件可出租`, icon: Gauge, tone: "violet" },
    { label: "维修待办", value: summary.openRepairs, note: "含待验收项目", icon: Wrench, tone: "amber" },
  ];
  const byStore = state.stores.filter((store) => storeFilter === "ALL" || String(store.id) === storeFilter).map((store) => {
    const inventory = scopedEquipment.filter((item) => Number(item.storeId) === store.id);
    const busy = inventory.filter((item) => ["RENTED", "RESERVED"].includes(String(item.status))).length;
    return { ...store, total: inventory.length, busy, available: inventory.filter((item) => item.status === "AVAILABLE").length };
  });
  const roleCopy = role === "CONTRACTOR" ? "查看分配工单与待验收进度" : role === "MANAGER" ? "关注积压、利用率和异常待办" : "从接待到归还，在一个工作台完成";
  return (
    <>
      <PageHeading eyebrow="运营快照" title="早上好，雪季工作台已就绪" detail={`${roleCopy}。数据完整性：${state.dataCompleteness}；截止 ${formatDate(state.dataCutoff)}。`} action={<button className="primary-button" onClick={() => onNavigate(role === "CONTRACTOR" ? "repairs" : "reception")}><Plus size={17} />{role === "CONTRACTOR" ? "处理工单" : "开始接待"}</button>} />
      {role === "MANAGER" && <section className="panel manager-filters"><div className="panel-heading"><div><span className="eyebrow">统计筛选</span><h3>按时间与门店查看经营指标</h3></div><span className="data-chip"><BarChart3 size={13} />{storeFilter === "ALL" ? "全部门店" : state.stores.find((store) => String(store.id) === storeFilter)?.name}</span></div><div className="filter-fields"><label><span>门店</span><select value={storeFilter} onChange={(event) => setStoreFilter(event.target.value)}><option value="ALL">全部门店</option>{state.stores.map((store) => <option value={store.id} key={store.id}>{store.name}</option>)}</select></label><label><span>开始日期</span><input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label><label><span>结束日期</span><input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label><button className="secondary-button" onClick={() => { setStoreFilter("ALL"); setFromDate(""); setToDate(""); }}><RefreshCw size={15} />重置筛选</button></div></section>}
      <section className="metrics-grid">
        {cards.map((card) => { const Icon = card.icon; return <article className="metric-card" key={card.label}><div className={`metric-icon ${card.tone}`}><Icon size={19} /></div><span>{card.label}</span><strong>{card.value}</strong><small>{card.note}</small></article>; })}
      </section>
      <section className="overview-grid">
        <article className="panel operations-panel">
          <div className="panel-heading"><div><span className="eyebrow">门店负载</span><h3>今日双店运营</h3></div><span className="data-chip"><Cloud size={13} />实时汇总</span></div>
          <div className="store-comparison">
            {byStore.map((store, index) => {
              const utilization = store.total ? Math.round((store.busy / store.total) * 100) : 0;
              return (
                <div className="store-row" key={store.id}>
                  <div className={`store-badge s${index + 1}`}><Store size={18} /></div>
                  <div className="store-info"><strong>{store.name}</strong><span>{store.address}</span><div className="progress-track"><i style={{ width: `${utilization}%` }} /></div></div>
                  <div className="store-stat"><strong>{utilization}%</strong><span>{store.available} 件可用</span></div>
                </div>
              );
            })}
          </div>
          <div className="workflow-strip">
            {[{ label: "待接待", value: summary.waitingTasks, icon: UsersRound }, { label: "租赁中", value: summary.activeContracts, icon: PackageCheck }, { label: "维修中", value: summary.openRepairs, icon: HardHat }].map((step, index) => { const Icon = step.icon; return <div key={step.label}><span><Icon size={16} /></span><strong>{step.value}</strong><small>{step.label}</small>{index < 2 && <ChevronRight size={16} />}</div>; })}
          </div>
        </article>
        <article className="panel alert-panel">
          <div className="panel-heading"><div><span className="eyebrow">优先处理</span><h3>异常与超时待办</h3></div><Bell size={18} /></div>
          <div className="alert-list">
            {state.alerts.length ? state.alerts.slice(0, 5).map((alert) => <div className="alert-item" key={`${alert.kind}-${alert.id}`}><span className={`alert-dot ${alert.level}`} /><div><strong>{alert.title}</strong><small>{alert.detail}</small></div><ChevronRight size={16} /></div>) : <Empty title="暂无异常" detail="所有业务都在约定时限内" />}
          </div>
        </article>
      </section>
      <section className="panel activity-panel">
        <div className="panel-heading"><div><span className="eyebrow">最近动态</span><h3>可追踪的业务操作</h3></div><button className="text-button" onClick={() => onNavigate("audit")}>查看全部 <ChevronRight size={15} /></button></div>
        <div className="activity-list">
          {state.audits.slice(0, 5).map((event) => <div className="activity-item" key={String(event.id)}><div className="activity-icon"><Activity size={16} /></div><div><strong>{eventLabels[String(event.eventType)] || event.eventType}</strong><span>{event.actorName || "系统"} · {event.entityType} #{event.entityId}</span></div><time>{formatDate(event.occurredAt)}</time><StatusBadge status={event.toStatus} /></div>)}
        </div>
      </section>
    </>
  );
}

type Act = (action: string, payload: Record<string, unknown>) => Promise<Record<string, unknown> | undefined>;

function Reception({ state, act, busy, onDone }: { state: SystemState; act: Act; busy: string; onDone: () => void }) {
  const [form, setForm] = useState(() => {
    const current = Date.now();
    return { reservationNo: "", name: "", phone: "", email: "", storeId: String(state.stores[0]?.id || 1), startAt: isoForInput(new Date(current + 60 * 60 * 1000)), endAt: isoForInput(new Date(current + 3 * 86_400_000)), heightCm: "", weightKg: "", footLengthMm: "", shoeSize: "", skillLevel: "BEGINNER", preference: "" };
  });
  const [reception, setReception] = useState<ReceptionResult | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const recommendations = reception?.recommendations ?? [];
  const selectedRows = recommendations.filter((row) => selected.includes(Number(row.id)));
  const days = Math.max(1, Math.ceil((new Date(form.endAt).getTime() - new Date(form.startAt).getTime()) / 86_400_000));
  const estimate = selectedRows.reduce((sum, row) => sum + Number(row.estimatedPrice), 100);

  async function loadReservation() {
    if (!form.reservationNo.trim()) return;
    const result = await act("lookupReservation", { reservationNo: form.reservationNo }) as Record<string, unknown> | undefined;
    if (!result) return;
    setForm((current) => ({
      ...current,
      reservationNo: String(result.reservationNo || current.reservationNo),
      name: String(result.name || ""),
      phone: String(result.phone || ""),
      email: String(result.email || ""),
      storeId: String(result.storeId || current.storeId),
      startAt: isoForInput(new Date(String(result.startAt))),
      endAt: isoForInput(new Date(String(result.endAt))),
      heightCm: String(result.heightCm || ""),
      weightKg: String(result.weightKg || ""),
      footLengthMm: String(result.footLengthMm || ""),
      shoeSize: String(result.shoeSize || ""),
      skillLevel: String(result.skillLevel || "BEGINNER"),
      preference: String(result.preference || ""),
    }));
  }

  async function submitReception(event: FormEvent) {
    event.preventDefault();
    const result = await act("createReception", { ...form, storeId: Number(form.storeId) }) as ReceptionResult | undefined;
    if (result) {
      setReception(result);
      const rows = result.recommendations;
      const firstByCategory = new Map<string, number>();
      rows.forEach((row) => { if (!firstByCategory.has(String(row.categoryCode))) firstByCategory.set(String(row.categoryCode), Number(row.id)); });
      setSelected([...firstByCategory.values()].slice(0, 4));
    }
  }
  async function submitContract() {
    if (!reception) return;
    await act("createContract", { taskId: reception.taskId, equipmentIds: selected, startAt: form.startAt, endAt: form.endAt });
    onDone();
  }
  return (
    <>
      <PageHeading eyebrow="UC01 · UC02" title="接待顾客并完成租赁" detail="复用顾客资料、记录排队顺序，按适配与安全条件推荐单件装备，并生成防重支付请求。" />
      <section className="two-column-workflow">
        <form className="panel form-panel" onSubmit={submitReception}>
          <div className="panel-heading"><div><span className="step-number">01</span><h3>顾客与租期</h3></div>{reception && <span className="complete-chip"><Check size={14} />已登记 · {String(reception.queueNo).padStart(2, "0")} 号</span>}</div>
          <div className="form-grid">
            <label className="span-2"><span>预约单号</span><div className="input-action"><input value={form.reservationNo} onChange={(e) => setForm({ ...form, reservationNo: e.target.value })} placeholder="例如：RSV-260101；现场顾客可留空" /><button type="button" className="secondary-button" disabled={!form.reservationNo.trim() || busy === "lookupReservation"} onClick={() => void loadReservation()}>{busy === "lookupReservation" ? <LoaderCircle className="spin" size={16} /> : <Search size={16} />}读取预约</button></div></label>
            <label><span>顾客姓名 *</span><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：李知夏" /></label>
            <label><span>联系电话 *</span><input required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="用于识别已有资料" /></label>
            <label className="span-2"><span>电子邮箱</span><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="选填" /></label>
            <label><span>取件门店 *</span><select value={form.storeId} onChange={(e) => setForm({ ...form, storeId: e.target.value })}>{state.stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
            <label><span>技能水平 *</span><select value={form.skillLevel} onChange={(e) => setForm({ ...form, skillLevel: e.target.value })}><option value="BEGINNER">初学者</option><option value="INTERMEDIATE">中级</option><option value="ADVANCED">高级</option></select></label>
            <label><span>开始时间 *</span><input required type="datetime-local" value={form.startAt} onChange={(e) => setForm({ ...form, startAt: e.target.value })} /></label>
            <label><span>结束时间 *</span><input required type="datetime-local" value={form.endAt} onChange={(e) => setForm({ ...form, endAt: e.target.value })} /></label>
          </div>
          <div className="form-divider"><span>适配资料</span></div>
          <div className="form-grid compact">
            <label><span>身高 cm *</span><input required type="number" min="120" max="220" value={form.heightCm} onChange={(e) => setForm({ ...form, heightCm: e.target.value })} /></label>
            <label><span>体重 kg</span><input type="number" min="30" max="180" value={form.weightKg} onChange={(e) => setForm({ ...form, weightKg: e.target.value })} /></label>
            <label><span>脚长 mm</span><input type="number" min="190" max="330" value={form.footLengthMm} onChange={(e) => setForm({ ...form, footLengthMm: e.target.value })} /></label>
            <label><span>欧码 *</span><input required type="number" step="0.5" min="30" max="50" value={form.shoeSize} onChange={(e) => setForm({ ...form, shoeSize: e.target.value })} /></label>
            <label className="span-2"><span>偏好与说明</span><textarea value={form.preference} onChange={(e) => setForm({ ...form, preference: e.target.value })} placeholder="例如：偏好稳定、舒适，曾有脚踝不适" /></label>
          </div>
          <button className="primary-button wide" disabled={busy === "createReception"}>{busy === "createReception" ? <LoaderCircle className="spin" size={17} /> : <Search size={17} />}查询可用装备并推荐</button>
        </form>

        <div className="panel recommendation-panel">
          <div className="panel-heading"><div><span className="step-number">02</span><h3>适配与安全推荐</h3></div><span className="data-chip"><ShieldCheck size={13} />已校验安全检查</span></div>
          {!reception ? <Empty title="等待顾客资料" detail="可读取预约或登记现场顾客，随后跨店查询单件装备" /> : <>
            <div className="recommendation-summary"><div><strong>{recommendations.length}</strong><span>件候选装备</span></div><p>已排除租期冲突、维修中、安全检查过期及不兼容装备；同门店候选优先。</p></div>
            <div className="recommendation-list">
              {recommendations.map((row) => {
                const checked = selected.includes(Number(row.id));
                return <button type="button" key={String(row.id)} className={cn("equipment-option", checked && "selected")} onClick={() => setSelected(checked ? selected.filter((id) => id !== Number(row.id)) : [...selected, Number(row.id)])}><span className="check-box">{checked && <Check size={14} />}</span><div><span>{row.categoryName} · {row.brand}</span><strong>{row.modelName} <em>{row.sizeSpec}</em></strong><small>{row.assetNo} · {row.storeName} · {row.fitReason}</small><small>{row.safetyNote} · {money(row.dailyRate)}/天 · 预计 {money(row.estimatedPrice)}</small></div><StatusBadge status="AVAILABLE" /></button>;
              })}
            </div>
            {!recommendations.length && <Empty title="当前没有适配装备" detail={String(reception.alternativeAdvice || "可调整租期、门店或规格后重新查询")} />}
            <div className="price-summary"><div><span>{days} 天租赁 · {selected.length} 件装备</span><strong>{money(estimate)}</strong><small>含 ¥100 押金，最终金额以合同价格快照为准</small></div><button className="primary-button" onClick={() => void submitContract()} disabled={!selected.length || busy === "createContract"}>{busy === "createContract" ? <LoaderCircle className="spin" size={17} /> : <ReceiptText size={17} />}确认方案并收费</button></div>
          </>}
        </div>
      </section>
    </>
  );
}

function Contracts({ state, act, busy }: { state: SystemState; act: Act; busy: string }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [mode, setMode] = useState<"return" | "exchange" | null>(null);
  const [returnForm, setReturnForm] = useState({ returnStoreId: String(state.stores[0]?.id || 1), condition: "OK", adjustment: "0" });
  const [exchangeForm, setExchangeForm] = useState({ oldItemId: "", newEquipmentId: "", adjustment: "0" });
  const selected = state.contracts.find((item) => Number(item.id) === selectedId);
  const available = state.equipment.filter((item) => item.status === "AVAILABLE");
  const itemIds = String(selected?.itemIds || "").split(",").filter(Boolean);

  async function completeReturn(event: FormEvent) {
    event.preventDefault();
    if (!selectedId) return;
    await act("returnContract", { contractId: selectedId, returnStoreId: Number(returnForm.returnStoreId), condition: returnForm.condition, adjustment: Number(returnForm.adjustment) });
    setMode(null); setSelectedId(null);
  }
  async function completeExchange(event: FormEvent) {
    event.preventDefault();
    if (!selectedId) return;
    await act("exchangeEquipment", { contractId: selectedId, oldItemId: Number(exchangeForm.oldItemId), newEquipmentId: Number(exchangeForm.newEquipmentId), adjustment: Number(exchangeForm.adjustment) });
    setMode(null); setSelectedId(null);
  }
  return (
    <>
      <PageHeading eyebrow="UC02 · UC03" title="合同、交付、换装与归还" detail="合同绑定单件装备与价格快照；支持跨店归还、价差调整和故障隔离。" />
      <section className="panel table-panel">
        <div className="panel-heading"><div><span className="eyebrow">租赁合同</span><h3>{state.contracts.length} 条业务记录</h3></div><div className="legend"><span><i className="dot teal" />正常</span><span><i className="dot amber" />待处理</span></div></div>
        <div className="responsive-table">
          <table><thead><tr><th>合同 / 顾客</th><th>装备</th><th>租期</th><th>金额</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>{state.contracts.map((contract) => <tr key={String(contract.id)}><td><strong>{contract.contractNo}</strong><span>{contract.customerName} · {contract.phone}</span></td><td><strong className="equipment-cell">{contract.equipmentLabel || "—"}</strong><span>{contract.pickupStore}</span></td><td><strong>{formatDate(contract.startAt)} → {formatDate(contract.endAt)}</strong><span>{contract.lastReturnedAt ? `最近归还 ${formatDate(contract.lastReturnedAt)}` : "按计划执行"}</span></td><td><strong>{money(contract.amountDue)}</strong><span>{contract.paymentRequestNo || "价格快照已保存"}</span></td><td><StatusBadge status={contract.status} /></td><td><div className="row-actions">{contract.status === "CONFIRMED" && <button onClick={() => void act("activateContract", { contractId: contract.id })} disabled={busy === "activateContract"}><PackageCheck size={15} />交付</button>}{contract.status === "ACTIVE" && <><button onClick={() => { setSelectedId(Number(contract.id)); setMode("exchange"); setExchangeForm({ oldItemId: itemIds[0] || "", newEquipmentId: String(available[0]?.id || ""), adjustment: "0" }); }}><ArrowLeftRight size={15} />换装</button><button className="accent" onClick={() => { setSelectedId(Number(contract.id)); setMode("return"); setReturnForm({ ...returnForm, returnStoreId: String(contract.pickupStoreId) }); }}><ClipboardCheck size={15} />归还</button></>}</div></td></tr>)}</tbody>
          </table>
        </div>
      </section>
      {selected && mode && <div className="dialog-backdrop" onMouseDown={() => setMode(null)}><div className="dialog-card" onMouseDown={(e) => e.stopPropagation()}><div className="dialog-head"><div><span>{mode === "return" ? "办理归还" : "更换装备"}</span><h3>{selected.contractNo}</h3></div><button className="icon-button" onClick={() => setMode(null)}><X size={18} /></button></div>{mode === "return" ? <form onSubmit={completeReturn} className="dialog-form"><div className="contract-mini"><ReceiptText size={20} /><div><strong>{selected.customerName}</strong><span>{selected.equipmentLabel}</span></div><StatusBadge status={selected.status} /></div><label><span>实际归还门店</span><select value={returnForm.returnStoreId} onChange={(e) => setReturnForm({ ...returnForm, returnStoreId: e.target.value })}>{state.stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label><label><span>装备检查结果</span><select value={returnForm.condition} onChange={(e) => setReturnForm({ ...returnForm, condition: e.target.value })}><option value="OK">状态正常，可重新出租</option><option value="DAMAGED">发现损坏，先隔离装备</option><option value="MISSING">装备缺失，转异常处理</option></select></label>{returnForm.condition === "DAMAGED" && <div className="latest-update"><AlertTriangle size={17} /><div><span>后续处理</span><strong>归还完成后请在装备库存中单独建立维修工单</strong></div></div>}<label><span>费用调整（正数补款 / 负数退款）</span><input type="number" value={returnForm.adjustment} onChange={(e) => setReturnForm({ ...returnForm, adjustment: e.target.value })} /></label><button className="primary-button wide" disabled={busy === "returnContract"}>{busy === "returnContract" ? <LoaderCircle className="spin" size={17} /> : <CheckCircle2 size={17} />}确认归还并写入审计</button></form> : <form onSubmit={completeExchange} className="dialog-form"><label><span>原合同装备明细</span><select required value={exchangeForm.oldItemId} onChange={(e) => setExchangeForm({ ...exchangeForm, oldItemId: e.target.value })}>{itemIds.map((id, index) => <option value={id} key={id}>明细 #{id} · {String(selected.equipmentLabel).split(" / ")[index]}</option>)}</select></label><label><span>替换为可用装备</span><select required value={exchangeForm.newEquipmentId} onChange={(e) => setExchangeForm({ ...exchangeForm, newEquipmentId: e.target.value })}>{available.map((item) => <option value={String(item.id)} key={String(item.id)}>{item.assetNo} · {item.modelName} · {item.storeName}</option>)}</select></label><label><span>价差（正数补款 / 负数退款）</span><input type="number" value={exchangeForm.adjustment} onChange={(e) => setExchangeForm({ ...exchangeForm, adjustment: e.target.value })} /></label><button className="primary-button wide" disabled={busy === "exchangeEquipment"}>{busy === "exchangeEquipment" ? <LoaderCircle className="spin" size={17} /> : <ArrowLeftRight size={17} />}确认换装</button></form>}</div></div>}
    </>
  );
}

function Inventory({ state, act, busy }: { state: SystemState; act: Act; busy: string }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [repairTarget, setRepairTarget] = useState<Record<string, string | number | null> | null>(null);
  const [repairForm, setRepairForm] = useState({ contractorId: "", description: "" });
  const filtered = state.equipment.filter((item) => {
    const haystack = `${item.assetNo} ${item.modelName} ${item.categoryName} ${item.storeName}`.toLowerCase();
    return haystack.includes(query.toLowerCase()) && (status === "ALL" || item.status === status);
  });
  async function createRepair(event: FormEvent) {
    event.preventDefault();
    if (!repairTarget) return;
    await act("createRepair", { equipmentId: repairTarget.id, ...repairForm });
    setRepairTarget(null); setRepairForm({ contractorId: "", description: "" });
  }
  return (
    <>
      <PageHeading eyebrow="单件资产追踪" title="装备库存与安全状态" detail="统一查看两家门店的实际位置、租赁状态、入库日期和最近安全检查有效期。" />
      <section className="panel inventory-panel">
        <div className="toolbar"><div className="search-box"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索资产编号、型号或门店" /></div><div className="filter-tabs">{["ALL", "AVAILABLE", "RENTED", "RESERVED", "MAINTENANCE", "AWAITING_INSPECTION"].map((item) => <button key={item} className={status === item ? "active" : ""} onClick={() => setStatus(item)}>{item === "ALL" ? "全部" : statusLabels[item]}</button>)}</div></div>
        <div className="inventory-grid">{filtered.map((item) => <article className="inventory-card" key={String(item.id)}><div className="inventory-card-top"><span className={`asset-icon ${String(item.categoryCode).toLowerCase()}`}><Snowflake size={20} /></span><StatusBadge status={item.status} /></div><span className="asset-no">{item.assetNo}</span><h3>{item.modelName}</h3><p>{item.brand} · {item.sizeSpec} · {item.categoryName}</p><dl><div><dt>当前位置</dt><dd>{item.storeName}</dd></div><div><dt>入库日期</dt><dd>{formatDate(item.acquiredAt, false)}</dd></div><div><dt>适用水平</dt><dd>{item.skillLevel || "通用"}</dd></div><div><dt>安全有效期</dt><dd>{item.safetyValidUntil ? formatDate(item.safetyValidUntil, false) : "待检查"}</dd></div></dl>{(["AVAILABLE", "MAINTENANCE"].includes(String(item.status)) && !Number(item.hasOpenRepair)) && <button className="secondary-button wide" onClick={() => setRepairTarget(item)}><Wrench size={15} />报告故障并隔离</button>}</article>)}</div>
      </section>
      {repairTarget && <div className="dialog-backdrop" onMouseDown={() => setRepairTarget(null)}><form className="dialog-card dialog-form" onSubmit={createRepair} onMouseDown={(e) => e.stopPropagation()}><div className="dialog-head"><div><span>UC04 · 提交维修工单</span><h3>{repairTarget.assetNo}</h3></div><button type="button" className="icon-button" onClick={() => setRepairTarget(null)}><X size={18} /></button></div><div className="contract-mini"><Wrench size={20} /><div><strong>{repairTarget.modelName}</strong><span>{repairTarget.storeName} · {statusLabels[String(repairTarget.status)]}</span></div></div><label><span>维修承包商</span><select value={repairForm.contractorId} onChange={(e) => setRepairForm({ ...repairForm, contractorId: e.target.value })}><option value="">暂不分配</option>{state.contractors.map((contractor) => <option value={contractor.id} key={contractor.id}>{contractor.name} · {contractor.contactPhone}</option>)}</select></label><label><span>故障现象</span><textarea required value={repairForm.description} onChange={(e) => setRepairForm({ ...repairForm, description: e.target.value })} placeholder="说明损坏部位、异常表现和发现时间" /></label><button className="primary-button wide" disabled={busy === "createRepair"}>{busy === "createRepair" ? <LoaderCircle className="spin" size={17} /> : <ShieldCheck size={17} />}建立工单并立即隔离</button></form></div>}
    </>
  );
}

function Repairs({ state, role, act, busy }: { state: SystemState; role: Role; act: Act; busy: string }) {
  const [selectedId, setSelectedId] = useState<number | null>(Number(state.repairs[0]?.id || 0) || null);
  const [update, setUpdate] = useState({ progressStatus: "IN_PROGRESS", note: "" });
  const [inspection, setInspection] = useState({ result: "PASS", note: "" });
  const selected = state.repairs.find((repair) => Number(repair.id) === selectedId);
  const contractorUser = state.users.find((user) => user.role === "CONTRACTOR");
  const canUpdate = role === "CONTRACTOR" && Number(selected?.contractorId) === Number(contractorUser?.contractorId);
  async function submitUpdate(event: FormEvent) {
    event.preventDefault(); if (!selectedId) return;
    await act("updateRepair", { repairId: selectedId, ...update }); setUpdate({ ...update, note: "" });
  }
  async function submitInspection(event: FormEvent) {
    event.preventDefault(); if (!selectedId) return;
    await act("inspectRepair", { repairId: selectedId, ...inspection }); setInspection({ ...inspection, note: "" });
  }
  return (
    <>
      <PageHeading eyebrow="UC04 · UC05" title="维修协同与安全验收" detail={role === "CONTRACTOR" ? "仅更新分配工单的进度与结果；完成维修后仍需门店验收。" : "故障装备立即隔离；维修过程保留历史，检查合格后才恢复可租。"} />
      <section className="repair-layout">
        <div className="panel repair-list-panel"><div className="panel-heading"><div><span className="eyebrow">工单队列</span><h3>{state.repairs.length} 张工单</h3></div><HardHat size={18} /></div><div className="repair-list">{state.repairs.map((repair) => <button key={String(repair.id)} className={cn("repair-row", selectedId === Number(repair.id) && "active")} onClick={() => setSelectedId(Number(repair.id))}><div><span>{repair.ticketNo}</span><strong>{repair.assetNo} · {repair.modelName}</strong><small>{repair.storeName} · {formatDate(repair.openedAt)}</small></div><StatusBadge status={repair.status} /></button>)}</div></div>
        <div className="panel repair-detail">{selected ? <><div className="repair-hero"><div className="repair-symbol"><Wrench size={26} /></div><div><span>{selected.ticketNo}</span><h3>{selected.assetNo} · {selected.modelName}</h3><p>{selected.description}</p></div><StatusBadge status={selected.status} /></div><div className="detail-grid"><div><span>装备当前位置</span><strong>{selected.storeName}</strong></div><div><span>维修承包商</span><strong>{selected.contractorName || "待分配"}</strong></div><div><span>工单状态</span><strong>{statusLabels[String(selected.status)] || selected.status}</strong></div><div><span>建立时间</span><strong>{formatDate(selected.openedAt)}</strong></div></div>{selected.latestNote && <div className="latest-update"><Clock3 size={17} /><div><span>最近更新 · {formatDate(selected.latestUpdateAt)}</span><strong>{selected.latestNote}</strong></div></div>}{canUpdate && !["CLOSED", "RETIRED"].includes(String(selected.status)) && <form className="inline-action-form" onSubmit={submitUpdate}><h4>提交维修进度</h4><label><span>进度状态</span><select value={update.progressStatus} onChange={(e) => setUpdate({ ...update, progressStatus: e.target.value })}><option value="IN_PROGRESS">维修中</option><option value="WAITING_PARTS">等待备件</option><option value="AWAITING_INSPECTION">维修完成，提交验收</option><option value="RETIRE_RECOMMENDED">无法修复，建议退役</option></select></label><label><span>处理说明</span><textarea required value={update.note} onChange={(e) => setUpdate({ ...update, note: e.target.value })} placeholder="说明检查、维修或备件情况" /></label><button className="primary-button" disabled={busy === "updateRepair"}>{busy === "updateRepair" ? <LoaderCircle className="spin" size={17} /> : <FileText size={17} />}保存进度</button></form>}{role === "CONTRACTOR" && !canUpdate && <div className="latest-update"><ShieldCheck size={17} /><div><span>权限范围</span><strong>该工单未分配给当前承包商</strong></div></div>}{role !== "CONTRACTOR" && selected.status === "AWAITING_INSPECTION" && <form className="inline-action-form" onSubmit={submitInspection}><h4>门店安全验收</h4><label><span>检查结果</span><select value={inspection.result} onChange={(e) => setInspection({ ...inspection, result: e.target.value })}><option value="PASS">合格 · 恢复可出租</option><option value="FAIL">不合格 · 退回维修</option></select></label><label><span>验收说明</span><textarea value={inspection.note} onChange={(e) => setInspection({ ...inspection, note: e.target.value })} placeholder="记录功能测试与安全检查" /></label><button className="primary-button" disabled={busy === "inspectRepair"}>{busy === "inspectRepair" ? <LoaderCircle className="spin" size={17} /> : <ShieldCheck size={17} />}提交验收结果</button></form>}</> : <Empty title="暂无维修工单" detail="从装备库存报告故障后，工单会显示在这里" />}</div>
      </section>
    </>
  );
}

function Audit({ state }: { state: SystemState }) {
  return (
    <>
      <PageHeading eyebrow="只追加审计" title="业务操作追踪" detail="每次状态变化都记录操作者、受影响对象、前后状态和发生时间，不覆盖历史。" />
      <section className="panel timeline-panel"><div className="timeline">{state.audits.map((event) => <article className="timeline-event" key={String(event.id)}><div className="timeline-marker"><Activity size={15} /></div><div className="timeline-card"><div><span>{eventLabels[String(event.eventType)] || event.eventType}</span><time>{formatDate(event.occurredAt)}</time></div><h3>{event.entityType} #{event.entityId}</h3><p>{event.actorName || "系统"} 执行操作，结果为 {event.result}。</p><div className="status-transition"><StatusBadge status={event.fromStatus || "新建"} /><ChevronRight size={15} /><StatusBadge status={event.toStatus || event.result} /></div></div></article>)}</div></section>
    </>
  );
}
