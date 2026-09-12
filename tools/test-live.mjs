import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRealtime, parseOfficialPricing } from '../lib/host/realtime.js';
import { createWeatherClient } from '../lib/host/weather.js';
import { sessionActivity } from '../lib/shared/activity.js';
const html = await readFile(new URL('./fixtures/pricing.html',import.meta.url),'utf8');
const response = body => ({ok:true,text:async()=>body,json:async()=>body});
test('official table spans preserve exact prices; changed schedule is rejected',()=>{
 assert.equal(parseOfficialPricing(html)['deepseek-flash'].miss,1);
 assert.equal(parseOfficialPricing(html)['deepseek-v4-pro'].out,13.5);
 assert.throws(()=>parseOfficialPricing(html.replace('14:00 - 18:00','14:00 - 19:00')));
 assert.throws(()=>parseOfficialPricing(html.replace('0.04元','0.05元')));
});
test('automatic checks are cached across restarts and never call model by default',async()=>{
 const cacheDir=await mkdtemp(join(tmpdir(),'kujira-live-'));let calls=0, keys=0;
 try {
 const options={cacheDir,getKey:async()=>{keys++;return 'fake';},fetch:async()=>{calls++;return response(html);}};
 const first=createRealtime(options);await first.ready;assert.equal(first.status().settings.automatic,false);await first.configure({automatic:true});await first.refresh();await first.refresh(true);
 assert.equal(calls,1);assert.equal(keys,0);assert.ok(first.status().checkedAt);
 const second=createRealtime(options);await second.refresh();assert.equal(calls,1);
 await second.configure({automatic:false});
 const third=createRealtime(options);await third.ready;assert.equal(third.status().settings.automatic,false);
 }finally{await rm(cacheDir,{recursive:true,force:true});}
});
test('manual mode blocks startup fetch but permits one explicit sync',async()=>{
 const cacheDir=await mkdtemp(join(tmpdir(),'kujira-live-'));let calls=0;
 try{const rt=createRealtime({cacheDir,fetch:async()=>{calls++;return response(html);}});await rt.configure({automatic:false});await rt.refresh();assert.equal(calls,0);await rt.refresh(true);assert.equal(calls,1);}finally{await rm(cacheDir,{recursive:true,force:true});}
});
test('new prices append history and source failure keeps last good price',async()=>{
 const cacheDir=await mkdtemp(join(tmpdir(),'kujira-live-'));
 try {const rt=createRealtime({cacheDir,fetch:async()=>response(html.replace('0.02元','0.03元').replace('0.04元','0.06元'))});await rt.refresh(true);const history=rt.pricing().prices['deepseek-flash'].history;assert.equal(history[0].hit,.02);assert.equal(history.at(-1).hit,.03);
 const file=join(cacheDir,'realtime.json'), data=JSON.parse(await readFile(file,'utf8'));data.attemptedAt=0;await writeFile(file,JSON.stringify(data));
 const offline=createRealtime({cacheDir,fetch:async()=>{throw Error('offline');}});await offline.refresh(true);assert.equal(offline.pricing().prices['deepseek-flash'].history.at(-1).hit,.03);
 }finally{await rm(cacheDir,{recursive:true,force:true});}
});
test('unknown source does not spend model tokens unless explicitly enabled',async()=>{
 const cacheDir=await mkdtemp(join(tmpdir(),'kujira-live-'));let keys=0;
 try{const rt=createRealtime({cacheDir,getKey:async()=>{keys++;return 'fake';},fetch:async()=>response('<html>changed</html>')});await rt.refresh(true);assert.equal(keys,0);assert.match(rt.status().summary,/保留/);}finally{await rm(cacheDir,{recursive:true,force:true});}
});
test('weather uses automatic IP mode, deduplicates, caches and keeps stale results',async()=>{
 let calls=0,fail=false,lastUrl='';const query=createWeatherClient(()=>'',{fetch:async url=>{calls++;lastUrl=url;if(fail)throw Error();return response({city:'杭州市',weather:'小雨',temperature:21,humidity:94,wind_direction:'东北风',wind_power:'4级'});}});
 const [a,b]=await Promise.all([query(false),query(false)]);assert.equal(calls,1);assert.equal(a.automatic,true);assert.equal(a.tomorrow,null);assert.equal(a.now.feelsLike,null);assert.ok(!lastUrl.includes('city='));assert.equal(b.city,a.city);
 await query(false);assert.equal(calls,1);fail=true;assert.equal((await query(true)).stale,true);
 const disabled=await query(false,{auto:false});assert.equal(disabled.reason,'no-city');
});
test('execution uses session events, avoids inherited steps and clears waiting on completion',()=>{
 const events=[{type:'tool/call',time:1,data:{name:'secret'}},{type:'turn/start',time:10},{type:'tool/call',time:20,data:{name:'read_file',arguments:'private'}},{type:'approval/asked',time:30}];
 const a=sessionActivity(events,1);assert.equal(a.tools,1);assert.equal(a.phase,'waiting');assert.ok(!JSON.stringify(a).includes('private'));
 const end=sessionActivity([...events,{type:'turn/end',time:40,data:{reason:{kind:'completed'}}}],1);assert.equal(end.phase,'done');assert.equal(end.endedAt,40);
});
test('model assistance requires opt-in and persists a 24-hour paid-call limit',async()=>{
 const cacheDir=await mkdtemp(join(tmpdir(),'kujira-live-'));let paid=0;
 const options={cacheDir,getKey:async()=> 'mock-key',fetch:async(url,init)=>{
  if(url.includes('chat/completions')) {paid++;const body=JSON.parse(init.body);assert.equal(body.model,'deepseek-flash');assert.ok(!body.messages.some(m=>m.content.includes('private session')));return response({choices:[{message:{content:'待核对摘要'}}]});}
  return response('<html>官网结构变化</html>');
 }};
 try{const rt=createRealtime(options);await rt.configure({modelAssist:true,automatic:true});await rt.refresh();assert.equal(paid,1);assert.match(rt.status().summary,/待核对摘要/);
 const path=join(cacheDir,'realtime.json'), saved=JSON.parse(await readFile(path,'utf8'));saved.attemptedAt=0;await writeFile(path,JSON.stringify(saved));const again=createRealtime(options);await again.refresh();assert.equal(paid,1);
 }finally{await rm(cacheDir,{recursive:true,force:true});}
});
