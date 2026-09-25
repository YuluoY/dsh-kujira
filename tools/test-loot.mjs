import {readInventory, seedLegacyInventory} from './fixtures/inventory-storage.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {rewardRules,rewardState,REWARD_DEFAULTS,rollRewards,createBinomial} from '../lib/host/inventory-rules.js';
import {createInventory} from '../lib/host/inventory.js';
import {PRICING} from '../lib/shared/session-cost.js';
const seeded=(seed=123456)=>n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return Math.floor(seed/4294967296*n);};
const start=Date.parse('2026-09-12T10:00:00+08:00');
const config={...PRICING,prices:{'deepseek-flash':{history:[{from:'2026-01-01',hit:0,miss:0,out:1}]}}};
const events=tokens=>[{type:'request/header',seq:0,data:{header:{config:{provider:'deepseek',model:'deepseek-flash'}}}},{type:'assistant/message',seq:1,time:start+1,data:{turn:1,step:1,usage:{inputTokens:0,outputTokens:tokens}}}];
async function fixture(t){const directory=await mkdtemp(join(tmpdir(),'kujira-loot-'));t.after(async()=>{await wallet.dispose();await rm(directory,{recursive:true,force:true});});const options={directory,now:()=>start,random:seeded(),getConfig:()=>config};const wallet=createInventory(options);await wallet.snapshot();return{wallet,options,directory};}
test('default probability is restrained and malformed rule ranges are rejected',()=>{
 assert.equal(REWARD_DEFAULTS.chance,25);assert.equal(REWARD_DEFAULTS.amount,.1);
 for(const patch of [{chance:-1},{chance:101},{chance:1.5},{amount:0},{amount:.001},{amount:NaN},{min:4,max:3},{max:21},{fishWeight:101},{peakBonus:'yes'}])assert.equal(rewardRules({...REWARD_DEFAULTS,...patch}),null);
 assert.equal(rewardRules({...REWARD_DEFAULTS,chance:0}).chance,0);
});
test('a roll can miss, win one item or win a mixed multi-item bundle',()=>{
 const sample=createBinomial(seeded());
 assert.deepEqual(rollRewards(100,{...REWARD_DEFAULTS,chance:0},sample).items,{fish:0,pat:0,play:0,stretch:0});
 const seen=new Set();for(let i=0;i<500;i++)seen.add(rollRewards(1,REWARD_DEFAULTS,sample).total);
 assert.deepEqual([...seen].sort(),[0,1,2,3]);
 const batch=rollRewards(1000,{...REWARD_DEFAULTS,chance:100,min:3,max:3},sample);
 assert.equal(batch.total,3000);assert(Object.values(batch.items).every(x=>x>0));assert.equal(Object.values(batch.items).reduce((a,b)=>a+b),3000);
});
test('batch binomial sampling preserves the expected mean and variance without one draw per attempt',()=>{
 let calls=0;const rng=seeded(891),sample=createBinomial(n=>{calls++;return rng(n);});
 for(const [n,p]of [[10,.25],[1000000,.25],[1000000,.99]]){
  let sum=0,squares=0;const rounds=10000;
  for(let i=0;i<rounds;i++){const x=sample(n,p);assert(Number.isSafeInteger(x)&&x>=0&&x<=n);sum+=x;squares+=(x-n*p)**2;}
  assert(Math.abs(sum/rounds-n*p)<6*Math.sqrt(n*p*(1-p)/rounds));
  assert(Math.abs(squares/rounds/(n*p*(1-p))-1)<.1);
 }
 const before=calls;const many=sample(1000000000,.25);assert(many>0&&many<1000000000);assert(calls-before<10000);
});
test('changing rules preserves progress and never rerolls historical paid usage',async t=>{
 const {wallet,options}=await fixture(t);let list=events(50000);const session={id:'one',snapshotEvents:()=>list};
 const before=await wallet.observe(session);assert.equal(before.progress,.5);assert.equal(before.drops,0);
 const configured=await wallet.configureRules({...before.rules,amount:1,chance:100,min:3,max:3,fishWeight:100},before.rulesRevision);
 assert.equal(configured.progress,.5);assert.equal(configured.drops,0);assert.equal((await wallet.observe(session)).attempts,0);
 list=events(550000);const next=await wallet.observe(session);assert.equal(next.attempts,1);assert.equal(next.drops,3);assert.equal(next.stock.fish,3);
 assert.equal((await createInventory(options).observe(session)).drops,3);
 assert.equal((await wallet.configureRules(before.rules,before.rulesRevision)).reason,'rules-conflict');
});
test('missed chances remain settled after reload and probability changes',async t=>{
 const {wallet,options}=await fixture(t);const first=await wallet.snapshot();await wallet.configureRules({...first.rules,chance:0},first.rulesRevision);
 const session={id:'miss',snapshotEvents:()=>events(1000000)};const missed=await wallet.observe(session);
 assert.equal(missed.attempts,10);assert.equal(missed.drops,0);assert.equal(missed.history.length,0);
 await wallet.configureRules({...missed.rules,chance:100},missed.rulesRevision);
 assert.equal((await wallet.observe(session)).drops,0);assert.equal((await createInventory(options).observe(session)).attempts,10);
});
test('legacy migration retains stock and fractional progress without retroactive awards',async t=>{
 const {directory,options}=await fixture(t);const old=readInventory(directory);
 delete old.rewards;old.credited=250000;old.drops=2;old.stock.fish=2;old.earned.fish=2;await seedLegacyInventory(directory,old);
 const next=await createInventory(options).snapshot();assert.equal(next.progress,.5);assert.equal(next.drops,2);assert.equal(next.stock.fish,2);assert.equal(next.rules.chance,25);
 assert.throws(()=>rewardState({...old,rewards:{...rewardState(old),carry:-1}}));
});
test('rapid distinct consumption has no time cooldown while concurrent duplicate IDs remain idempotent',async t=>{
 const {wallet}=await fixture(t);const first=await wallet.snapshot();await wallet.configureRules({...first.rules,chance:100,min:3,max:3,fishWeight:100},0);
 await wallet.observe({id:'one',snapshotEvents:()=>events(100000)});
 const results=await Promise.all(['same-request-00001','same-request-00001','next-request-00002','last-request-00003','extra-request-0004'].map(id=>wallet.consume('fish',id)));
 assert.deepEqual(results.slice(0,4).map(v=>v.stock.fish),[2,2,1,0]);assert.equal(results[4].reason,'empty');
 await wallet.configure(true);for(let i=0;i<20;i++)assert.equal((await wallet.consume('fish','unlimited-request-'+i)).ok,true);
 assert.equal((await wallet.snapshot()).stock.fish,0);
});

