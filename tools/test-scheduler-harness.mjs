import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPeakScheduler } from '../lib/host/scheduler.js';

// Run against the installed package; this never connects to a running DSH service.
const store = process.env.DSH_HARNESS_STORE || join(homedir(), 'Library/pnpm/global/5/.pnpm');
const entries = await readdir(store).catch(() => []);
const version = process.env.DSH_HARNESS_VERSION || await readFile(join(store, '../node_modules/@deepseek-ai/dsh/package.json'), 'utf8').then(text=>JSON.parse(text).version).catch(()=>null);
const installed = version && entries.find(name => name.startsWith('@deepseek-ai+dsh-goal-round-driver@'+version+'_'));
const modulePath = installed && join(store, installed, 'node_modules/@deepseek-ai/dsh-goal-round-driver/lib/index.js');
const upstream = modulePath && await import(pathToFileURL(modulePath).href);
const peak = Date.parse('2026-09-11T10:00:00+08:00');
const valley = Date.parse('2026-09-11T12:00:00+08:00');
const flush = () => new Promise(resolve => setImmediate(resolve));

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'kujira-real-goal-'));
  let clock = peak, cleanup;
  const hooks = new Map(), agents = new Map(), warnings = [];
  const emit = (name, value) => { for (const fn of hooks.get(name) || []) fn(value); };
  const goal = {id:'goal',revision:1,objective:'isolated test',phase:'active',activation:'armed',roundsStarted:0,maxGoalRounds:3};
  const controller = new AbortController();
  const queued = [];
  const agent = {
    id:'test-session',status:'idle',session:{id:'test-session'},
    inbox:{nextTurn:[],nextStep:[],prepend(){}},
    followup(message) { this.status='running'; this.inbox.nextTurn.push(message); queued.push(message); emit('agent/inbox/inserted',{agent:this,message}); },
    cancel() {controller.abort(Error('human-stop'));this.status='idle';},
    whenIdle:async()=>{},
  };
  const ctx = {
    fiber:{state:2},logger:{warn:text=>warnings.push(text)},
    on(name, fn) {const list=hooks.get(name)||[];list.push(fn);hooks.set(name,list);},
    effect(fn) {cleanup=fn().next().value;},
    agents:{get:id=>agents.get(id),list:()=>[...agents.values()],currentInitiator:()=>null,withoutInitiator:fn=>fn()},
    goals:{get:()=>({...goal}),disarm:()=>{goal.activation='disarmed';},pause:()=>{goal.phase='paused';goal.activation='disarmed';},block:()=>{goal.phase='blocked';goal.activation='disarmed';}},
    sessions:{flush:async()=>{}},
  };
  upstream.apply(ctx);
  agents.set(agent.id,agent);emit('agent/created',{agent});
  const scheduler=createPeakScheduler({directory,now:()=>clock,available:true,getAgents:()=>[agent],getGoal:()=>goal});
  t.after(async()=>{scheduler.dispose();await cleanup();await rm(directory,{recursive:true,force:true});assert.deepEqual(warnings,[]);});
  await scheduler.configure(true);
  const start=async()=>{
    emit('agent/status',{agent,status:'idle'});await flush();
    const message=queued.at(-1);if(!message)return null;
    agent.inbox.nextTurn=[];emit('agent/inbox/claimed',{agent,message});
    const payload={agent,messages:[message],signal:controller.signal};
    const upstreamGate=hooks.get('agent/pre-step')[0];
    return { message, run:scheduler.gate(payload,()=>upstreamGate(payload,async()=>({kind:'enter',messages:[message]}))) };
  };
  return {goal,agent,queued,start,emit,scheduler,release(){clock=valley;scheduler.tick();}};
}

test('installed GoalRoundDriver retains exactly one reserved round across a peak hold', {skip:!upstream}, async t=>{
  const f=await fixture(t);const pending=await f.start();await flush();
  assert.equal(f.scheduler.snapshot().paused,1);assert.equal(f.queued.length,1);assert.equal(f.goal.roundsStarted,0);
  f.release();const decision=await pending.run;
  assert.equal(decision.kind,'enter');assert.equal(decision.startsRequestSeries,true);
  assert.equal(decision.messages[0],pending.message);assert.equal(f.queued.length,1);
});

