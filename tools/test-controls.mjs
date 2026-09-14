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

function controlHarness(){
 const state=[];let cursor=0;
 const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)}),Fragment:'fragment',
 useId:()=> 'field-test',useRef:value=>{const i=cursor++;return state[i]||=( {current:value});},
 useState:value=>{const i=cursor++;if(!(i in state))state[i]=typeof value==='function'?value():value;return[state[i],next=>{state[i]=typeof next==='function'?next(state[i]):next;}];},useEffect(){},useLayoutEffect(){}};
 return {React,render:(Component,props)=>{cursor=0;return Component(props);}};
}
function controlFind(node,predicate){if(!node||typeof node!=='object')return; if(predicate(node))return node;for(const child of node.children||[]){const found=controlFind(child,predicate);if(found)return found;}}

test('text field retains draft during IME and commits through blur only',async()=>{
 const {createControls}=await import('../lib/shared/panel-controls.js');const f=controlHarness(),{TextField}=createControls(f.React),changes=[],commits=[];
 const view=f.render(TextField,{label:'名称',value:'',onChange:value=>changes.push(value),onCommit:value=>commits.push(value)});
 const input=controlFind(view,node=>node.type==='input');let blurs=0;
 const event={key:'Enter',currentTarget:{value:'中文',blur:()=>{blurs++;input.props.onBlur({currentTarget:{value:'中文'}});}},preventDefault(){},nativeEvent:{isComposing:false}};
 input.props.onCompositionStart();input.props.onChange(event);input.props.onKeyDown(event);assert.equal(blurs,0);assert.deepEqual(commits,[]);
 input.props.onCompositionEnd();input.props.onKeyDown(event);assert.equal(blurs,1);assert.deepEqual(commits,['中文']);assert.deepEqual(changes,['中文']);
});
test('text field exposes loading, read-only and field-specific error states',async()=>{
 const {createControls}=await import('../lib/shared/panel-controls.js');const f=controlHarness(),{TextField}=createControls(f.React);
 const view=f.render(TextField,{label:'地址',value:'bad',error:'地址无效',loading:true,readOnly:true});
 const input=controlFind(view,node=>node.type==='input');assert.equal(input.props.disabled,true);assert.equal(input.props.readOnly,true);assert.equal(input.props['aria-invalid'],true);
 const message=controlFind(view,node=>node.props?.role==='status');assert.equal(message.props.id,input.props['aria-describedby']);
});
test('settings categories mount only the selected content and support keyboard navigation',async()=>{
 const {createControls}=await import('../lib/shared/panel-controls.js');const f=controlHarness(),{SettingsTabs}=createControls(f.React),renders=[];
 const props={items:['appearance','desktop','services'].map(id=>({id,label:id,render:()=>{renders.push(id);return id;}}))};
 let view=f.render(SettingsTabs,props);assert.deepEqual(renders,['appearance']);
 let focused=-1;const tabs=[0,1,2].map(i=>({focus:()=>{focused=i;}}));
 const first=controlFind(view,node=>node.props?.role==='tab');
 first.props.onKeyDown({key:'End',preventDefault(){},currentTarget:{parentElement:{querySelectorAll:()=>tabs}}});
 view=f.render(SettingsTabs,props);assert.equal(focused,2);assert.deepEqual(renders,['appearance','services']);
 assert.equal(controlFind(view,node=>node.props?.role==='tab'&&node.props['aria-selected']).children[0],'services');
});

test('text field help stays beside its label with an associated accessible description',async()=>{
 const {createControls}=await import('../lib/shared/panel-controls.js');const f=controlHarness(),controls=createControls(f.React);
 const view=f.render(controls.TextField,{label:'地址',value:'',help:'只接受本机地址'});
 const input=controlFind(view,node=>node.type==='input');
 const description=controlFind(view,node=>node.props?.className==='kj-visually-hidden');
 assert.equal(input.props['aria-describedby'],description.props.id);
 const labelComponent=controlFind(view,node=>node.type===controls.HelpLabel);
 const labelTree=controls.HelpLabel(labelComponent.props);
 assert.equal(controlFind(labelTree,node=>node.type==='label').props.htmlFor,input.props.id);
 assert.equal(controlFind(labelTree,node=>node.type==='button').props['data-tooltip'],'只接受本机地址');
 assert.equal(controlFind(view,node=>node.type==='p'),undefined);
});

