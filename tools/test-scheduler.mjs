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