test('replaying the same rules is idempotent and changing peak bonus never changes booked currency',async t=>{
 const {wallet}=await fixture(t),first=await wallet.snapshot();
 const rules={...first.rules,chance:100,min:1,max:1,fishWeight:100,peakBonus:false};
 const configured=await wallet.configureRules(rules,0);
 assert.equal((await wallet.configureRules(rules,0)).rulesRevision,configured.rulesRevision);
 const peak=Date.parse('2026-09-14T10:00:00+08:00');let list=events(125000);list[1].time=peak;const session={id:'peak',snapshotEvents:()=>list};
 const noBonus=await wallet.observe(session);assert.equal(noBonus.credited,.25);assert.equal(noBonus.attempts,2);assert.equal(noBonus.drops,2);
 await wallet.configureRules({...rules,peakBonus:true},noBonus.rulesRevision);assert.equal((await wallet.observe(session)).attempts,2);
 list=[...list,{...list[1],seq:2,time:peak+1,data:{...list[1].data,step:2}}];
 const bonus=await wallet.observe(session);assert.equal(bonus.credited,.5);assert.equal(bonus.attempts,7);
});
test('drop ring hover stays short and the click panel lists only the facts',async()=>{
 const {supplyFacts}=await import('../lib/shared/client/reward-scatter.js');
 const t=(s,vars)=>vars?s.replace(/\{(\w+)\}/g,(_,k)=>vars[k]):s, money=(n)=>'¥'+n, number=(n,options)=>options?.style==='percent'?Math.round(n*100)+'%':String(n);
 const idle=supplyFacts(null,{t,money,number});
 assert.equal(idle.tooltip,'正在读取');assert.deepEqual(idle.rows,[]);
 const live=supplyFacts({ok:true,remaining:0.04,drops:3,rewardMultiplier:2,rules:{chance:25,min:1,max:3}},{t,money,number});
 assert.equal(live.tooltip,'再 ¥0.04');
 assert.deepEqual(live.rows,[['距下次判定','¥0.04'],['已掉落','3'],['判定','25% · 1–3'],['峰价','双倍']]);
});
