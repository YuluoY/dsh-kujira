import test from 'node:test';
import assert from 'node:assert/strict';
import {createAutosave} from '../lib/shared/client/reward-queue.js';
const initial={ok:true,revision:1,rulesRevision:0,rules:{chance:25,min:1,max:3}};
function fixture(save){let tick,view;const saver=createAutosave({save,notify:v=>{view=v;},valid:r=>r.min<=r.max,schedule:fn=>{tick=fn;return 1;},cancel:()=>{tick=null;}});saver.sync(initial);return {saver,view:()=>view,tick:()=>{const fn=tick;tick=null;fn?.();}};}
const settle=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
test('rapid edits display immediately and coalesce to a single write',async()=>{
 const calls=[];const f=fixture(async(rules,rulesRevision)=>{calls.push({rules,rulesRevision});return {...initial,revision:2,rulesRevision:1,rules};});
 f.saver.edit('chance',26);f.saver.edit('chance',27);f.saver.edit('max',4);assert.equal(calls.length,0);assert.equal(f.view().draft.chance,27);assert.equal(f.view().draft.max,4);
 f.tick();await settle();assert.equal(calls.length,1);assert.equal(calls[0].rules.chance,27);assert.equal(f.view().busy,false);
});
test('edits made during a request survive its response and use the returned revision',async()=>{
 let done;const calls=[];const f=fixture((rules,revision)=>{calls.push({rules,revision});return new Promise(resolve=>{done=resolve;});});
 f.saver.edit('chance',30);f.tick();assert.equal(f.view().draft.chance,30);
 f.saver.edit('chance',40);f.saver.edit('min',2);f.tick();assert.equal(calls.length,1);
 done({...initial,revision:2,rulesRevision:1,rules:{...initial.rules,chance:30}});await settle();assert.equal(f.view().draft.chance,40);f.tick();assert.equal(calls[1].revision,1);assert.equal(calls[1].rules.min,2);
 done({...initial,revision:3,rulesRevision:2,rules:calls[1].rules});await settle();
});
test('validation blocks invalid ranges and save errors preserve edits until retry',async()=>{
 let calls=0;const f=fixture(async rules=>{calls++;if(calls===1)throw Error();return {...initial,revision:2,rules};});
 f.saver.edit('min',5);f.tick();assert.equal(calls,0);assert(f.view().error);
 f.saver.edit('max',6);f.tick();await settle();assert.equal(calls,1);assert.equal(f.view().draft.min,5);assert(f.view().error);
 f.saver.retry();await settle();assert.equal(calls,2);assert.equal(f.view().error,'');
});
test('closing flushes valid edits, and a conflict retains newer remote fields without blind retries',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;return {ok:false,reason:'rules-conflict',inventory:{...initial,revision:4,rulesRevision:3,rules:{...initial.rules,max:8}}};});
 f.saver.edit('chance',40);f.tick();await settle();assert.equal(calls,1);assert.equal(f.view().draft.max,8);assert.equal(f.view().draft.chance,40);assert(f.view().error);
 const g=fixture(async rules=>{calls++;return {...initial,revision:5,rules};});g.saver.edit('chance',50);g.saver.flush();await settle();assert.equal(calls,2);
});

test('numeric units stay inside the control and preserve an accessible formatted value',async()=>{
 const {createControls}=await import('../lib/shared/panel-controls.js');
 const React={createElement:(type,props,...children)=>({type,props,children}),useId:()=>'',useRef:()=>({current:null}),useState:value=>[typeof value==='function'?value():value,()=>{}],useEffect(){},useLayoutEffect(){}};
 const {NumberField}=createControls(React);const field=NumberField({label:'Amount',value:.1,unit:'¥',prefix:true,onChange(){}});
 assert.equal(field.children.length,3);assert.equal(field.children[0].type,'button');assert.equal(field.children[2].type,'button');
 const middle=field.children[1];assert.equal(middle.props.className,'kj-number-value');assert.equal(middle.children[0].children[0],'¥');assert(middle.children[1].props['aria-valuetext'].includes('¥'));
});
test('appearance edits react immediately while persistence is debounced and flushed on exit',async t=>{
 const {createPreferences}=await import('../lib/shared/client/preferences.js');const previous=new Map(['window','navigator','matchMedia','setTimeout','clearTimeout'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 t.after(()=>{for(const [k,v]of previous)v?Object.defineProperty(globalThis,k,v):delete globalThis[k];});
 let timer,writes=0,stored={};const listeners=new Map();
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{languages:['en'],language:'en'}});
 globalThis.window={addEventListener:(k,fn)=>listeners.set(k,fn),removeEventListener(){},dispatchEvent:e=>listeners.get(e.type)?.()};globalThis.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
 globalThis.setTimeout=fn=>{timer=fn;return 1;};globalThis.clearTimeout=()=>{timer=null;};
 const values=[],cleanups=[];const {usePreferences}=createPreferences({readStore:()=>stored,SET_KEY:'test',useState:value=>[typeof value==='function'?value():value,v=>values.push(v)],I18N:{configure:()=> 'en'},useEffect:fn=>cleanups.push(fn()),writeStore:(_k,v)=>{writes++;stored=v;}});
 const p=usePreferences();p.update({size:200});p.update({size:220});assert.equal(writes,0);assert(values.some(v=>v?.size===220));timer();assert.equal(writes,1);assert.equal(stored.appearance.size,220);
 p.update({opacity:80});listeners.get('pagehide')();assert.equal(writes,2);assert.equal(stored.appearance.opacity,80);cleanups.forEach(fn=>fn?.());
});
