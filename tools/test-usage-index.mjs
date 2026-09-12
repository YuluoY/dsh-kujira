import test from 'node:test';
import assert from 'node:assert/strict';
import {createUsageIndex} from '../lib/host/usage-index.js';
import {createSettlementObserver} from '../lib/host/settlement-observer.js';
import {usageRecords,PRICING} from '../lib/shared/session-cost.js';
const time=Date.parse('2026-09-14T10:00:00+08:00');
const header={type:'request/header',data:{header:{config:{provider:'deepseek-official',model:'deepseek-flash'}}}};
const event=i=>({type:'assistant/message',seq:i,time:time+i,data:{turn:1,step:i,stream:[],usage:{inputTokens:100,outputTokens:200}}});
test('append-only indexing matches full folding and scans only the new suffix',()=>{
 let events=[header,event(1)];const session={snapshotEvents:()=>events,inheritedEventCount:0},read=createUsageIndex();const first=read(session);
 assert.equal(read(session),first);
 for(let i=2;i<30;i++){
  events=[...events,event(i)];const next=read(session);assert.equal(next.scanned,1);assert.deepEqual([...next.rows],[...usageRecords(events).rows]);
 }
 assert.equal(first.rows.size,1);
 const old=read(session);events=[...events,{type:'turn/end',seq:31}];const next=read(session);assert.equal(next.changes.size,0);assert.equal(next.rows,old.rows);
});
test('configuration changes, replaced logs and fork-prefix changes invalidate the index',()=>{
 let events=[header,event(1)];const session={snapshotEvents:()=>events,inheritedEventCount:0},read=createUsageIndex();read(session);
 events=[header,event(2)];assert.equal(read(session).scanned,2);
 session.inheritedEventCount=2;assert.equal(read(session).rows.size,0);
 session.inheritedEventCount=0;read(session);const changed=read(session,structuredClone(PRICING));assert.equal(changed.scanned,2);
});
test('settlement observer returns immediately, coalesces a burst and flushes pending work on disposal',async()=>{
 let scheduled;const calls=[];const observer=createSettlementObserver(s=>calls.push(s.id),{schedule:fn=>{scheduled=fn;return 1;},cancel:()=>{scheduled=null;}});
 for(let i=0;i<100;i++)observer.enqueue({id:'one'});observer.enqueue({id:'two'});assert.deepEqual(calls,[]);
 scheduled();await Promise.resolve();await Promise.resolve();assert.deepEqual(calls,['one','two']);
 observer.enqueue({id:'three'});await observer.dispose();assert.deepEqual(calls,['one','two','three']);observer.enqueue({id:'four'});assert.equal(scheduled,null);
});

test('graceful observer disposal waits for already scheduled persistence',async()=>{
 let tick,resolve;const observer=createSettlementObserver(()=>new Promise(done=>{resolve=done;}),{schedule:fn=>{tick=fn;return 1;},cancel:()=>{}});
 observer.enqueue({id:'one'});tick();await Promise.resolve();let disposed=false;const end=observer.dispose().then(()=>{disposed=true;});await Promise.resolve();assert.equal(disposed,false);resolve();await end;assert.equal(disposed,true);
});
test('activity cache reuses unchanged results, invalidates child changes and has a restart-specific epoch',async()=>{
 const {createActivityReader}=await import('../lib/host/activity.js');
 let events=[{type:'turn/start',time:1,data:{turn:1}},{type:'subagent/catalog',time:2,data:{childId:'child',mode:'one-shot',label:'Check'}}];
 let childEvents=[{type:'turn/start',time:1,data:{turn:1}}];
 const sessions=new Map([['parent',{snapshotEvents:()=>events}],['child',{header:{origin:'subagent',parentSession:'parent'},snapshotEvents:()=>childEvents}]]);
 const reader=createActivityReader(()=>sessions);const first=reader.read('parent');assert.equal(reader.read('parent'),first);
 childEvents=[...childEvents,{type:'turn/end',time:3,data:{turn:1,reason:{kind:'completed'}}}];const next=reader.read('parent');assert.notEqual(next,first);assert.equal(next.activity.children[0].stage,'done');assert(next.revision>first.revision);
 assert.notEqual(createActivityReader(()=>sessions).read('parent').epoch,next.epoch);
});
test('unchanged host activity responds with 304, and new events invalidate the response',async t=>{
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {apply}=await import('../lib/index.js');
 const directory=await mkdtemp(join(tmpdir(),'kujira-etag-'));const disposes=[];let handler;
 let events=[{type:'turn/start',seq:0,time:1,data:{turn:1}}];const session={header:{id:'session'},snapshotEvents:()=>events};
 const ctx={agents:{list:()=>[]},sessions:new Map([['session',session]]),credentials:{resolve:async()=>undefined},inject(keys,fn){fn(this);},effect(fn){const end=fn();if(typeof end==='function')disposes.push(end);return end;},on(){return()=>{};},webServer:{register(route){handler=route.handler;return()=>{};}}};
 t.after(async()=>{await Promise.all(disposes.reverse().map(fn=>fn()));await rm(directory,{recursive:true,force:true});});
 apply(ctx,{inventory:{directory},scheduler:{directory},realtime:{enabled:false}});
 const request=async etag=>{const response={headers:{},setHeader(k,v){this.headers[k]=v;},writeHead(code,headers){this.code=code;Object.assign(this.headers,headers);},end(body){this.body=body||'';}};await handler({url:'/dsh-kujira/activity?sessionId=session',method:'GET',headers:{'if-none-match':etag}},response);return response;};
 const first=await request();assert.equal(first.code,200);const same=await request(first.headers.ETag);assert.equal(same.code,304);assert.equal(same.body,'');
 events=[...events,{type:'turn/end',seq:1,time:2,data:{turn:1,reason:{kind:'completed'}}}];const changed=await request(first.headers.ETag);assert.equal(changed.code,200);assert.notEqual(changed.headers.ETag,first.headers.ETag);
});

