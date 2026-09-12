import test from 'node:test';
import assert from 'node:assert/strict';
import {sessionActivity,animationState,publicText} from '../lib/shared/activity.js';
import {createActivityReader} from '../lib/host/activity.js';
import {activityPreview} from './fixtures/activity-preview.mjs';
const e=(type,data={},time=100)=>({type,data,time});
const call=(id,name='read',args={})=>e('tool/call',{callId:id,name,arguments:JSON.stringify(args),turn:1});
const result=(id,isError=false)=>e('tool/result',{turn:1,message:{source:{callId:id},content:[{type:'tool-result',isError,content:[{type:'text',text:isError?'Failed':'Completed'}]}]}},200);
test('concurrent tools retain independent results and the remaining current operation',()=>{
 const a=sessionActivity([e('turn/start',{turn:1}),call('a'),call('b','bash',{command:'npm test'}),result('a')]);
 assert.equal(a.tools,2);assert.equal(a.current.id,'b');assert.equal(a.stage,'testing');assert.equal(a.operations[0].result,'Completed');
 const b=sessionActivity([e('turn/start',{turn:1}),call('a'),call('a'),result('a',true)]);assert.equal(b.tools,1);assert.equal(b.operations[0].status,'error');assert.notEqual(b.stage,'done');
});
test('new turns reset previous outcomes and inherited content is excluded',()=>{
 const a=sessionActivity([e('assistant/message',{message:{content:[{type:'text',text:'inherited private'}]}}),e('turn/start',{turn:1}),call('a'),e('turn/end',{turn:1,reason:{kind:'completed'}}),e('turn/start',{turn:2})],1);
 assert.equal(a.summary,'');assert.equal(a.tools,0);assert.equal(a.stage,'thinking');assert.ok(!JSON.stringify(a).includes('private'));
});
test('hidden reasoning, raw arguments, streams and tokens are never exposed',()=>{
 const a=sessionActivity([e('turn/start'),call('a','bash',{command:'secret command',token:'secret token'}),e('assistant/message',{message:{content:[{type:'reasoning',text:'hidden reasoning'},{type:'text',text:'Public summary'}]},stream:['raw secret']})]);
 assert.equal(a.summary,'Public summary');assert.ok(!JSON.stringify(a).includes('secret'));assert.ok(!JSON.stringify(a).includes('hidden reasoning'));assert.equal(publicText([{type:'text',text:'Bearer very-secret'}]),'[redacted]');
});
test('waiting and interrupted states clear correctly; completion animation is one-shot',()=>{
 const start=[e('turn/start'),call('a','ask_user_question')];assert.equal(sessionActivity(start).stage,'waiting');
 for(const reason of ['aborted','interrupted','unknown']) {const a=sessionActivity([...start,e('turn/end',{reason:{kind:reason}})]);assert.equal(a.stage,'stopped');assert.equal(a.current.status,'stopped');}
 const a=sessionActivity([...start,e('turn/end',{reason:{kind:'completed'}},1000)]);assert.equal(animationState(a,2000),'success');assert.equal(animationState(a,20000),'idle');assert.equal(a.stage,'done');
});
test('only successful file mutations become file results',()=>{
 const a=sessionActivity([e('turn/start'),call('a','edit',{path:'app.js'}),result('a',true),call('b','read',{path:'read.js'}),result('b'),call('c','write',{path:'done.js'}),result('c')]);
 assert.deepEqual(a.artifacts.map(x=>x.path),['done.js']);
});
test('activity reader isolates session children and keeps released child outcomes',()=>{
 const f=activityPreview('working',200000),sessions=new Map();
 const parent={header:{id:'parent'},snapshotEvents:()=>f.events};sessions.set('parent',parent);
 const child=f.children[0],live={header:{id:child.id,parentSession:'parent',origin:'subagent'},snapshotEvents:()=>child.events};sessions.set(child.id,live);
 const reader=createActivityReader(()=>sessions);reader.observe(live,child.events.at(-1));sessions.delete(child.id);
 const value=reader.read('parent');assert.equal(value.activity.children[0].stage,'done');assert.match(value.activity.children[0].summary,/峰谷/);assert.equal(value.activity.children[1].stage,'unknown');
 assert.equal(reader.read('missing').ok,false);
 sessions.set(child.id,{...live,header:{...live.header,parentSession:'another'}});
 assert.equal(reader.read('parent').activity.children[0].stage,'done');
});
test('all demo scenarios use real event shapes and no billable usage',()=>{
 for(const mode of ['thinking','working','result','waiting','ask','error','abort','retry','success','idle']) {
  const f=activityPreview(mode),a=sessionActivity(f.events);assert.ok(a.stage);assert.ok(!JSON.stringify(f).includes('inputTokens'));
 }
 const a=sessionActivity(activityPreview('success').events);assert.equal(a.stage,'done');assert.equal(a.tasks.completed,3);assert.equal(a.artifacts.length,1);assert.equal(a.children.length,3);
});
test('concurrent approvals stay waiting until all real decisions arrive',()=>{
 const events=[e('turn/start',{turn:1}),e('approval/asked',{id:'a',reason:'Review write'}),e('approval/asked',{id:'b'}),e('approval/decided',{id:'a',outcome:{kind:'approved'}})];
 assert.equal(sessionActivity(events).stage,'waiting');assert.equal(sessionActivity(events).attention.id,'b');
 assert.equal(sessionActivity([...events,e('approval/decided',{id:'b'})]).stage,'working');
});
test('resumed existing children belong to the current turn only when they actually ran',()=>{
 const first=e('turn/start',{turn:1},10),catalog=e('subagent/catalog',{version:0,childId:'child',mode:'continuable',label:'Review'},20);
 const events=[first,catalog,e('turn/end',{turn:1,reason:{kind:'completed'}},30),e('turn/start',{turn:2},100)];
 const child={header:{id:'child',origin:'subagent',parentSession:'parent'},snapshotEvents:()=>[e('turn/start',{turn:2},110)]};
 const parent={snapshotEvents:()=>events};const reader=createActivityReader(()=>new Map([['parent',parent],['child',child]]));
 assert.equal(reader.read('parent').activity.children.length,1);
 child.snapshotEvents=()=>[e('turn/start',{turn:1},20),e('turn/end',{reason:{kind:'completed'}},30)];assert.equal(reader.read('parent').activity.children.length,0);
});
test('switching sessions rejects late responses and clears old progress',async t=>{
 const {createActivityRuntime}=await import('../lib/shared/activity-ui.js');
 const previousDocument=globalThis.document;globalThis.document={hidden:false};
 const pending=[];t.mock.method(globalThis,'fetch',async url=>new Promise(resolve=>pending.push({url,resolve})));
 let cleanup;const React={Component:class {},createElement:()=>null,useEffect:fn=>{cleanup=fn();},useState:()=>[null,()=>{}],useRef:()=>({current:null})};
 const runtime=createActivityRuntime(React);
 try {
  runtime.Bridge({sessionId:'old'});const cleanupOld=cleanup;
  runtime.Bridge({sessionId:'new'});const cleanupNew=cleanup;
  assert.equal(runtime.snapshot().sessionId,'new');assert.equal(runtime.snapshot().data,null);
  pending[1].resolve({ok:true,json:async()=>({ok:true,sessionId:'new',activity:{title:'New task'}})});
  await new Promise(resolve=>setImmediate(resolve));
  pending[0].resolve({ok:true,json:async()=>({ok:true,sessionId:'old',activity:{title:'Old private task'}})});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(runtime.snapshot().data.title,'New task');cleanupOld();assert.equal(runtime.snapshot().sessionId,'new');cleanupNew();assert.equal(runtime.snapshot().data,null);
 }finally{cleanup?.();globalThis.document=previousDocument;}
});
test('long tool results remain bounded and are explicitly marked as excerpts',()=>{
 const output='x'.repeat(7000),event=result('a');event.data.message.content[0].content[0].text=output;
 const a=sessionActivity([e('turn/start'),call('a'),event]);assert.equal(a.current.result.length,6000);assert.equal(a.current.truncated,true);
});
