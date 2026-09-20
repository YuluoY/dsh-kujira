import test from 'node:test';
import assert from 'node:assert/strict';
import {createWebNavigation} from '../desktop/src/web-navigation.js';

function scenario({online=true,reused=false,focus=true,legacy=false}={}) {
 let starts=0,opens=0,focused=0,navigations=0,clock=0,done=true;
 const connection={tick:async()=>{},snapshot:()=>({online}),navigate:async()=>{navigations++;return{reused,browser:'chrome',navigationId:'one'};},navigationStatus:async()=>({result:{done,success:true}})};
 const service={ensureRunning:async()=>{starts++;online=!legacy;},openWeb:async()=>{opens++;}};
 const navigate=createWebNavigation({connection,service,focus:async()=>{focused++;return focus;},now:()=>clock,wait:async ms=>{clock+=ms;}});
 return {navigate,connection,service,counts:()=>({starts,opens,focused,navigations}),hang:()=>{done=false;}};
}
test('cold start launches once and opens exactly one browser page',async()=>{
 const s=scenario({online:false});const a=s.navigate({kind:'web'}),b=s.navigate({kind:'web'});assert.equal(a,b);assert.equal((await a).success,true);
 assert.deepEqual(s.counts(),{starts:1,opens:1,focused:0,navigations:1});
});
test('a running service without a browser opens only a page',async()=>{
 const s=scenario();await s.navigate({kind:'web'});assert.deepEqual(s.counts(),{starts:0,opens:1,focused:0,navigations:1});
});
test('an existing browser tab is activated without starting a service or opening a duplicate',async()=>{
 const s=scenario({reused:true});assert.equal((await s.navigate({kind:'web'})).reused,true);assert.deepEqual(s.counts(),{starts:0,opens:0,focused:1,navigations:1});
});
test('legacy host opens the web once while non-web deep links report the required restart',async()=>{
 const s=scenario({online:false,legacy:true});await s.navigate({kind:'web'});assert.deepEqual(s.counts(),{starts:1,opens:1,focused:0,navigations:0});
 const other=scenario({online:false,legacy:true});await assert.rejects(other.navigate({kind:'session',sessionId:'x'}),/desktop-host-needs-restart/);
});
test('browser focus failure is reported and never disguised as a successful switch or duplicate tab',async()=>{
 const s=scenario({reused:true,focus:false});await assert.rejects(s.navigate({kind:'web'}),/browser-focus-failed/);assert.equal(s.counts().opens,0);
});
test('startup errors, acknowledgement timeouts and overlapping destinations stay explicit',async()=>{
 const s=scenario({online:false});s.service.ensureRunning=async()=>{throw Error('dsh-start-failed');};await assert.rejects(s.navigate({kind:'web'}),/dsh-start-failed/);assert.equal(s.counts().opens,0);
 const timeout=scenario();timeout.hang();assert.equal((await timeout.navigate({kind:'web'})).success,false);
 const busy=scenario();const pending=busy.navigate({kind:'web'});await assert.rejects(busy.navigate({kind:'session',sessionId:'x'}),/web-navigation-busy/);await pending;
});

test('focus waits for a successful acknowledgement and releases its exact marker afterward',async()=>{
 const s=scenario({reused:true});let polls=0,clock=0;const order=[];
 s.connection.navigationStatus=async()=>{polls++;order.push('poll');return{result:polls<2?{done:false}:{done:true,success:true,focusToken:'assigned-marker'}};};
 s.connection.finishNavigation=async id=>{assert.equal(id,'one');order.push('release');};
 const navigate=createWebNavigation({connection:s.connection,service:s.service,focus:async(browser,token)=>{
  assert.equal(browser,'chrome');assert.equal(token,'assigned-marker');assert.equal(polls,2);order.push('focus');return true;
 },now:()=>clock,wait:async ms=>{clock+=ms;}});
 assert.equal((await navigate({kind:'web'})).success,true);
 assert.deepEqual(order,['poll','poll','focus','release']);assert.equal(s.counts().opens,0);
});

test('negative or missing acknowledgements never activate unrelated browser windows',async()=>{
 for(const result of [{done:true,success:false},{done:false}]){
  const s=scenario({reused:true});s.connection.navigationStatus=async()=>({result});
  assert.equal((await s.navigate({kind:'web'})).success,false);
  assert.equal(s.counts().focused,0);assert.equal(s.counts().opens,0);
 }
});

test('a page already in the foreground needs no native focus and activation failure still releases its marker',async()=>{
 const s=scenario({reused:true});s.connection.navigationStatus=async()=>({result:{done:true,success:true,focused:true}});
 assert.equal((await s.navigate({kind:'web'})).success,true);assert.equal(s.counts().focused,0);
 const failure=scenario({reused:true,focus:false});let released=0;
 failure.connection.finishNavigation=async()=>{released++;};
 await assert.rejects(failure.navigate({kind:'web'}),/browser-focus-failed/);assert.equal(released,1);assert.equal(failure.counts().opens,0);
});
