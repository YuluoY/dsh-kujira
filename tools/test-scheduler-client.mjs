import test from 'node:test';
import assert from 'node:assert/strict';
import { createSchedulerStore } from '../lib/shared/client/scheduler-store.js';
import { createComposerPause } from '../lib/shared/client/composer-pause.js';
import { createActivityStore } from '../lib/shared/task/store.js';

const flush = async () => { for(let i=0;i<20;i++) await Promise.resolve(); };
const response = data => ({ok:true,json:async()=>structuredClone(data)});
const paused = {ok:true,enabled:true,available:true,rate:'peak',sessions:[
  {id:'main',state:'paused',pauseId:'main-pause'},
  {id:'child',state:'paused',pauseId:'child-pause',parentId:'main'},
]};

test('all composers share one read and resume only after a confirmed server response',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let reads=0,finish,posted;
 t.mock.method(globalThis,'fetch',async(_url,options)=>{
  if(options.method==='POST'){posted=JSON.parse(options.body);return new Promise(resolve=>{finish=resolve;});}
  reads++;return response(paused);
 });
 const store=createSchedulerStore({}),main=[],child=[];
 const offMain=store.subscribe(view=>main.push(view)),offChild=store.subscribe(view=>child.push(view));
 t.after(()=>{offMain();offChild();});await flush();assert.equal(reads,1);
 assert.equal(main.at(-1),child.at(-1));
 const resumed=store.resume('child','child-pause');await flush();
 assert.equal(store.snapshot().busy,true);assert.equal(store.snapshot().data.sessions.length,2);
 assert.equal(await store.resume('child','child-pause'),false);
 assert.deepEqual(posted,{action:'resume',sessionId:'child',pauseId:'child-pause'});
 finish(response({...paused,sessions:[paused.sessions[0]]}));assert.equal(await resumed,true);
 assert.equal(store.snapshot().busy,false);assert.deepEqual(store.snapshot().data.sessions.map(s=>s.id),['main']);
});

test('a read begun before resume cannot restore the old pause after the command succeeds',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let reads=0,finishRead;
 t.mock.method(globalThis,'fetch',async(_url,options)=>{
  if(options.method==='POST')return response({...paused,sessions:[]});
  if(++reads===1)return response(paused);
  return new Promise(resolve=>{finishRead=resolve;});
 });
 const store=createSchedulerStore({}),dispose=store.subscribe(()=>{});t.after(dispose);await flush();
 t.mock.timers.tick(1500);await flush();assert(finishRead);
 await store.resume('main','main-pause');finishRead(response(paused));await flush();
 assert.deepEqual(store.snapshot().data.sessions,[]);
});

test('failed and ambiguous resumes retain the confirmed pause and expose an error until resync',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let offline=false;
 t.mock.method(globalThis,'fetch',async(_url,options)=>{
  if(options.method==='POST' || offline)throw Error('offline');
  return response(paused);
 });
 const store=createSchedulerStore({}),dispose=store.subscribe(()=>{});t.after(dispose);await flush();
 offline=true;assert.equal(await store.resume('main','main-pause'),false);await flush();
 assert.equal(store.snapshot().data.sessions.length,2);assert(store.snapshot().error);
 offline=false;t.mock.timers.tick(30000);await flush();assert.equal(store.snapshot().error,'');
});

test('composers derive their own state when main and sidebar are mounted together',()=>{
 const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()}),useRef:()=>({current:null}),useState:()=>[false,()=>{}],useLayoutEffect(){},useCallback:fn=>fn};
 const store={useScheduler:()=>({data:{...paused,sessions:[paused.sessions[1]]},error:'',busy:false}),resume(){}};
 const Composer=createComposerPause(React,store,()=>{});
 assert.equal(Composer({sessionId:'main'}).props['data-active'],undefined);
 assert.equal(Composer({sessionId:'child'}).props['data-active'],true);
 const reconnect=createComposerPause(React,{...store,useScheduler:()=>({data:paused,error:'offline',busy:false})},()=>{});
 const view=reconnect({sessionId:'main'});assert.equal(view.props['data-active'],true);
 assert.equal(view.children.find(n=>n?.props?.className==='kj-scheduler-fallback-resume').props.disabled,true);
});

test('immediate activity resync discards an older paused response after a resume',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const previous=Object.getOwnPropertyDescriptor(globalThis,'document');
 Object.defineProperty(globalThis,'document',{value:{hidden:false},configurable:true});
 t.after(()=>{if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document;});
 let effect,finishOld,reads=0,oldSignal;
 const activity=stage=>response({ok:true,sessionId:'main',activity:{stage}});
 t.mock.method(globalThis,'fetch',async(_url,options)=>{
  if(++reads===1){oldSignal=options.signal;return new Promise(resolve=>{finishOld=resolve;});}
  return activity('working');
 });
 const store=createActivityStore({useEffect:fn=>{effect=fn;}});
 store.Bridge({sessionId:'main'});const dispose=effect();t.after(dispose);await flush();
 await store.refresh();assert.equal(oldSignal.aborted,true);assert.equal(store.snapshot().data.stage,'working');
 finishOld(activity('paused'));await flush();assert.equal(store.snapshot().data.stage,'working');
 t.mock.timers.tick(1500);await flush();assert.equal(reads,3);
});
