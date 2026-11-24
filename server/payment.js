import { now } from './data.js';
import { demo } from './demo-config.js';

export const paymentHoldUntil = createdAt => new Date(Date.parse(createdAt)+demo.paymentHoldMinutes*60000).toISOString();

export const paymentHoldCutoff = at => new Date(Date.parse(at)-demo.paymentHoldMinutes*60000).toISOString();

export const lapsedPayment = code => ({status:'失败',code,providerNo:null});

function simulate(request, scenario) {
  if (scenario==='timeout') return {status:'处理中',code:'DEMO_TIMEOUT',providerNo:null};
  if (scenario==='failure') return {status:'失败',code:'DEMO_DECLINED',providerNo:null};
  return {status:'成功',code:'DEMO_OK',providerNo:'DEMO-'+request.request_no};
}

export function paymentInsert(db, no, contractId, type, amount) {
  return db.q(`INSERT INTO payment_request(request_no,contract_id,request_type,amount,status,created_at)
    VALUES(?,coalesce(?,(SELECT max(contract_id) FROM rental_contract)),?,?,'待支付',?)`,
    no,contractId,type,amount,now());
}

export function paymentOutcome(db, request, scenario, outcome) {
  if (request.status==='成功') return null;
  const result = outcome ?? simulate(request,scenario);
  const statements = [
    db.q(`UPDATE payment_request SET status=CASE WHEN status=? THEN ? ELSE NULL END WHERE payment_request_id=?`,
      request.status,result.status,request.payment_request_id),
    db.q(`INSERT INTO payment_transaction(payment_request_id,provider_transaction_no,attempt_no,amount,status,response_code,processed_at)
      VALUES(?,?,(SELECT coalesce(max(attempt_no),0)+1 FROM payment_transaction WHERE payment_request_id=?),?,?,?,?)`,
      request.payment_request_id,result.providerNo,request.payment_request_id,request.amount,result.status,result.code,now())
  ];
  return { ...result,statements };
}
