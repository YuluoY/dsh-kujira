import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPeakScheduler } from '../lib/host/scheduler.js';
import { createRouteHandler } from '../lib/host/routes.js';

test('HTTP pause, conditional reads and guarded resume share the same authoritative state',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'kujira-scheduler-http-'));
 const scheduler=createPeakScheduler({directory,available:true,now:()=>Date.parse('2026-09-11T10:00:00+08:00')});
 const handler=createRouteHandler({
  PACKAGE_ROOT:process.cwd(),ROUTE_PREFIX:'/dsh-kujira',getAgents:()=>null,scheduler,
  sessionAccess:{prepare:async()=>{}},
  activityReader:{read:id=>({ok:true,sessionId:id,epoch:'test',revision:1,activity:{stage:'working',children:[{id:'child',stage:'working'}]}})},
 });
 const server=createServer((req,res)=>handler(req,res));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{scheduler.dispose();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}/dsh-kujira`;
 const post=(input,headers={'X-Kujira-Settings':'1'})=>fetch(base+'/scheduler',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(input)});
 assert.equal((await post({enabled:true})).status,200);
 let view=await fetch(base+'/activity?sessionId=main');const initialTag=view.headers.get('etag');
 assert.equal((await view.json()).activity.scheduling.paused,false);
 let calls=0;const main={id:'main'},child={id:'child',session:{header:{parentSession:'main'}}};
 const runs=[main,child].map(agent=>scheduler.gate({agent},()=>++calls));await new Promise(resolve=>setImmediate(resolve));
 view=await fetch(base+'/activity?sessionId=main',{headers:{'If-None-Match':initialTag}});
 assert.equal(view.status,200);const pausedTag=view.headers.get('etag'),held=(await view.json()).activity;
 assert.equal(held.stage,'paused');assert.equal(held.children[0].stage,'paused');assert(held.scheduling.pauseId);
 assert.equal((await fetch(base+'/activity?sessionId=main',{headers:{'If-None-Match':pausedTag}})).status,304);
 const action={action:'resume',sessionId:'main',pauseId:held.scheduling.pauseId};
 assert.equal((await post(action,{})).status,403);
 assert.equal((await post(action,{'X-Kujira-Settings':'1',Origin:'http://unrelated.invalid'})).status,403);
 assert.equal((await post({...action,pauseId:null})).status,400);
 assert.equal((await post({...action,pauseId:'stale'})).status,409);assert.equal(calls,0);
 const result=await post(action);assert.equal(result.status,200);assert.equal((await result.json()).enabled,true);
 await Promise.all(runs);assert.equal(calls,2);
 view=await fetch(base+'/activity?sessionId=main',{headers:{'If-None-Match':pausedTag}});
 assert.equal(view.status,200);const resumed=(await view.json()).activity;
 assert.equal(resumed.stage,'working');assert.equal(resumed.children[0].stage,'working');assert.equal(resumed.scheduling.paused,false);
 assert.equal((await post(action)).status,409);assert.equal(calls,2);
});