test('care responses vary without immediately repeating and need no model requests',async()=>{
 const {careLine}=await import('../lib/shared/client/use-care-actions.js');
 for(const kind of ['fish','pat','play','stretch']){
   let previous='';const choices=new Set();
   for(let i=0;i<12;i++){const next=careLine(kind,previous,()=>i%4/4);assert.notEqual(next,previous);choices.add(next);previous=next;}
   assert(choices.size>=3);
 }
});

test('scheduler list pages large sets and clamps a disappearing last page',async()=>{
 const {createControls}=await import('../lib/shared/panel-controls.js');const f=controlHarness(),{SchedulerSessionList}=createControls(f.React);
 const sessions=Array.from({length:8},(_,i)=>({id:'s'+i,state:'upcoming'}));
 const rows=view=>controlFind(view,n=>n.type==='ul').children;
 let view=f.render(SchedulerSessionList,{sessions,upcoming:true});assert.equal(rows(view).length,3);
 assert.equal(controlFind(view,n=>n.type==='section').props['aria-label'],'即将接管的会话');
 const next=()=>controlFind(view,n=>n.type==='nav').children.at(-1).props.onClick();
 next();view=f.render(SchedulerSessionList,{sessions,upcoming:true});assert.equal(rows(view)[0].props.key,'s3');
 next();view=f.render(SchedulerSessionList,{sessions,upcoming:true});assert.equal(rows(view).length,2);
 view=f.render(SchedulerSessionList,{sessions:sessions.slice(0,2),upcoming:false});assert.equal(rows(view).length,2);assert.equal(controlFind(view,n=>n.type==='nav'),undefined);
 assert.equal(controlFind(view,n=>n.type==='section').props['aria-label'],'接管中的会话');
});

test('session rows stay on one line with labelled tooltip icons and an independent open action',async()=>{
 const {createControls}=await import('../lib/shared/panel-controls.js');const f=controlHarness(),{SchedulerSessionList}=createControls(f.React),opened=[];
 const props={sessions:[{id:'session-1',title:'真实会话标题',state:'upcoming'}],openSession:async id=>{opened.push(id);return true;}};
 const view=f.render(SchedulerSessionList,props);
 assert.equal(controlFind(view,n=>n.type==='dl'),undefined);
 const row=controlFind(view,n=>n.props.className==='kj-session-status-heading');assert.equal(row.children.length,4);assert.equal(controlFind(view,n=>n.props.className==='kj-session-open').children[0],'真实会话标题');
 for(const button of row.children.filter(n=>n.props.className?.includes('kj-session-icon'))){assert(button.props['aria-label']);assert.equal(button.props['data-tooltip'],button.props['aria-label']);assert(controlFind(button,n=>n.type==='svg'));}
 await controlFind(view,n=>n.props.className==='kj-session-open').props.onClick();assert.deepEqual(opened,['session-1']);
});

test('session copy writes the exact identity and propagates failures',async t=>{
 const {copySessionId}=await import('../lib/shared/panel-controls.js');const old=globalThis.kujiraDesktop,writes=[];
 t.after(()=>{globalThis.kujiraDesktop=old;});globalThis.kujiraDesktop={copySessionId:async id=>writes.push(id)};
 await copySessionId('session-exact-id');assert.deepEqual(writes,['session-exact-id']);
 await assert.rejects(copySessionId('bad\nid'));assert.equal(writes.length,1);
 globalThis.kujiraDesktop.copySessionId=async()=>{throw Error('clipboard denied');};await assert.rejects(copySessionId('valid'),/clipboard denied/);
});

