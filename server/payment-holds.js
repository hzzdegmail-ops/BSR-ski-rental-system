import { BusinessError, now, snapshot } from './data.js';
import { paymentHoldCutoff } from './payment.js';
import { cancelPendingCharge } from './contracts.js';
import { contractById } from './contract-repository.js';
import { settleAdjustment } from './returns.js';

export async function expirePaymentHolds(db, priorityContractId=null) {
  const at=now();
  const cutoff=paymentHoldCutoff(at);
  const expired=await db.all(`SELECT p.* FROM payment_request p
    JOIN rental_contract c USING(contract_id)
    WHERE (p.status IN ('待支付','处理中') OR (p.status='失败' AND p.request_type='退款'))
      AND (
        (p.request_type='收费' AND c.status='待支付' AND p.created_at<=?)
        OR (json_extract(c.price_snapshot,'$.pending.type')='换装'
          AND json_extract(c.price_snapshot,'$.pending.requestNo')=p.request_no
          AND (p.created_at<=? OR c.end_at<=?))
      )
    ORDER BY (p.contract_id=?) DESC,p.created_at,p.payment_request_id LIMIT 20`,cutoff,cutoff,at,priorityContractId);
  let released=0;
  for (const request of expired) {
    const contract=await contractById(db,request.contract_id);
    if (!contract) continue;
    if (request.request_type==='收费' && contract.status!=='待支付') continue;
    if (request.request_type!=='收费' && snapshot(contract).pending?.requestNo!==request.request_no) continue;
    try {
      if (request.request_type==='收费') {
        await cancelPendingCharge(db,null,contract,'DEMO_CHARGE_EXPIRED',request.payment_request_id);
      } else {
        const latestRequest=await db.one('SELECT * FROM payment_request WHERE payment_request_id=?',request.payment_request_id);
        await settleAdjustment(db,null,contract,latestRequest);
      }
      released++;
    } catch (error) {
      const latest=await contractById(db,contract.contract_id);
      if (latest?.version!==contract.version || (error instanceof BusinessError && error.status===409)) continue;
      throw error;
    }
  }
  return released;
}
