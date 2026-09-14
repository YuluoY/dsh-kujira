import {readInventory, seedLegacyInventory, rejectInventoryWrites} from './fixtures/inventory-storage.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createInventory} from '../lib/host/inventory.js';
import {PRICING} from '../lib/shared/session-cost.js';
const START=Date.UTC(2026,8,12,4);
const config={...PRICING,prices:{'deepseek-flash':{history:[{from:'2026-01-01',hit:0,miss:0,out:1}]}}};
const header={type:'request/header',time:START,seq:0,data:{header:{config:{provider:'deepseek',model:'deepseek-flash'}}}};
const usage=(tokens,seq=1,time=START+1)=>({type:'assistant/message',seq,time,data:{turn:1,step:seq,usage:{inputTokens:0,outputTokens:tokens},content:'must never persist conversation text'}});
async function fixture(t) {
 const directory=await mkdtemp(join(tmpdir(),'kujira-inventory-'));t.after(async()=>{await wallet.dispose();await rm(directory,{recursive:true,force:true});});
 let clock=START,busy=false;
 const options={directory,now:()=>clock,random:n=>n-1,getConfig:()=>config,isBusy:()=>busy};
 const wallet=createInventory(options);const initial=await wallet.snapshot();await wallet.configureRules({...initial.rules,chance:100,min:1,max:1,fishWeight:100},initial.rulesRevision);
 return {wallet,options,directory,advance:n=>{clock+=n;},busy:v=>{busy=v;},session:events=>({header:{id:'private-session'},inheritedEventCount:0,snapshotEvents:()=>events})};
}
test('default empty inventory earns only verified spend; partial values carry under configured deterministic test rules',async t=>{
 const f=await fixture(t),session=f.session([header,usage(90000)]);
 let s=await f.wallet.observe(session);assert.equal(s.free,false);assert.equal(s.drops,0);assert.ok(Math.abs(s.remaining-.01)<1e-8);
 session.snapshotEvents=()=>[header,usage(500000)];s=await f.wallet.observe(session);
 assert.equal(s.credited,.5);assert.equal(s.drops,5);assert.deepEqual(s.stock,{fish:5,pat:0,play:0,stretch:0});
 const data=JSON.stringify(readInventory(f.directory));assert.ok(!data.includes('private-session'));assert.ok(!data.includes('conversation text'));
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
 assert.equal(a.stock.fish,4);assert.equal(b.stock.fish,4);assert.equal(b.replayed,true);
 assert.equal((await f.wallet.consume('fish','different-request-01')).stock.fish,3);
 f.advance(9000);f.busy(true);assert.equal((await f.wallet.consume('play','busy-request-00001')).reason,'busy');
 assert.equal((await f.wallet.snapshot()).stock.play,0);
});
test('free mode persists, never consumes saved stock and turning it off preserves inventory',async t=>{
 const f=await fixture(t);await f.wallet.configure(true);f.advance(9000);
 const used=await f.wallet.consume('fish','free-request-00001');assert.equal(used.ok,true);assert.equal(used.stock.fish,0);
 assert.equal((await createInventory(f.options).snapshot()).free,true);
 await f.wallet.configure(false);f.advance(9000);assert.equal((await f.wallet.consume('fish','paid-request-00001')).reason,'empty');
});
test('failed persistence cannot commit a debit or issue a successful receipt',async t=>{
 const f=await fixture(t);await f.wallet.observe(f.session([header,usage(500000)]));f.advance(9000);
 rejectInventoryWrites(f.directory);
 await assert.rejects(f.wallet.consume('fish','failed-write-00001'));
 assert.equal((await f.wallet.snapshot()).stock.fish,5);

});

