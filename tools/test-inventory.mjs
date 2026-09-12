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

test('unlimited mode keeps earning exact inventory and monotonic reward totals across concurrent sessions and restart',async t=>{
 const f=await fixture(t);await f.wallet.configure(true);f.advance(9000);
 const one=f.session([header,usage(500000)]),two={...f.session([header,usage(500000)]),header:{id:'child'}};
 await Promise.all([f.wallet.observe(one),f.wallet.observe(two),f.wallet.observe(one)]);
 const earned=await f.wallet.snapshot();assert.equal(earned.drops,10);assert.deepEqual(earned.stock,{fish:4,pat:2,play:2,stretch:2});assert.deepEqual(earned.earned,earned.stock);
 const used=await f.wallet.consume('fish','unlimited-request-123');assert.deepEqual(used.stock,earned.stock);assert.deepEqual(used.earned,earned.earned);
 await f.wallet.configure(false);f.advance(9000);const paid=await f.wallet.consume('fish','limited-request-12345');assert.equal(paid.stock.fish,3);assert.deepEqual(paid.earned,earned.earned);
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
 s=await restarted.observe(mixed);assert.equal(s.drops,10);assert.equal(s.credited,.525);assert.equal(s.bonusCredited,.5);assert.equal(s.stock.fish,4);
});
test('legacy inventory migration never grants a bonus for historical usage, including after restart',async t=>{
 const {writeFile}=await import('node:fs/promises');const f=await fixture(t);
 const peak=Date.parse('2026-09-14T09:00:00+08:00');
 f.advance(peak-START);const session=f.session([header,usage(125000,1,peak)]);
 await f.wallet.observe(session);
 const file=join(f.directory,'inventory.json'),legacy=JSON.parse(await readFile(file,'utf8'));
 delete legacy.bonusStartedAt;delete legacy.bonusCredited;delete legacy.bonusSessions;delete legacy.peakEarned;
 legacy.drops=2;legacy.stock={fish:0,pat:0,play:1,stretch:1};legacy.earned={...legacy.stock};
 await writeFile(file,JSON.stringify(legacy));f.advance(1000);
 const migrated=createInventory(f.options);assert.equal((await migrated.observe(session)).drops,2);
 session.snapshotEvents=()=>[header,usage(125000,1,peak),usage(125000,2,peak+2000)];
 const after=await migrated.observe(session);assert.equal(after.credited,.5);assert.equal(after.bonusCredited,.25);assert.equal(after.drops,7);
 assert.equal((await createInventory(f.options).observe(session)).drops,7);
});

test('delayed streamed usage before upgrade cannot earn a new peak bonus',async t=>{
 const f=await fixture(t),peak=Date.parse('2026-09-14T09:00:00+08:00');f.advance(peak-START);
 const {writeFile}=await import('node:fs/promises');const file=join(f.directory,'inventory.json');
 const stored=JSON.parse(await readFile(file,'utf8'));stored.bonusStartedAt=peak+2000;await writeFile(file,JSON.stringify(stored));
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
 const {writeFile}=await import('node:fs/promises');const f=await fixture(t);
 await f.wallet.observe(f.session([header,usage(500000)]));
 const path=join(f.directory,'inventory.json'),old=JSON.parse(await readFile(path,'utf8'));
 delete old.settlements;delete old.ledgerStartedAt;await writeFile(path,JSON.stringify(old));f.advance(5000);
 const wallet=createInventory(f.options),session=f.session([header,usage(500000)]);
 assert.equal((await wallet.observe(session)).drops,5);
 session.snapshotEvents=()=>[header,usage(500000),usage(100000,2,START+6000)];
 assert.equal((await wallet.observe(session)).drops,6);
});
