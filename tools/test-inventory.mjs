import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,mkdir,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createInventory} from '../lib/host/inventory.js';
import {PRICING} from '../lib/shared/session-cost.js';
const START=Date.UTC(2026,8,12,4);
const config={...PRICING,prices:{'deepseek-flash':{history:[{from:'2026-01-01',hit:0,miss:0,out:1}]}}};
const header={type:'request/header',time:START,seq:0,data:{header:{config:{provider:'deepseek',model:'deepseek-flash'}}}};
const usage=(tokens,seq=1,time=START+1)=>({type:'assistant/message',seq,time,data:{turn:1,step:seq,usage:{inputTokens:0,outputTokens:tokens},content:'must never persist conversation text'}});
async function fixture(t) {
 const directory=await mkdtemp(join(tmpdir(),'kujira-inventory-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 let clock=START,busy=false;
 const options={directory,now:()=>clock,random:n=>n-1,getConfig:()=>config,isBusy:()=>busy};
 const wallet=createInventory(options);await wallet.snapshot();
 return {wallet,options,directory,advance:n=>{clock+=n;},busy:v=>{busy=v;},session:events=>({header:{id:'private-session'},inheritedEventCount:0,snapshotEvents:()=>events})};
}
test('default empty inventory earns only verified spend; partial values carry and shuffled bags are balanced',async t=>{
 const f=await fixture(t),session=f.session([header,usage(90000)]);
 let s=await f.wallet.observe(session);assert.equal(s.free,false);assert.equal(s.drops,0);assert.ok(Math.abs(s.remaining-.01)<1e-8);
 session.snapshotEvents=()=>[header,usage(500000)];s=await f.wallet.observe(session);
 assert.equal(s.credited,.5);assert.equal(s.drops,5);assert.deepEqual(s.stock,{fish:2,pat:1,play:1,stretch:1});
 const data=await readFile(join(f.directory,'inventory.json'),'utf8');assert.ok(!data.includes('private-session'));assert.ok(!data.includes('conversation text'));
});
test('duplicate/revised settlements and restarts never award twice; inherited and pre-install costs excluded',async t=>{
 const f=await fixture(t),session=f.session([header,usage(100000)]);
 await Promise.all([f.wallet.observe(session),f.wallet.observe(session)]);assert.equal((await f.wallet.snapshot()).drops,1);
 const restarted=createInventory(f.options);assert.equal((await restarted.observe(session)).drops,1);
 session.snapshotEvents=()=>[header,usage(100000),usage(200000)];assert.equal((await restarted.observe(session)).drops,2);
 session.snapshotEvents=()=>[header,usage(1000000,1,START-1)];assert.equal((await restarted.observe(session)).drops,2);
 session.snapshotEvents=()=>[header,usage(1000000)];session.inheritedEventCount=2;assert.equal((await restarted.observe(session)).drops,2);
});
test('no rewards for idle time, non-DeepSeek or unpriced models',async t=>{
 const f=await fixture(t);
 for(const route of [{provider:'other',model:'deepseek-flash'},{provider:'deepseek',model:'unknown'}]) {
  const s=await f.wallet.observe(f.session([{...header,data:{header:{config:route}}},usage(1000000)]));assert.equal(s.drops,0);
 }
 f.advance(86400000);assert.equal((await f.wallet.snapshot()).drops,0);
});
test('spending is atomic across tabs, idempotent on retry and refuses negative stock and blocked actions',async t=>{
 const f=await fixture(t);f.advance(9000);
 assert.equal((await f.wallet.consume('fish','empty-request-0001')).reason,'empty');
 await f.wallet.observe(f.session([header,usage(500000)]));
 const [a,b]=await Promise.all([f.wallet.consume('fish','same-request-00001'),f.wallet.consume('fish','same-request-00001')]);
 assert.equal(a.stock.fish,1);assert.equal(b.stock.fish,1);assert.equal(b.replayed,true);
 assert.equal((await f.wallet.consume('pat','different-request-01')).reason,'cooldown');
 f.advance(9000);f.busy(true);assert.equal((await f.wallet.consume('play','busy-request-00001')).reason,'busy');
 assert.equal((await f.wallet.snapshot()).stock.play,1);
});
test('free mode persists, never consumes saved stock and turning it off preserves inventory',async t=>{
 const f=await fixture(t);await f.wallet.configure(true);f.advance(9000);
 const used=await f.wallet.consume('fish','free-request-00001');assert.equal(used.ok,true);assert.equal(used.stock.fish,0);
 assert.equal((await createInventory(f.options).snapshot()).free,true);
 await f.wallet.configure(false);f.advance(9000);assert.equal((await f.wallet.consume('fish','paid-request-00001')).reason,'empty');
});
test('failed persistence cannot commit a debit or issue a successful receipt',async t=>{
 const f=await fixture(t);await f.wallet.observe(f.session([header,usage(500000)]));f.advance(9000);
 const target=f.directory+'-moved';await rename(f.directory,target);await mkdir(f.directory);await mkdir(join(f.directory,'inventory.json.tmp'));
 await assert.rejects(f.wallet.consume('fish','failed-write-00001'));
 assert.equal((await f.wallet.snapshot()).stock.fish,2);
 t.after(()=>rm(target,{recursive:true,force:true}));
});