test('unlimited mode keeps earning exact inventory and monotonic reward totals across concurrent sessions and restart',async t=>{
 const f=await fixture(t);await f.wallet.configure(true);f.advance(9000);
 const one=f.session([header,usage(500000)]),two={...f.session([header,usage(500000)]),header:{id:'child'}};
 await Promise.all([f.wallet.observe(one),f.wallet.observe(two),f.wallet.observe(one)]);
 const earned=await f.wallet.snapshot();assert.equal(earned.drops,10);assert.deepEqual(earned.stock,{fish:10,pat:0,play:0,stretch:0});assert.deepEqual(earned.earned,earned.stock);
 const used=await f.wallet.consume('fish','unlimited-request-123');assert.deepEqual(used.stock,earned.stock);assert.deepEqual(used.earned,earned.earned);
 await f.wallet.configure(false);f.advance(9000);const paid=await f.wallet.consume('fish','limited-request-12345');assert.equal(paid.stock.fish,9);assert.deepEqual(paid.earned,earned.earned);
 const restarted=await createInventory(f.options).snapshot();assert.deepEqual(restarted.stock,paid.stock);assert.deepEqual(restarted.earned,paid.earned);
});

test('peak spend earns twice the supplies per yuan, with actual costs and mixed-period carry preserved',async t=>{
 const f=await fixture(t),peak=Date.parse('2026-09-14T09:00:00+08:00');f.advance(peak-START);
 let s=await f.wallet.observe(f.session([header,usage(125000,1,peak)]));
 assert.equal(s.credited,.25);assert.equal(s.bonusCredited,.25);assert.equal(s.drops,5);assert.deepEqual(s.peakEarned,s.earned);assert.equal(s.rewardMultiplier,2);
 const mixed=f.session([header,usage(125000,1,peak),usage(25000,2,peak+3*3600000)]);
 s=await f.wallet.observe(mixed);assert.equal(s.credited,.275);assert.equal(s.drops,5);assert.equal(s.progress,.25);assert.equal(s.remaining,.0375);
 const restarted=createInventory(f.options);assert.equal((await restarted.observe(mixed)).drops,5);
 await restarted.configure(true);
 mixed.snapshotEvents=()=>[header,usage(125000,1,peak),usage(25000,2,peak+3*3600000),usage(125000,3,peak+1000)];
 s=await restarted.observe(mixed);assert.equal(s.drops,10);assert.equal(s.credited,.525);assert.equal(s.bonusCredited,.5);assert.equal(s.stock.fish,10);
});
test('legacy inventory migration never grants a bonus for historical usage, including after restart',async t=>{
 const f=await fixture(t);
 const peak=Date.parse('2026-09-14T09:00:00+08:00');
 f.advance(peak-START);const session=f.session([header,usage(125000,1,peak)]);
 await f.wallet.observe(session);
 const legacy=readInventory(f.directory);
 delete legacy.bonusStartedAt;delete legacy.bonusCredited;delete legacy.bonusSessions;delete legacy.peakEarned;
 legacy.drops=2;legacy.stock={fish:0,pat:0,play:1,stretch:1};legacy.earned={...legacy.stock};
 await seedLegacyInventory(f.directory,legacy);f.advance(1000);
 const migrated=createInventory(f.options);assert.equal((await migrated.observe(session)).drops,2);
 session.snapshotEvents=()=>[header,usage(125000,1,peak),usage(125000,2,peak+2000)];
 const after=await migrated.observe(session);assert.equal(after.credited,.5);assert.equal(after.bonusCredited,.25);assert.equal(after.drops,7);
 assert.equal((await createInventory(f.options).observe(session)).drops,7);
});

test('delayed streamed usage before upgrade cannot earn a new peak bonus',async t=>{
 const f=await fixture(t),peak=Date.parse('2026-09-14T09:00:00+08:00');f.advance(peak-START);

 const stored=readInventory(f.directory);stored.bonusStartedAt=peak+2000;await seedLegacyInventory(f.directory,stored);
 const delayed={type:'assistant/message',time:peak+3000,seq:1,data:{turn:1,step:1,stream:[{time:peak,chunk:{type:'usage',usage:{inputTokens:0,outputTokens:125000}}}]}};
 const s=await createInventory(f.options).observe(f.session([header,delayed]));assert.equal(s.credited,.25);assert.equal(s.bonusCredited,0);assert.equal(s.drops,2);
});