test('footer aggregates verified descendants, excludes inherited usage and deduplicates references',async()=>{
 const {createUsageReader}=await import('../lib/host/usage.js');
 const catalog=id=>({type:'subagent/catalog',data:{childId:id,mode:'one-shot'}});
 const parentEvents=[header,event(1),catalog('child'),catalog('child')];
 let childEvents=[header,event(2),catalog('grand')];
 const inherited=[header,event(9)];
 const sessions=new Map([
  ['parent',{header:{id:'parent'},snapshotEvents:()=>parentEvents}],
  ['child',{header:{id:'child',origin:'subagent',parentSession:'parent'},snapshotEvents:()=>childEvents}],
  ['grand',{header:{id:'grand',origin:'subagent',parentSession:'child'},inheritedEventCount:2,snapshotEvents:()=>[...inherited,event(3),catalog('parent')]}],
 ]);
 const read=createUsageReader(()=>sessions,()=>PRICING);
 const a=await read.tree('parent');
 assert.equal(a.requests,3);assert.equal(a.children.count,2);assert.equal(a.children.requests,2);
 assert(Math.abs(a.totals.total-(read('parent').totals.total+read('child').totals.total+read('grand').totals.total))<1e-12);
 assert(Math.abs(a.children.total-(a.totals.total-a.selfTotal))<1e-12);
 const before=a.totals.total;childEvents=[...childEvents,event(4)];const b=await read.tree('parent');assert.equal(b.requests,4);assert(b.totals.total>before);
});
test('released child sessions load read-only; unrelated or inaccessible children make totals partial',async()=>{
 const {createUsageReader}=await import('../lib/host/usage.js');
 const parent={snapshotEvents:()=>[header,event(1),...['saved','other','missing'].map(childId=>({type:'subagent/catalog',data:{childId,mode:'continuable'}}))]};
 const access={get:id=>id==='parent'?parent:undefined,prepare:async id=>id==='missing'?undefined:{header:{origin:'subagent',parentSession:id==='saved'?'parent':'elsewhere'},snapshotEvents:()=>[header,event(2)]}};
 const read=createUsageReader(()=>access,()=>PRICING),a=await read.tree('parent');
 assert.equal(a.children.count,1);assert.equal(a.children.unavailable,2);assert.equal(a.requests,2);assert.equal(a.complete,false);
});
test('concurrent tree requests coalesce and inherited child catalogs never attach to a new fork',async()=>{
 const {createUsageReader}=await import('../lib/host/usage.js');let calls=0;
 const session={inheritedEventCount:1,snapshotEvents:()=>[{type:'subagent/catalog',data:{childId:'old-child',mode:'one-shot'}},header,event(1)]};
 const access={get:()=>undefined,prepare:async()=>{calls++;return session;}};
 const read=createUsageReader(()=>access,()=>PRICING);
 const a=read.tree('fork'),b=read.tree('fork');assert.equal(a,b);
 const result=await a;assert.equal(calls,1);assert.equal(result.children.count,0);assert.equal(result.requests,1);
});

test('released completed children reuse small summaries and late settlements invalidate them',async()=>{
 const {createUsageReader}=await import('../lib/host/usage.js');let loads=0;
 const parent={snapshotEvents:()=>[header,{type:'subagent/catalog',data:{childId:'child',mode:'one-shot'}}]};
 let events=[header,event(1),{type:'turn/end'}];
 const access={get:id=>id==='parent'?parent:undefined,prepare:async()=>{loads++;return {header:{origin:'subagent',parentSession:'parent'},snapshotEvents:()=>events};}};
 const read=createUsageReader(()=>access,()=>PRICING);const a=await read.tree('parent');await read.tree('parent');assert.equal(loads,1);
 events=[...events,event(2)];read.invalidate('child');const b=await read.tree('parent');assert.equal(loads,2);assert(b.totals.total>a.totals.total);
});
