import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPeakScheduler} from '../lib/host/scheduler.js';
const peak=Date.parse('2026-09-11T09:00:00+08:00'),valley=Date.parse('2026-09-11T12:00:00+08:00');
const settled=()=>new Promise(resolve=>setImmediate(resolve));
async function setup(t){const directory=await mkdtemp(join(tmpdir(),'kujira-scheduler-'));let clock=peak;const scheduler=createPeakScheduler({directory,now:()=>clock,available:true});await scheduler.ready;t.after(async()=>{scheduler.dispose();await rm(directory,{recursive:true,force:true});});return {scheduler,directory,setTime:value=>{clock=value;scheduler.tick();}};}
test('default off; global gate holds every session and resumes original continuation exactly once',async t=>{
 const {scheduler,setTime}=await setup(t);assert.equal(scheduler.snapshot().enabled,false);await scheduler.configure(true);
 let calls=0;const controls=[new AbortController(),new AbortController()];
 const promises=controls.map((c,i)=>scheduler.gate({agent:{id:'s'+i},signal:c.signal},async()=>{calls++;return 'original '+i;}));await settled();
 assert.equal(calls,0);assert.equal(scheduler.snapshot().paused,2);assert.equal(scheduler.paused('s0'),true);
 setTime(valley);assert.deepEqual(await Promise.all(promises),['original 0','original 1']);scheduler.tick();assert.equal(calls,2);assert.equal(scheduler.snapshot().paused,0);
});
test('manual cancellation never resumes the cancelled session at valley',async t=>{
 const {scheduler,setTime}=await setup(t);await scheduler.configure(true);const abort=new AbortController();let calls=0;
 const waiting=scheduler.gate({agent:{id:'s'},signal:abort.signal},()=>{calls++;});await settled();abort.abort(new Error('manual stop'));
 await assert.rejects(waiting,/manual stop/);setTime(valley);assert.equal(calls,0);assert.equal(scheduler.snapshot().paused,0);
});
test('turning the switch off releases waiters and persists the global setting',async t=>{
 const {scheduler,directory}=await setup(t);await scheduler.configure(true);const a=scheduler.gate({agent:{id:'s'},signal:new AbortController().signal},()=>42);await settled();await scheduler.configure(false);assert.equal(await a,42);
 assert.equal(JSON.parse(await readFile(join(directory,'peak-scheduler.json'),'utf8')).enabled,false);
});
test('a restored enabled setting gates the first step; disposal never strands the driver',async t=>{
 const {scheduler,directory}=await setup(t);await scheduler.configure(true);scheduler.dispose();const restored=createPeakScheduler({directory,now:()=>peak,available:true});t.after(()=>restored.dispose());
 const pending=restored.gate({agent:{id:'s'},signal:new AbortController().signal},()=>7);await restored.ready;await settled();assert.equal(restored.snapshot().paused,1);restored.dispose();assert.equal(await pending,7);
});
test('weekends and both daily boundaries use the pricing timezone',async t=>{
 const {scheduler,setTime}=await setup(t);await scheduler.configure(true);
 for(const [date,rate] of [['2026-09-11T08:59:59+08:00','offpeak'],['2026-09-11T09:00:00+08:00','peak'],['2026-09-11T12:00:00+08:00','offpeak'],['2026-09-11T14:00:00+08:00','peak'],['2026-09-11T18:00:00+08:00','offpeak'],['2026-09-12T10:00:00+08:00','offpeak']]){setTime(Date.parse(date));assert.equal(scheduler.snapshot().rate,rate);}
});
test('crossing into peak while downstream preparation runs still holds the same decision',async t=>{
 const {scheduler,setTime}=await setup(t);setTime(valley);await scheduler.configure(true);let resolvePrepare,calls=0;
 const run=scheduler.gate({agent:{id:'s'},signal:new AbortController().signal},()=>{calls++;return new Promise(resolve=>{resolvePrepare=resolve;});});await settled();
 setTime(Date.parse('2026-09-11T14:00:00+08:00'));resolvePrepare({kind:'enter',messages:['original']});await settled();assert.equal(scheduler.snapshot().paused,1);assert.equal(calls,1);
 setTime(Date.parse('2026-09-11T18:00:00+08:00'));assert.deepEqual(await run,{kind:'enter',messages:['original']});
});

test('a downstream rejection is returned even when the tariff changed during preparation',async t=>{
 const {scheduler,setTime}=await setup(t);setTime(valley);await scheduler.configure(true);
 const decision=await scheduler.gate({agent:{id:'rejected'},signal:new AbortController().signal},async()=>{setTime(peak);return {kind:'reject',reason:'cancelled'};});
 assert.equal(decision.kind,'reject');assert.equal(scheduler.snapshot().paused,0);
});

test('enabling during existing work reports pending safe stops and gates the next request for every active agent',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'kujira-active-gate-'));let now=peak;
 const agents=[{id:'main',status:'running'},{id:'child',status:'running'},{id:'idle',status:'idle'}];
 const scheduler=createPeakScheduler({directory,now:()=>now,available:true,getAgents:()=>agents});t.after(async()=>{scheduler.dispose();await rm(directory,{recursive:true,force:true});});
 await scheduler.configure(true);assert.equal(scheduler.snapshot().pausing,2);
 let calls=0;const runs=agents.slice(0,2).map(agent=>scheduler.gate({agent,signal:new AbortController().signal},()=>{calls++;return {model:'deepseek-flash'};}));
 await settled();assert.equal(calls,0);assert.equal(scheduler.snapshot().paused,2);assert.equal(scheduler.snapshot().pausing,0);
 now=valley;scheduler.tick();await Promise.all(runs);assert.equal(calls,2);
});

