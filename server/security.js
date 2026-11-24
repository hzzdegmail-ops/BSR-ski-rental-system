import { requireRule } from './data.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const encode = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const decode = value => Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')), c=>c.charCodeAt(0));
export function tokens(secret) {
  requireRule(typeof secret === 'string' && secret.length>=32,'系统会话配置缺失',503);
  const key = crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
  return {
    async sign(data, minutes) {
      const payload = encode(encoder.encode(JSON.stringify({...data, expires:Date.now()+minutes*60000})));
      const signature = await crypto.subtle.sign('HMAC',await key,encoder.encode(payload));
      return payload+'.'+encode(new Uint8Array(signature));
    },
    async read(token, kind) {
      try {
        const [payload,signature,...rest] = (token||'').split('.');
        if (rest.length || !await crypto.subtle.verify('HMAC',await key,decode(signature),encoder.encode(payload))) return null;
        const data = JSON.parse(decoder.decode(decode(payload)));
        return data.kind===kind && data.expires>Date.now()?data:null;
      } catch { return null; }
    }
  };
}
export const cookieName = 'bsr_session';
export const sessionCookie = (value, secure, age) =>
  `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure?'; Secure':''}`;

