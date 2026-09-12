import test from 'node:test';
import assert from 'node:assert/strict';
import {createPresenceClock} from '../lib/shared/client/presence-clock.js';
import {inventoryGains,enqueueReward} from '../lib/shared/client/reward-queue.js';
import {createCompanionEvents} from '../lib/host/companion-events.js';
test('bubble expires at its deadline, reappears on deliberate entry and catches up after background time',()=>{
 let now=0,callback,visible;const clock=createPresenceClock(value=>{visible=value;},{now:()=>now,schedule:fn=>{callback=fn;return 1;},cancel:()=>{}});
 clock.show(5000);assert.equal(visible,true);now=5000;callback();assert.equal(visible,false);
 clock.show(5000);assert.equal(visible,true);now=12000;clock.sync();assert.equal(visible,false);
 clock.show(1000);clock.dispose();now=13000;visible='disposed';callback();assert.equal(visible,'disposed');
});
test('gains use earned totals, not stock changes, and never replay on initialization or mode switches',()=>{
 const earned={fish:3,pat:2,play:1,stretch:1};const first={earned,stock:{fish:0},free:false};
 assert.deepEqual(inventoryGains(null,first),[]);
 assert.deepEqual(inventoryGains(first,{...first,free:true,stock:{fish:100}}),[]);
 assert.deepEqual(inventoryGains(first,{...first,earned:{...earned,fish:5}}),[{kind:'fish',count:2}]);
 const queue=[];for(let i=0;i<100;i++)enqueueReward(queue,{kind:'fish',count:1});
 enqueueReward(queue,{kind:'pat',count:2});assert.deepEqual(queue,[{kind:'fish',count:100},{kind:'pat',count:2}]);
});
test('only first starts of new main and child sessions trigger eating; historical reads and repeats do not',()=>{
 const feed=createCompanionEvents(()=>100);
 const fresh=id=>({id,session:{id,snapshotEvents:()=>[],inheritedEventCount:0}});
 const main=fresh('main'),child=fresh('child');
 feed.started({agent:main,status:'idle'});feed.started({agent:main,status:'running'});feed.started({agent:main,status:'running'});feed.started({agent:child,status:'running'});
 feed.started({agent:{id:'old',session:{id:'old',snapshotEvents:()=>[{type:'turn/start'}]}},status:'running'});
 assert.equal(feed.snapshot().sequence,2);
 for(let i=0;i<100;i++)feed.started({agent:fresh('many'+i),status:'running'});
 assert.equal(feed.snapshot().events.length,64);
});

test('host inventory endpoint includes first-start events for the live client',async t=>{
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {apply}=await import('../lib/index.js');
 const directory=await mkdtemp(join(tmpdir(),'kujira-feed-host-'));const listeners=new Map(),disposes=[];let handler;
 t.after(async()=>{disposes.reverse().forEach(fn=>fn());await rm(directory,{recursive:true,force:true});});
 const ctx={agents:{list:()=>[]},sessions:new Map(),credentials:{resolve:async()=>undefined},inject(keys,fn){fn(this);},effect(fn){const end=fn();if(typeof end==='function')disposes.push(end);return end;},on(name,fn){const callbacks=listeners.get(name)||[];callbacks.push(fn);listeners.set(name,callbacks);return()=>{};},webServer:{register(route){handler=route.handler;return()=>{};}}};
 apply(ctx,{inventory:{directory},scheduler:{directory},realtime:{enabled:false}});
 listeners.get('agent/status').forEach(fn=>fn({agent:{id:'new',session:{id:'new',snapshotEvents:()=>[]}},status:'running'}));
 const response={writeHead(){},end(body){this.body=JSON.parse(body);}};await handler({url:'/dsh-kujira/inventory',method:'GET'},response);
 assert.equal(response.body.activity.sequence,1);assert.equal(response.body.activity.events[0].kind,'start');assert(!JSON.stringify(response.body.activity).includes('"new"'));
});

test('inventory polling preserves event cursors and ignores stale or identical replies',async()=>{
 const {mergeInventoryView}=await import('../lib/shared/client/reward-queue.js');
 const old={ok:true,revision:3,free:false,activity:{instance:'a',sequence:2}};
 assert.equal(mergeInventoryView(old,{ok:true,revision:2}),old);
 assert.equal(mergeInventoryView(old,{...old,activity:{...old.activity}}),old);
 assert.deepEqual(mergeInventoryView(old,{ok:true,revision:4,free:true}).activity,old.activity);
 assert.notEqual(mergeInventoryView(old,{...old,activity:{instance:'a',sequence:3}}),old);
});

test('pause state updates survive identical stock revisions and consumption replies',async()=>{
 const {mergeInventoryView}=await import('../lib/shared/client/reward-queue.js');
 const old={ok:true,revision:3,free:false,earned:{fish:2},execution:{active:1}};
 const paused=mergeInventoryView(old,{...old,execution:{active:0}});
 assert.notEqual(paused,old);assert.equal(paused.execution.active,0);
 assert.equal(mergeInventoryView(paused,{ok:true,revision:4,free:true}).execution.active,0);
});