test('paused clocks, duplicate settlement delivery and historical repricing never mint supplies',async t=>{
 const f=await fixture(t);let pricing=config;
 const wallet=createInventory({...f.options,getConfig:()=>pricing});
 const session=f.session([header,usage(500000)]);
 const earned=await wallet.observe(session);
 f.advance(3*86400000);
 for(let i=0;i<30;i++)await wallet.observe(session);
 assert.deepEqual((await wallet.snapshot()).earned,earned.earned);
 pricing={...config,prices:{'deepseek-flash':{history:[{from:'2026-01-01',hit:0,miss:0,out:10}]}}};
 assert.equal((await wallet.observe(session)).credited,.5);
 session.snapshotEvents=()=>[header,usage(500000),usage(100000,2,START+2)];
 const next=await wallet.observe(session);assert.equal(next.credited,1.5);
 assert.equal(next.drops,15);
 assert.equal((await createInventory({...f.options,getConfig:()=>pricing}).observe(session)).drops,15);
});
test('upgrading old cumulative ledgers does not turn corrected retry history into new rewards',async t=>{
 const f=await fixture(t);
 await f.wallet.observe(f.session([header,usage(500000)]));
 const old=readInventory(f.directory);
 delete old.settlements;delete old.ledgerStartedAt;await seedLegacyInventory(f.directory,old);f.advance(5000);
 const wallet=createInventory(f.options),session=f.session([header,usage(500000)]);
 assert.equal((await wallet.observe(session)).drops,5);
 session.snapshotEvents=()=>[header,usage(500000),usage(100000,2,START+6000)];
 assert.equal((await wallet.observe(session)).drops,6);
});

test('daily spend deduplicates requests, includes sessions once, corrects amounts and resets at local midnight',async t=>{
 const f=await fixture(t);const events=[header,usage(100000)];
 const a=f.session(events);
 let value=await f.wallet.observe(a);assert.equal(value.today.total,0.1);assert.equal(value.today.requests,1);
 value=await f.wallet.observe(a);assert.equal(value.today.total,0.1);
 const second={...f.session(events),header:{id:'second-session'}};
 value=await f.wallet.observe(second);assert.equal(value.today.total,0.2);
 const corrected=f.session([header,usage(50000)]);
 value=await f.wallet.observe(corrected);assert.equal(value.today.total,0.15);assert.equal(value.today.requests,2);
 const reloaded=createInventory(f.options);try {assert.equal((await reloaded.snapshot()).today.total,0.15);} finally {await reloaded.dispose();}
 f.advance(86400000);value=await f.wallet.snapshot();assert.equal(value.today.total,0);assert.equal(value.today.requests,0);
});

test('historical daily accounting never grants rewards or suppresses later live settlement',async t=>{
 const f=await fixture(t),session=f.session([header,usage(100000)]);
 await f.wallet.account(session);
 let value=await f.wallet.snapshot();assert.equal(value.today.total,0.1);assert.equal(value.drops,0);
 value=await f.wallet.observe(session);assert.equal(value.today.total,0.1);assert(value.drops>0);
});
test('daily history scan waits for idle, uses read-only sessions and remains bounded',async()=>{
 const {createDailyUsage}=await import('../lib/host/daily-usage.js');let busy=true,reads=0,accounted=0;
 const job=createDailyUsage({now:()=>START,isBusy:()=>busy,getController:()=>({list:async()=>({items:[{sessionId:'today',updatedAt:START},{sessionId:'old',updatedAt:START-86400000}]})}),access:{prepare:async id=>{reads++;return {header:{id}};}},inventory:{account:async()=>{accounted++;return [];}}});
 job.start();assert.equal(reads,0);assert.equal(job.snapshot().status,'partial');busy=false;job.start();
 for(let i=0;i<20 && job.snapshot().status==='loading';i++)await new Promise(r=>setTimeout(r,1));
 assert.equal(job.snapshot().status,'complete');assert.equal(reads,1);assert.equal(accounted,1);
 job.start();assert.equal(reads,1);job.dispose();
});