test('installed GoalRoundDriver manual goal pause cancels a tariff-held continuation', {skip:!upstream}, async t=>{
  const f=await fixture(t);const pending=await f.start();await flush();
  f.goal.phase='paused';f.goal.activation='disarmed';
  f.emit('goal/changed',{agent:f.agent,change:{operation:'pause'}});
  await assert.rejects(pending.run,/human-stop/);f.release();
  assert.equal(f.scheduler.snapshot().paused,0);assert.equal(f.queued.length,1);
});

test('installed GoalRoundDriver rejects changed goal reservations and obeys exhausted round budgets', {skip:!upstream}, async t=>{
  const f=await fixture(t);const pending=await f.start();await flush();
  f.goal.phase='completed';f.release();assert.equal((await pending.run).kind,'reject');
  f.goal.phase='active';f.goal.activation='armed';f.goal.roundsStarted=3;f.agent.status='idle';
  f.emit('agent/status',{agent:f.agent,status:'idle'});await flush();
  assert.equal(f.goal.phase,'blocked');assert.equal(f.queued.length,1);
});

const subagentPackage = version && entries.find(name => name.startsWith('@deepseek-ai+dsh-subagent-in-process-driver@'+version+'_'));
const subagentDriver = subagentPackage && await import(pathToFileURL(join(store, subagentPackage, 'node_modules/@deepseek-ai/dsh-subagent-in-process-driver/lib/index.js')).href);
for (const cancel of [false,true]) test(`installed in-process child ${cancel?'propagates parent cancellation':'resumes its original run'} across a tariff hold`, {skip:!subagentDriver}, async t=>{
  const directory=await mkdtemp(join(tmpdir(),'kujira-real-child-'));let clock=peak, calls=0, runPromise, createOptions;
  const scheduler=createPeakScheduler({directory,now:()=>clock,available:true});
  t.after(async()=>{scheduler.dispose();await rm(directory,{recursive:true,force:true});});await scheduler.configure(true);
  const parentSignal=new AbortController(),childSignal=new AbortController(),events=[];
  const child={id:'child',status:'idle',session:{header:{id:'child',parentSession:'parent'},snapshotEvents:()=>events},
    followup(){this.status='running';runPromise=scheduler.gate({agent:this,signal:childSignal.signal},()=>{calls++;events.push({type:'step/start',data:{turn:1,step:1}},{type:'turn/end',data:{turn:1,reason:{kind:'completed'}}});}).catch(()=>{}).finally(()=>{this.status='idle';});},
    whenIdle:()=>runPromise,cancel:()=>childSignal.abort(Error('parent cancelled'))};
  const parent={session:{header:{id:'parent'},requestHeader:()=>null},options:{},ctx:{get:()=>undefined,agents:{create:async options=>{createOptions=options;return {agent:child,dispose:async()=>{}};}}}};
  const run=await subagentDriver.startInProcessRun({parent,signal:parentSignal.signal,prompt:[{type:'text',text:'isolated fixture'}],descriptor:{}},{});
  await flush();assert.equal(createOptions.parentAgent,parent);assert.equal(createOptions.meta.parentSession,'parent');assert.equal(scheduler.snapshot().paused,1);
  if(cancel)parentSignal.abort();clock=valley;scheduler.tick();const result=await run.result;
  assert.equal(calls,cancel?0:1);assert.equal(result.stopReason,cancel?'aborted':'completed');assert.equal(scheduler.snapshot().paused,0);await run.dispose();
});

test('goal continuation does not enable a disabled peak scheduler', {skip:!upstream}, async t=>{
 const f=await fixture(t);await f.scheduler.configure(false);
 const pending=await f.start();assert.equal((await pending.run).kind,'enter');
 assert.equal(f.scheduler.snapshot().enabled,false);assert.equal(f.scheduler.snapshot().paused,0);
});
