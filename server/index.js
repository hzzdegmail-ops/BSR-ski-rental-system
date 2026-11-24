import assets from './assets.js';
import { BusinessError, audit, dbFor, now, requireRule, textField } from './data.js';
import { accounts, seed } from './seed.js';
import { cookieName, sessionCookie, tokens } from './security.js';
import { beginTask, cancelReception, closeLegacyUncollectedTasks, enqueue, getTask, lookupCustomer, receptionQueue, recommendTask, restoreReceptionStages } from './reception.js';
import { confirmContract, pickupContract, quoteContract } from './contracts.js';
import { contractDetail, contractList, findContract } from './contract-repository.js';
import { cancelUncollected, exchangeChoices, executeExchange, executeReturn, quoteReturn, retryPayment } from './returns.js';
import { assignRepair, inspectAsset, inspectRepair, inventory, repairDetail, repairList, submitRepair, updateRepair } from './repairs.js';
import { operations } from './operations.js';
import {ensureMetricSchema} from './operations-repository.js';
import { backfillRepairStores } from './repair-repository.js';
import { expirePaymentHolds } from './payment-holds.js';
import { ensureReservationSchema, refreshReservationStates, pendingReservations, reservationList, reservationDetail, saveReservation, prepareReservation, endReservation } from './reservations.js';
import { ensureEquipmentIdentitySchema, normalizeEquipmentNames } from './equipment-names.js';
import {ensureAdvanceSchema,reservationChoices} from './advance-booking.js';
import {auditTargetDetail} from './audit-targets.js';

