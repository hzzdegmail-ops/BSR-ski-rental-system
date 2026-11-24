import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {localRuntime,sqliteBinding} from '../local.mjs';
import {dbFor} from '../server/data.js';
import {seed,expandDemoInventory} from '../server/seed.js';
import {ensureEquipmentIdentitySchema,normalizeEquipmentNames} from '../server/equipment-names.js';

test('version 6 equipment migration keeps identity, state, rules and stock while shortening all category codes',async t=>{
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());sqlite.exec('PRAGMA foreign_keys=ON');
 const journal=JSON.parse(await readFile(new URL('../drizzle/meta/_journal.json',import.meta.url),'utf8'));
 for(const e of journal.entries.slice(0,6)) sqlite.exec(await readFile(new URL('../drizzle/'+e.tag+'.sql',import.meta.url),'utf8'));
 sqlite.exec('PRAGMA user_version=6');const db=dbFor(sqliteBinding(sqlite));await seed(db);
 const before=sqlite.prepare('SELECT * FROM equipment').all();const rules=sqlite.prepare('SELECT model_id,compatibility_rule FROM equipment_model').all();
 await ensureEquipmentIdentitySchema(db);await normalizeEquipmentNames(db);
 const inventory=sqlite.prepare('SELECT e.*,m.category_id,m.model_name,m.brand FROM equipment e JOIN equipment_model m USING(model_id)').all();
 assert.equal(inventory.length,316);assert.equal(new Set(inventory.map(e=>e.asset_no)).size,316);
 for(const row of inventory) {
  const prefix=({1:'SKI',2:'BOOT',3:'POLE',4:'HELMET'})[row.category_id];
  assert.match(row.asset_no,new RegExp('^'+prefix+'-(?:[0-9]{3}|XS|XL|S|M|L)-[0-9]{2}$'));
  assert.ok(row.asset_no.length<=12);assert.doesNotMatch(row.brand+' '+row.model_name,/BSR|课程|演示/);
  const old=before.find(e=>e.equipment_id===row.equipment_id);
  for(const key of Object.keys(old).filter(k=>k!=='asset_no')) assert.equal(row[key],old[key]);
  if(old.asset_no!==row.asset_no) assert.equal(row.legacy_asset_no,old.asset_no);
 }
 assert.deepEqual(sqlite.prepare('SELECT model_id,compatibility_rule FROM equipment_model').all(),rules);
 const changes=sqlite.prepare('SELECT total_changes() n').get().n;
 await normalizeEquipmentNames(db);await expandDemoInventory(db);
 assert.equal(sqlite.prepare('SELECT total_changes() n').get().n,changes);
 assert.equal(sqlite.prepare('PRAGMA user_version').get().user_version,7);
 assert.equal(sqlite.prepare('PRAGMA foreign_key_check').all().length,0);
});

test('old and current equipment codes find the same contract and receipt labels normalize without rewriting price snapshots',async t=>{
 const app=await localRuntime(':memory:');t.after(()=>app.sqlite.close());let cookie='';
 const call=async(route,body={})=>{const res=await app.fetch(new Request('http://localhost/api/'+route,{method:'POST',headers:{'content-type':'application/json',cookie},body:JSON.stringify(body)}));const value=await res.json();assert.equal(res.status,200,route+JSON.stringify(value));if(route==='login')cookie=res.headers.get('set-cookie').split(';')[0];return value;};
 await call('login',{username:'north.staff',password:'BSR-demo-2026'});
 const unit=app.sqlite.prepare("SELECT * FROM equipment WHERE legacy_asset_no='DEMO2-SKI-A-140-1-1'").get();
 const {task}=await call('enqueue',{customerId:1});await call('begin',{taskId:task.task_id});
 const start=new Date().toISOString(),end=new Date(Date.now()+86400000).toISOString();
 const rec=await call('recommend',{taskId:task.task_id,start,end,pickup:1,returnStore:1,categories:['SKI'],system:'Alpine',fit:{height_cm:160,weight_kg:50,foot_length_mm:238,skill_level:'初级'}});
 const c=await call('confirm',{token:rec.token,equipmentIds:[unit.equipment_id],confirm:true,scenario:'success'});
 const price=JSON.parse(app.sqlite.prepare('SELECT price_snapshot FROM rental_contract WHERE contract_id=?').get(c.contract.contract_id).price_snapshot);
 price.lines[0].asset_no=unit.legacy_asset_no;price.lines[0].model='课程演示双板';
 const raw=JSON.stringify(price);app.sqlite.prepare('UPDATE rental_contract SET price_snapshot=? WHERE contract_id=?').run(raw,c.contract.contract_id);
 const old=await call('find-contract',{key:unit.legacy_asset_no}),current=await call('find-contract',{key:unit.asset_no});
 assert.equal(old.contract.contract_id,current.contract.contract_id);assert.equal(old.price.lines[0].asset_no,unit.asset_no);
 assert.match(old.price.lines[0].model,/Nordica/);assert.doesNotMatch(old.price.lines[0].model,/课程|演示/);
 assert.equal(app.sqlite.prepare('SELECT price_snapshot FROM rental_contract WHERE contract_id=?').get(c.contract.contract_id).price_snapshot,raw);
});
