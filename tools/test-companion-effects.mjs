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