test('session headers and registry aliases share pause identity across duplicate gates',async t=>{
 const {scheduler,setTime}=await setup(t);await scheduler.configure(true);
 const agent={id:'registry-id',session:{id:'session-alias',header:{id:'canonical'}}};
 const a=new AbortController(),b=new AbortController();let calls=0;
 const one=scheduler.gate({agent,signal:a.signal},()=>++calls),two=scheduler.gate({agent,signal:b.signal},()=>++calls);
 await settled();for(const id of ['registry-id','session-alias','canonical'])assert(scheduler.paused(id));
 assert.equal(scheduler.snapshot().paused,1);a.abort(Error('stop one gate'));await assert.rejects(one,/stop one/);
 assert(scheduler.paused('canonical'));setTime(valley);await two;assert.equal(calls,1);assert(!scheduler.paused('canonical'));
});
test('200 main and child continuations survive repeated tariff transitions without duplicate work',async t=>{
 const {scheduler,setTime}=await setup(t);await scheduler.configure(true);const counts=Array(200).fill(0);
 const pending=counts.map((_,i)=>scheduler.gate({agent:{id:'agent-'+i,session:{header:{id:'session-'+i}}},signal:new AbortController().signal},()=>++counts[i]));
 await settled();assert.equal(scheduler.snapshot().paused,200);
 setTime(valley);setTime(peak);await settled();assert.equal(scheduler.snapshot().paused,200);assert(counts.every(n=>n===0));
 setTime(valley);await Promise.all(pending);assert(counts.every(n=>n===1));assert.equal(scheduler.snapshot().paused,0);
});
test('cancelling one child while paused preserves other children and never resurrects the cancelled child',async t=>{
 const {scheduler,setTime}=await setup(t);await scheduler.configure(true);const controllers=Array.from({length:4},()=>new AbortController());const calls=[];
 const tasks=controllers.map((controller,i)=>scheduler.gate({agent:{id:i===0?'parent':'child-'+i},signal:controller.signal},()=>calls.push(i)));
 await settled();controllers[2].abort(Error('user stopped child'));await assert.rejects(tasks[2],/user stopped/);
 setTime(valley);await Promise.all(tasks.filter((_,i)=>i!==2));assert.deepEqual(calls,[0,1,3]);
});
test('a failed configuration write preserves the running setting and no caller remains in a poisoned save queue',async t=>{
 const {scheduler,directory,setTime}=await setup(t);await scheduler.configure(true);
 const {mkdir}=await import('node:fs/promises');await mkdir(join(directory,'peak-scheduler.json.tmp'));
 await assert.rejects(scheduler.configure(false));assert.equal(scheduler.snapshot().enabled,true);
 await rm(join(directory,'peak-scheduler.json.tmp'),{recursive:true});await scheduler.configure(false);assert.equal(scheduler.snapshot().enabled,false);setTime(valley);
});
test('pricing rule changes and clock rollback invalidate the cached transition',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'kujira-tariff-'));let clock=peak;const config={peakHours:[[9,12]],workdays:[1,2,3,4,5]};
 const scheduler=createPeakScheduler({directory,now:()=>clock,getConfig:()=>config,available:true});t.after(async()=>{scheduler.dispose();await rm(directory,{recursive:true,force:true});});await scheduler.ready;
 assert.equal(scheduler.snapshot().rate,'peak');config.peakHours=[];assert.equal(scheduler.snapshot().rate,'offpeak');
 config.peakHours=[[9,12]];clock=Date.parse('2026-09-11T08:00:00+08:00');assert.equal(scheduler.snapshot().rate,'offpeak');assert.equal(scheduler.snapshot().nextAt,peak);
});
test('already cancelled tasks cannot enter the gate and rejected downstream work has no stranded waiter',async t=>{
 const {scheduler}=await setup(t);await scheduler.configure(true);const stop=new AbortController();stop.abort(Error('already stopped'));
 await assert.rejects(scheduler.gate({agent:{id:'stopped'},signal:stop.signal},()=>assert.fail('executed cancelled task')),/already stopped/);
 await scheduler.configure(false);await assert.rejects(scheduler.gate({agent:{id:'failure'}},()=>Promise.reject(Error('preparation failed'))),/preparation failed/);assert.equal(scheduler.snapshot().paused,0);
});
test('malformed pricing never crashes the timer or silently resumes paid work; recovery releases the same continuation',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'kujira-invalid-tariff-'));let config={peakHours:[null]};
 const scheduler=createPeakScheduler({directory,now:()=>valley,getConfig:()=>config,available:true});t.after(async()=>{scheduler.dispose();await rm(directory,{recursive:true,force:true});});
 await scheduler.configure(true);assert.equal(scheduler.snapshot().rate,'unknown');let calls=0;
 const pending=scheduler.gate({agent:{id:'held'}},()=>++calls);await settled();scheduler.tick();assert.equal(calls,0);assert.equal(scheduler.snapshot().paused,1);
 config={peakHours:[]};scheduler.tick();await pending;assert.equal(calls,1);assert.equal(scheduler.snapshot().error,'');
});
test('a pending continuation keeps the scheduler alive even without another referenced event-loop handle',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'kujira-gate-liveness-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const {spawnSync}=await import('node:child_process');const {fileURLToPath}=await import('node:url');
 const child=spawnSync(process.execPath,[fileURLToPath(new URL('./fixtures/scheduler-liveness.mjs',import.meta.url)),directory],{encoding:'utf8',timeout:3000});assert.equal(child.status,0,child.stderr);assert.equal(child.stdout,'continued');
});
