import {test} from 'node:test';
import assert from 'node:assert/strict';
import {floatingPosition,bubbleOutline} from '../lib/shared/panel-controls.js';

test('select opens below the trigger when room is available',()=>{
 const p=floatingPosition({top:100,bottom:132,right:300},{width:164,height:110},{width:1024,height:768});
 assert.deepEqual(p,{left:136,top:138,width:164,maxHeight:110});
});
test('select flips above a trigger near the bottom',()=>{
 const p=floatingPosition({top:710,bottom:742,right:1000},{width:164,height:144},{width:1024,height:768});
 assert.equal(p.top,560);assert.equal(p.maxHeight,144);assert.ok(p.top+p.maxHeight<710);
});
test('wide menus are bounded by narrow viewports and retain scroll space',()=>{
 const p=floatingPosition({top:200,bottom:240,right:315},{width:500,height:900},{width:320,height:480});
 assert.equal(p.width,304);assert.equal(p.left,8);assert.ok(p.maxHeight<900);assert.ok(p.top+p.maxHeight<=472);
});
test('speech and feature outlines stay finite and closed at their supported sizes',()=>{
 for(const w of [132,216,272,320,351])for(const hh of [36,40,58,68,90,338,520])for(const anchor of [-100,0,hh/2,hh+100]){
  const d=bubbleOutline(w,hh,anchor);assert.match(d,/^M/);assert.match(d,/Z$/);assert.doesNotMatch(d,/NaN|Infinity|undefined/);
 }
});
test('compact outlines omit the outward pointer entirely',()=>{
 const w=296;const d=bubbleOutline(w,338,280,false);
 assert.ok(!d.includes('C'));assert.ok(!d.includes(String(w+9)));assert.match(d,/Z$/);
});

test('refresh keeps the successful view and its content while a request is pending', async()=>{
 const {beginRefresh,finishRefresh}=await import('../lib/shared/panel-controls.js');
 const previous={ok:true,total:12.3,granted:1,toppedUp:11.3,fetchedAt:100};
 const pending=beginRefresh(previous);
 assert.equal(pending.ok,true);assert.equal(pending.total,12.3);assert.equal(pending.refreshing,true);assert.notEqual(pending.loading,true);
 const next=finishRefresh(pending,{ok:true,total:10,granted:1,toppedUp:9,fetchedAt:200});
 assert.equal(next.total,10);assert.equal(next.refreshing,false);assert.equal(previous.total,12.3);
});
test('failed refresh retains previous numbers and exposes a non-destructive error',async()=>{
 const {beginRefresh,finishRefresh}=await import('../lib/shared/panel-controls.js');
 const previous={ok:true,total:12.3};
 const result=finishRefresh(beginRefresh(previous),{ok:false,message:'网络错误'});
 assert.equal(result.ok,true);assert.equal(result.total,12.3);assert.equal(result.refreshError,'网络错误');assert.equal(result.refreshing,false);
 const first=finishRefresh(beginRefresh(null),{ok:false,message:'网络错误'});
 assert.equal(first.ok,false);assert.equal(first.loading,false);
});