test('tooltip survives crossing the gap, entering its surface and returning to the same icon',async t=>{
 const {createControls}=await import('../lib/shared/panel-controls.js');t.mock.timers.enable({apis:['setTimeout']});
 let cleanup;const saved=new Map();const replace=(key,value)=>{saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});};
 t.after(()=>{cleanup?.();for(const [key,descriptor] of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
 const node=()=>({listeners:{},dataset:{},style:{setProperty(){}},isConnected:true,hover:false,focused:false,open:false,offsetWidth:100,offsetHeight:30,
 addEventListener(name,fn){this.listeners[name]=fn;},removeEventListener(){},contains(other){return other===this;},matches(selector){return selector===':popover-open'?this.open:selector===':hover'?this.hover:this.focused;},setAttribute(){},removeAttribute(){},showPopover(){this.open=true;},hidePopover(){this.open=false;},getBoundingClientRect:()=>({left:100,right:200,top:100,bottom:130,width:100,height:30})});
 const root=node(),el=node(),icon=node(),outside=node();icon.dataset.tooltip='read me';icon.closest=selector=>selector==='[data-tooltip]'?icon:null;root.contains=n=>n===icon||n===root||n===el;
 replace('document',{...node(),activeElement:null});replace('window',node());replace('innerWidth',800);replace('innerHeight',600);replace('getComputedStyle',()=>({getPropertyValue:()=>''}));replace('MutationObserver',class{observe(){}disconnect(){}});
 const React={createElement:()=>null,useId:()=> 'tip',useRef:()=>({current:el}),useEffect:fn=>{cleanup=fn();}};
 createControls(React).TooltipHost({rootRef:{current:root}});
 root.listeners.pointerover({target:icon,type:'pointerover'});t.mock.timers.tick(320);assert(el.open);
 root.listeners.pointerout({target:icon,relatedTarget:outside});t.mock.timers.tick(100);el.hover=true;el.listeners.pointerenter();t.mock.timers.tick(500);assert(el.open);
 el.hover=false;el.listeners.pointerleave({target:el,relatedTarget:outside});t.mock.timers.tick(100);root.listeners.pointerover({target:icon,type:'pointerover'});t.mock.timers.tick(500);assert(el.open);
 root.listeners.pointerout({target:icon,relatedTarget:outside});t.mock.timers.tick(301);assert.equal(el.open,false);
 root.listeners.pointerover({target:icon,type:'pointerover',clientX:110,clientY:110});t.mock.timers.tick(320);
 for(const x of [100,101,199,200]){
  el.listeners.pointerleave({target:el,relatedTarget:outside,clientX:x,clientY:110});
  document.listeners.pointermove({clientX:x,clientY:110});document.listeners.scroll({target:outside});document.listeners.scroll({target:document});
  t.mock.timers.tick(500);assert(el.open, 'inside tooltip edge must remain visible');
 }
 document.listeners.pointermove({clientX:300,clientY:300});t.mock.timers.tick(301);assert.equal(el.open,false);
});

test('an old scheduler read cannot undo a confirmed switch save and unavailable protection remains switchable off',async t=>{
 const {createSettingsControls}=await import('../lib/shared/client/settings-controls.js');
 t.mock.timers.enable({apis:['setTimeout']});const f=controlHarness();let effect,cleanup,pendingRead,reads=0;
 f.React.useEffect=fn=>{effect ||=fn;};
 const response=enabled=>({ok:true,json:async()=>({ok:true,enabled,available:false,rate:'offpeak',sessions:[]})});
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(options.method==='POST')return response(false);
  if(++reads===1)return response(true);
  return new Promise(resolve=>{pendingRead=resolve;});
 });
 const settle=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
 const {SchedulerSettings}=createSettingsControls({...f.React,React:f.React,h:f.React.createElement,ASSET_BASE:'/fixture',t:s=>s,I18N:{number:String,date:()=>''},controls:{}});
 f.render(SchedulerSettings,{});cleanup=effect();t.after(()=>cleanup());await settle();
 let view=f.render(SchedulerSettings,{});let toggle=controlFind(view,n=>n.props.role==='switch');assert.equal(toggle.props.disabled,false);assert.equal(toggle.props.checked,true);
 t.mock.timers.tick(5000);await settle();assert(pendingRead);
 await toggle.props.onChange({target:{checked:false}});pendingRead(response(true));await settle();
 view=f.render(SchedulerSettings,{});toggle=controlFind(view,n=>n.props.role==='switch');assert.equal(toggle.props.checked,false);
});