test('simultaneous badge and fish scatter have distinct React keys and no background shape',async()=>{
 const {useCompanionEffects}=await import('../lib/shared/client/use-companion-effects.js');let cursor=0;
 const states=[{kind:'fish',count:4,id:1,peak:true},{count:4,id:1},false];
 const React={Fragment:'fragment',createElement:(type,props,...children)=>({type,props,children}),useRef:v=>({current:v}),useState:()=>[states[cursor++],()=>{}],useEffect:()=>{}};
 const {overlay}=useCompanionEffects({React,prefs:{},cfgRef:{current:{}},playMoment:()=>{}});
 const nodes=overlay.children.filter(Boolean),keys=nodes.map(n=>n.props.key).filter(Boolean);
 assert.equal(new Set(keys).size,keys.length);assert.equal(keys.length,2);
 const json=JSON.stringify(overlay);assert.ok(json.includes('×4'));assert.ok(!json.includes('"type":"rect"'));
});

import {cleanNickname,systemNickname,personalGreeting} from '../lib/shared/client/utilities.js';
import {balanceMood,createContextReactions} from '../lib/shared/client/presence-clock.js';
test('greeting names respect explicit preference and survive unavailable accounts and Unicode input',()=>{
 const t=(s,args={})=>s.replace(/\{(\w+)\}/g,(_,k)=>args[k]);
 assert.equal(personalGreeting('早上好','小鲸','account',t),'小鲸，早上好');
 assert.equal(personalGreeting('早上好','','account',t),'account，早上好');
 assert.equal(personalGreeting('早上好','','',t),'小可爱，早上好');
 assert.equal(personalGreeting(null,'A','B',t),null);
 assert.equal(systemNickname(()=>{throw Error('unavailable');}),'');
 assert.equal(systemNickname(()=>'root'),'');
 assert.equal(cleanNickname(' \u202e小\n鲸 '),'小鲸');
 assert.equal(cleanNickname('👨‍👩‍👧‍👦'.repeat(25)),'👨‍👩‍👧‍👦'.repeat(24));
});
test('balance reactions use verified original-currency bands and reject invalid or stale snapshots',()=>{
 const balance=(total,rawCurrency='CNY')=>({ok:true,total,rawCurrency});
 assert.equal(balanceMood(balance(0)),'empty');assert.equal(balanceMood(balance(9)),'low');
 assert.equal(balanceMood(balance(100)),'plenty');assert.equal(balanceMood(balance(1,'USD')),'low');
 assert.equal(balanceMood(balance(100000,'KRW')),'normal');
 for(const total of [null,undefined,'',NaN,-1,Infinity])assert.equal(balanceMood(balance(total)),null);
 assert.equal(balanceMood({...balance(100),stale:true}),null);
});
test('completion celebrates only a newly observed turn once, never historical or stopped tasks',()=>{
 let now=1000;const observe=createContextReactions({now:()=>now});
 const view=activity=>({activity,sessionId:'one'});
 assert.equal(observe(view({stage:'done',startedAt:1,endedAt:500})),null);
 assert.equal(observe(view({stage:'working',startedAt:1000})),null);
 now=2000;assert.equal(observe(view({stage:'done',startedAt:1000,endedAt:2000})).kind,'done');
 now=200000;assert.equal(observe(view({stage:'done',startedAt:1000,endedAt:2000})),null);
 observe(view({stage:'working',startedAt:now}));now+=1000;
 assert.equal(observe(view({stage:'stopped',startedAt:200000,endedAt:now})),null);
});
test('active time excludes pause and background gaps, and disabled completions never replay',()=>{
 let now=1000;const observe=createContextReactions({now:()=>now});
 const activity={stage:'working',startedAt:1000};const input={activity,sessionId:'one'};
 observe(input);
 now+=600000;assert.equal(observe({...input,hidden:true}),null);
 for(let i=0;i<20;i++){now+=30000;assert.equal(observe(input),null);}
 now+=30000;assert.equal(observe(input)?.kind,'work');
 now+=1000;assert.equal(observe({...input,enabled:false,activity:{...activity,stage:'done',endedAt:now}}),null);
 now+=200000;assert.equal(observe({...input,activity:{...activity,stage:'done',endedAt:now-200000}}),null);
});
test('balance refresh and waiting state cannot loop decorative reactions',()=>{
 let now=1;const observe=createContextReactions({now:()=>now});
 const input={sessionId:'one',activity:{stage:'idle'},panel:'balance',balance:{ok:true,total:200,rawCurrency:'CNY'}};
 assert.equal(observe(input)?.kind,'balance');now+=200000;
 assert.equal(observe({...input,balance:{...input.balance,total:300}}),null);
 assert.equal(observe({...input,activity:{stage:'waiting'},balance:{...input.balance,total:1}}),null);
 now+=200000;assert.equal(observe({...input,balance:{...input.balance,total:1}}),null);
});