const json = (data,status=200,headers={})=>Response.json(data,{status,headers:{'cache-control':'no-store',...headers}});
const role = (value, fn) => ({ role:value,fn });
const routes = {
  'audit-target':role('manager',auditTargetDetail),
  'reservations':role('staff',reservationList),
  'reservation':role('staff',(d,u,b)=>reservationDetail(d,u,b.reservationId)),
  'reservation-save':role('staff',saveReservation),
  'reservation-prepare':role('staff',prepareReservation),
  'reservation-choices':role('staff',reservationChoices),
  'reservation-end':role('staff',endReservation),
  'queue':role('staff',(d,u)=>receptionQueue(d,u)),
  'lookup':role('staff',(d,u,b)=>lookupCustomer(d,b)),
  'enqueue':role('staff',enqueue),
  'task':role('staff',(d,u,b)=>getTask(d,u,b.taskId)),
  'begin':role('staff',beginTask),
  'cancel-reception':role('staff',cancelReception),
  'recommend':role('staff',recommendTask),
  'contracts':role('staff',(d,u,b)=>contractList(d,b)),
  'contract':role(['staff','manager'],(d,u,b)=>contractDetail(d,Number(b.contractId))),
  'find-contract':role('staff',(d,u,b)=>findContract(d,b)),
  'quote':role('staff',async(d,u,b,t)=>{
    const result = await quoteContract(d,u,b,t);
    return { price:result.price,range:result.draft.range,task:result.task };
  }),
  'confirm':role('staff',confirmContract),
  'pickup':role('staff',pickupContract),
  'cancel-uncollected':role('staff',cancelUncollected),
  'exchange-choices':role('staff',exchangeChoices),
  'exchange':role('staff',executeExchange),
  'preview-return':role('staff',quoteReturn),
  'return':role('staff',executeReturn),
  'retry':role('staff',retryPayment),
  'inventory':role('staff',inventory),
  'repairs':role(['staff','contractor'],repairList),
  'repair':role(['staff','contractor','manager'],(d,u,b)=>repairDetail(d,u,b.orderId)),
  'repair-submit':role('staff',submitRepair),
  'repair-assign':role('staff',assignRepair),
  'repair-update':role('contractor',updateRepair),
  'repair-inspect':role('staff',inspectRepair),
  'inspect-asset':role('staff',inspectAsset),
  'operations':role('manager',(d,u,b)=>operations(d,b))
};
const initialized = new WeakSet();
async function initialize(env) {
  const binding = env.DB;
  requireRule(binding,'业务数据库未连接',503);
  const db = dbFor(binding);
  if (!initialized.has(binding)) {
    await ensureReservationSchema(db);
    await ensureEquipmentIdentitySchema(db);
    await ensureAdvanceSchema(db);
    await ensureMetricSchema(db);
    await seed(db);
    await normalizeEquipmentNames(db);
    await backfillRepairStores(db);
    await closeLegacyUncollectedTasks(db);
    initialized.add(binding);
  }
  return db;
}
const securityHeaders = {
  'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com; base-uri 'none'; form-action 'self'",
  'x-content-type-options':'nosniff',
  'referrer-policy':'same-origin'
};
async function handle(request,env) {
  const url = new URL(request.url);
  if (assets[url.pathname] && Object.hasOwn(assets,url.pathname) && request.method==='GET') {
    const [type,body] = assets[url.pathname];
    return new Response(body,{headers:{...securityHeaders,'content-type':type,'cache-control':'no-cache'}});
  }
  if (!url.pathname.startsWith('/api/')) return new Response('Not Found',{status:404});
  requireRule(request.method==='POST','请求方法不受支持',405);
  requireRule(!request.headers.has('origin') || request.headers.get('origin')===url.origin,'请求来源无效',403);
  requireRule((request.headers.get('content-type')||'').includes('application/json'),'请提交有效的请求数据');
  const raw=await request.text();
  requireRule(raw.length<100000,'请求数据过大',413);
  let body;
  try { body=JSON.parse(raw); } catch { throw new BusinessError('请求格式不正确'); }
  requireRule(body && typeof body==='object' && !Array.isArray(body),'请求格式不正确');
  if (url.pathname==='/api/demo-accounts') return json(accounts.map(({username,display_name})=>({username,display_name})));
  const secure=url.protocol==='https:';
  if (url.pathname==='/api/logout') return json({},200,{'set-cookie':sessionCookie('',secure,0)});
  const db=await initialize(env);
  const signed=tokens(env.SESSION_KEY);
  if (url.pathname==='/api/login') {
    const account=await db.one('SELECT * FROM user_account WHERE username=? AND active=1',textField(body.username,'登录账号',80));
    requireRule(account && body.password===(env.DEMO_PASSWORD||'BSR-demo-2026'),'账号或密码不正确',401);
    await db.batch([
      db.q('UPDATE user_account SET last_login_at=? WHERE user_id=?',now(),account.user_id),
      ...audit(db,account,'工作会话登录',null,null,[['user_account',account.user_id]])
    ]);
    const cookie=sessionCookie(await signed.sign({kind:'session',userId:account.user_id},480),secure,28800);
    return json({user:account},200,{'set-cookie':cookie});
  }
  const token=(request.headers.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  const session=await signed.read(token,'session');
  const user=session?await db.one('SELECT * FROM user_account WHERE user_id=? AND active=1',session.userId):null;
  requireRule(user,'请先登录有效工作会话',401);
  if (user.role_type==='staff') { await refreshReservationStates(db); await restoreReceptionStages(db); }
  if (url.pathname==='/api/bootstrap') {
    const [stores,contractors,reservations]=await Promise.all([
      db.all('SELECT * FROM store WHERE active=1 ORDER BY store_id'),
      user.role_type==='staff'?db.all('SELECT * FROM repair_contractor WHERE active=1'):[],
      user.role_type==='staff'?pendingReservations(db,user):[]
    ]);
    return json({user,stores,contractors,reservations});
  }
  const name=url.pathname.slice(5);
  requireRule(Object.hasOwn(routes,name),'接口不存在',404);
  const route=routes[name];
  requireRule([route.role].flat().includes(user.role_type),'当前角色无权执行该操作',403);
  if (user.role_type==='staff' && ['reservation-choices','reservation-prepare','queue','recommend','quote','confirm','contracts','contract','find-contract','inventory','preview-return','exchange-choices','return','exchange'].includes(name))
    await expirePaymentHolds(db, Number.isSafeInteger(Number(body.contractId))?Number(body.contractId):null);
  return json(await route.fn(db,user,body,signed));
}
export default {
  async scheduled(_event,env) {
    const released=await expirePaymentHolds(await initialize(env));
    if (released) console.log('Expired payment holds released:',released);
    return released;
  },
  async fetch(request,env) {
    try { return await handle(request,env); }
    catch (error) {
      if (error instanceof BusinessError) return json({error:error.message},error.status);
      const detail=String(error.message);
      if (/ASSET_CONFLICT|ASSET_UNAVAILABLE/.test(detail)) return json({error:'装备的租期、可用状态或安全检查已变化，请重新查询'},409);
      if (/UNIQUE constraint failed|NOT NULL constraint failed.*(?:version|status|recommendation_revision)/.test(detail))
        return json({error:'业务记录已被其他操作更新，请刷新详情后继续'},409);
      console.error(error);
      return json({error:'保存或查询失败，已提交的业务状态请从详情重新核对后继续'},500);
    }
  }
};