test('numeric fields clamp percentages in the visible draft and reject text, exponents and integer fractions',async()=>{
 const {createControls}=await import('../lib/shared/panel-controls.js');const f=controlHarness(),{NumberField}=createControls(f.React);let value=25;const writes=[];
 const render=()=>f.render(NumberField,{label:'概率',value,min:0,max:100,step:1,integer:true,onChange:n=>{value=n;writes.push(n);}});
 let view=render(),input=controlFind(view,n=>n.type==='input');input.props.onChange({currentTarget:{value:'999'}});
 view=render();input=controlFind(view,n=>n.type==='input');assert.equal(value,100);assert.equal(input.props.value,'100');
 for(const raw of ['text','1e3','10%','3.5','Infinity']){input.props.onChange({currentTarget:{value:raw}});view=render();input=controlFind(view,n=>n.type==='input');assert.equal(value,100);assert.equal(input.props.value,'100');}
 input.props.onChange({currentTarget:{value:'-2'}});assert.equal(value,0);assert(writes.every(n=>Number.isInteger(n)&&n>=0&&n<=100));
});

test('money fields permit incomplete decimal editing but save only cents and restore empty drafts',async()=>{
 const {createControls}=await import('../lib/shared/panel-controls.js');const f=controlHarness(),{NumberField}=createControls(f.React);let value=.1;const writes=[];
 const render=()=>f.render(NumberField,{label:'额度',value,min:.01,max:100,step:.01,onChange:n=>{value=n;writes.push(n);}});
 let input=controlFind(render(),n=>n.type==='input');input.props.onChange({currentTarget:{value:'0'}});input=controlFind(render(),n=>n.type==='input');input.props.onChange({currentTarget:{value:'0.'}});assert.equal(writes.length,0);
 input=controlFind(render(),n=>n.type==='input');input.props.onChange({currentTarget:{value:'0.056'}});assert.equal(value,.06);assert.equal(controlFind(render(),n=>n.type==='input').props.value,'0.06');
 input=controlFind(render(),n=>n.type==='input');input.props.onChange({currentTarget:{value:''}});input=controlFind(render(),n=>n.type==='input');input.props.onBlur({currentTarget:{value:''}});assert.equal(value,.06);assert.equal(controlFind(render(),n=>n.type==='input').props.value,'0.06');
});

test('numeric composition commits full-width digits only after IME completion and disabled controls do not write',async()=>{
 const {createControls}=await import('../lib/shared/panel-controls.js');const f=controlHarness(),{NumberField}=createControls(f.React),writes=[];
 let view=f.render(NumberField,{label:'数量',value:2,min:1,max:20,integer:true,onChange:n=>writes.push(n)}),input=controlFind(view,n=>n.type==='input');
 input.props.onCompositionStart();input.props.onChange({currentTarget:{value:'１２'}});assert.deepEqual(writes,[]);input.props.onCompositionEnd({currentTarget:{value:'１２'}});assert.deepEqual(writes,[12]);
 view=f.render(NumberField,{label:'数量',value:12,min:1,max:20,integer:true,disabled:true,onChange:n=>writes.push(n)});input=controlFind(view,n=>n.type==='input');input.props.onChange({currentTarget:{value:'19'}});assert.deepEqual(writes,[12]);
});