test('supply progress wraps forward, coalesces reward bursts and skips animation for reduced motion',async()=>{
 const {createSupplyProgress}=await import('../lib/shared/client/reward-scatter.js');
 const frames=[],timers=[];const motion=createSupplyProgress(v=>frames.push(v),{schedule:fn=>{timers.push(fn);return timers.length;},cancel:()=>{}});
 motion.update(.8);assert.equal(frames.at(-1).animate,false);
 motion.update(.9);assert.equal(frames.at(-1).value,.9);assert.equal(frames.at(-1).tone,1);
 motion.update(1.1);assert.equal(frames.at(-1).value,1);
 motion.update(4.6);timers.shift()();assert.equal(frames.at(-1).value,0);assert.equal(frames.at(-1).animate,false);
 timers.shift()();assert(Math.abs(frames.at(-1).value-.6)<1e-8);
 motion.update(5.2,true);assert.equal(frames.at(-1).animate,false);
 motion.update(0);assert.equal(frames.at(-1).value,0);motion.dispose();
});

test('care actions preserve the panel and serialize distinct rapid clicks without a time cooldown',async t=>{
 const {useCareActions}=await import('../lib/shared/client/use-care-actions.js');let closes=0,requests=0,finish,busy=false;
 const saved=new Map(['fetch','sessionStorage','localStorage'].map(k=>[k,globalThis[k]]));t.after(()=>{for(const[k,v]of saved)v===undefined?delete globalThis[k]:globalThis[k]=v;});
 globalThis.sessionStorage={setItem(){},removeItem(){}};globalThis.localStorage={setItem(){}};
 globalThis.fetch=()=>{requests++;return new Promise(resolve=>{finish=()=>resolve({ok:true,json:async()=>({ok:true,receiptId:'one',gain:{},cooldownMs:8000})});});};
 const G={migrate:()=>({satiety:20}),tick:n=>({state:n}),applyGain:n=>({state:n})};
 const actions=useCareActions({useCallback:fn=>fn,useRef:v=>({current:v}),useEffect(){},inventoryBusyRef:{current:false},GROWRef:{current:G},cfgRef:{current:{growth:{enabled:true,rates:{}},pools:{click:[]}}},closeOrb:()=>closes++,speak(){},pendingResource:{current:null},readStore:()=>({}),GROW_KEY:'test',busyRef:{current:false},setInventoryBusy:v=>{busy=v;},ASSET_BASE:'/test',acceptInventory(){},pick:()=>'',play(){},loadGrowth(){},prefsRef:{current:{playful:true}},t:s=>s});
 const pending=actions.feed({keepOpen:true});assert.equal(busy,true);const second=actions.feed({keepOpen:true});assert.equal(requests,1);assert.equal(closes,0);finish();await pending;assert.equal(requests,2);finish();await second;assert.equal(busy,false);
 const radial=actions.feed();assert.equal(closes,1);finish();await radial;
});

test('uncertain care requests stop unsent clicks and reuse the receipt ID on explicit retry',async t=>{
 const {useCareActions}=await import('../lib/shared/client/use-care-actions.js');
 const saved=new Map(['fetch','sessionStorage','localStorage'].map(k=>[k,globalThis[k]]));t.after(()=>{for(const[k,v]of saved)v===undefined?delete globalThis[k]:globalThis[k]=v;});
 globalThis.sessionStorage={setItem(){},removeItem(){}};globalThis.localStorage={setItem(){}};
 const ids=[];globalThis.fetch=async(_url,options)=>{ids.push(JSON.parse(options.body).requestId);throw Error('offline');};
 const G={migrate:()=>({satiety:100}),tick:n=>({state:n}),applyGain:n=>({state:n})};
 const pending={current:null};const actions=useCareActions({useCallback:fn=>fn,useRef:v=>({current:v}),useEffect(){},inventoryBusyRef:{current:false},GROWRef:{current:G},cfgRef:{current:{growth:{enabled:true,rates:{}},pools:{click:[]}}},closeOrb(){},speak(){},pendingResource:pending,readStore:()=>({}),GROW_KEY:'test',busyRef:{current:false},setInventoryBusy(){},ASSET_BASE:'/test',acceptInventory(){},pick:()=>'',play(){},loadGrowth(){},prefsRef:{current:{playful:true}},t:s=>s});
 const first=actions.feed({keepOpen:true}),second=actions.feed({keepOpen:true});assert.equal(await first,false);assert.equal(await second,false);assert.equal(ids.length,1);assert.equal(pending.current.requestId,ids[0]);
 await actions.feed({keepOpen:true});assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);
});
