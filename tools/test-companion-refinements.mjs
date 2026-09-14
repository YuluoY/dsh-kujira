import test from 'node:test';
import assert from 'node:assert/strict';
import {AnimationMenu} from '../lib/shared/client/animation-menu.js';
import {useSceneInteractions} from '../lib/shared/client/scene-companion.js';
import {createSearchSelect,isSelectAnchorScroll} from '../lib/shared/client/search-select.js';
import {floatingPosition} from '../lib/shared/panel-controls.js';
import {bubbleGeometry} from '../lib/shared/client/bubble-geometry.js';
import {createPresenceClock} from '../lib/shared/client/presence-clock.js';
import {readFile} from 'node:fs/promises';
const config=JSON.parse(await readFile(new URL('../assets/pet.config.json',import.meta.url),'utf8'));
function harness(){
 const slots=[];let cursor=0;
 const h=(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity).filter(Boolean)});
 const React={useState:value=>{const i=cursor++;if(!(i in slots))slots[i]=value;return[slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},useRef:value=>{const i=cursor++;return slots[i]||=( {current:value});},useMemo:f=>f(),useId:()=> 'test',useEffect(){},useLayoutEffect(){}};
 return {React,h,render:(component,props)=>{cursor=0;return component(props);}};
}
function find(tree,match){if(match(tree))return tree;for(const child of tree?.children||[]){if(typeof child==='object'){const found=find(child,match);if(found)return found;}}}
test('growth playback keeps the panel open through selection, switching, clearing and reopening',()=>{
 const f=harness(),menu=harness(),plays=[];
 const state={panel:'growth',cfgRef:{current:config},busyRef:{current:false},setPanel:()=>assert.fail('manual playback must not close its panel')};
 const props={...f,state,prefs:{},reduced:false,SearchSelect:'select',playScene(){},playMoment:(name,options)=>{plays.push([name,options]);return true;}};
 const view=()=>{const scene=f.render(useSceneInteractions,props);return find(menu.render(AnimationMenu,{...scene.props,React:menu.React}),n=>n.type==='select');};
 assert.equal(view().props.value,'');assert.equal(plays.length,0);
 view().props.onChange('小提琴演奏');assert.equal(view().props.value,'小提琴演奏');assert.equal(state.panel,'growth');
 view().props.onChange('三球抛接');assert.equal(view().props.value,'三球抛接');assert.equal(plays.length,2);
 view().props.onChange('');assert.equal(view().props.value,'');assert.equal(plays.length,2);
 view().props.onChange('小提琴演奏');state.panel=null;assert.equal(f.render(useSceneInteractions,props),null);
 state.panel='growth';assert.equal(view().props.value,'小提琴演奏');assert.equal(plays.length,3);
 assert(plays.every(([,options])=>options.interrupt&&options.repeat));
});
test('animation selection starts empty; only explicit changed values play, while clear, mount and blocked state are inert',()=>{
 const f=harness(),plays=[];const props={...f,config,SearchSelect:'select',value:'',onValueChange:value=>{props.value=value;},playMoment:name=>{plays.push(name);return true;}};
 const view=()=>find(f.render(AnimationMenu,props),n=>n.type==='select');
 assert.equal(view().props.value,'');assert.equal(plays.length,0);
 view().props.onChange('小提琴演奏');assert.deepEqual(plays,['小提琴演奏']);assert.equal(view().props.value,'小提琴演奏');
 view().props.onChange('小提琴演奏');view().props.onChange('');assert.equal(plays.length,1);assert.equal(view().props.value,'');
 props.blocked=true;view().props.onChange('三球抛接');assert.equal(plays.length,1);assert.equal(view().props.value,'');
 props.blocked=false;view().props.onChange('not-a-clip');assert.equal(plays.length,1);
});
test('editable select does not commit typing, blur, Tab or Escape, but supports Enter, clear and IME composition',()=>{
 const f=harness(),commits=[];const Component=createSearchSelect(f.React,{h:f.h,t:s=>s,position:floatingPosition});
 const props={label:'clip',value:'',options:[['one','One'],['two','Two']],onChange:v=>{commits.push(v);props.value=v;}};
 const view=()=>f.render(Component,props),input=()=>find(view(),n=>n.type==='input');
 assert.equal(commits.length,0);input().props.onChange({target:{value:'Two'}});assert.equal(commits.length,0);
 input().props.onKeyDown({key:'Enter',isComposing:true});assert.equal(commits.length,0);
 input().props.onKeyDown({key:'Escape',preventDefault(){},stopPropagation(){}});assert.equal(commits.length,0);
 input().props.onChange({target:{value:'Two'}});input().props.onKeyDown({key:'Tab'});assert.equal(commits.length,0);
 input().props.onChange({target:{value:'Two'}});input().props.onKeyDown({key:'Enter',preventDefault(){},stopPropagation(){}});assert.deepEqual(commits,['two']);
 find(view(),n=>n.props?.className==='kj-search-clear').props.onClick();assert.deepEqual(commits,['two','']);
});
test('bubble body and dotted trail stay in bounds at every corner and prefer the open side',()=>{
 for(const w of [280,390,760,1440])for(const h of [260,844,1080])for(const x of [0,w-240])for(const y of [0,h-240]){
  const a={left:x,top:y,right:x+240,bottom:y+240,width:240,height:240};
  for(const thought of [false,true]){const p=bubbleGeometry(a,{width:220,height:100},{w,h},thought);assert(p.left>=12);assert(p.left+p.width<=w-12);assert(p.top>=12);assert(p.top+p.height<=h-12);if(thought){for(const dot of [p.large,p.small]){assert(p.left+dot.x>=12);assert(p.left+dot.x+dot.size<=w-12);assert(p.top+dot.y>=12);assert(p.top+dot.y+dot.size<=h-12);}}}
 }
 const p=bubbleGeometry({left:900,right:1160,top:500,bottom:760,width:260,height:260},{width:200,height:100},{w:1200,h:800},true);assert.equal(p.side,'left');assert(p.top+100<550);
});
test('turning off hover visibility can immediately expire its bubble without losing future automatic alerts',()=>{
 let now=0,value=false;const timers=new Map();let id=0;const clock=createPresenceClock(v=>value=v,{now:()=>now,schedule:fn=>{timers.set(++id,fn);return id;},cancel:id=>timers.delete(id)});
 clock.show(5000);assert(value);clock.hide();assert(!value);assert.equal(timers.size,0);clock.show(5000);assert(value);now=6000;clock.sync();assert(!value);clock.dispose();
});

 test('an already-focused input reopens after Escape and clear, and pointer selection commits exactly once',()=>{
 const f=harness(),commits=[];const Component=createSearchSelect(f.React,{h:f.h,t:s=>s,position:floatingPosition});
 const props={label:'clip',value:'',options:[['one','One'],['two','Two']],onChange:v=>{commits.push(v);props.value=v;}};
 const view=()=>f.render(Component,props),input=()=>find(view(),n=>n.type==='input');
 input().props.onFocus();assert.equal(input().props['aria-expanded'],true);
 input().props.onKeyDown({key:'Escape',preventDefault(){},stopPropagation(){}});
 assert.equal(input().props['aria-expanded'],false);
 input().props.onClick();assert.equal(input().props['aria-expanded'],true);
 const option=find(view(),n=>n.props?.role==='option'&&n.children.includes('Two') || n.props?.role==='option'&&n.children.some(c=>c?.children?.includes('Two')));
 option.props.onPointerDown({preventDefault(){}});assert.equal(commits.length,0);
 option.props.onClick();assert.deepEqual(commits,['two']);
 find(view(),n=>n.props?.className==='kj-search-clear').props.onClick();assert.deepEqual(commits,['two','']);
 input().props.onClick();assert.equal(input().props['aria-expanded'],true);
 });
 test('rejected playback does not consume selection and the same animation can be retried',()=>{
 const f=harness();let accept=false,calls=0;const props={...f,config,SearchSelect:'select',value:'',onValueChange:value=>{props.value=value;},playMoment:(_name,options)=>{assert.equal(options.interrupt,true);calls++;return accept;}};
 const view=()=>find(f.render(AnimationMenu,props),n=>n.type==='select');
 view().props.onChange('小提琴演奏');assert.equal(props.value,'');assert(view().props.error);
 accept=true;view().props.onChange('小提琴演奏');assert.equal(props.value,'小提琴演奏');assert.equal(calls,2);assert.equal(view().props.error,'');
 });

 test('host conversation scrolling is independent of select popup positioning',()=>{
 const anchor={},doc={},chat={contains:()=>false},panel={contains:node=>node===anchor};
 assert.equal(isSelectAnchorScroll(chat,anchor,doc),false);
 assert.equal(isSelectAnchorScroll(panel,anchor,doc),true);
 assert.equal(isSelectAnchorScroll(doc,anchor,doc),true);
 assert.equal(isSelectAnchorScroll(null,anchor,doc),false);
 });

test('thought trail keeps a deliberate head gap and internal spacing without viewport clamping',()=>{
 const anchor={left:500,top:420,right:760,bottom:680,width:260,height:260};
 const p=bubbleGeometry(anchor,{width:192,height:162},{w:1400,h:1000},true);
 assert.equal(p.dock,'above');
 const headTop=anchor.top+anchor.height*.17;
 assert(Math.abs(headTop-(p.top+p.small.y+p.small.size)-8)<.001);
 assert.equal(p.small.y-(p.large.y+p.large.size),8);
 assert.equal(p.large.size,28);assert.equal(p.small.size,18);
});

test('progress message bubble prefers the side of the face when there is room',()=>{
 const anchor={left:500,right:760,top:300,bottom:560,width:260,height:260};
 const p=bubbleGeometry(anchor,{width:195,height:60},{w:1400,h:900},false);
 assert.equal(p.top,anchor.top+anchor.height*.44-30);
 assert.equal(p.tailY,30);assert(p.left+p.width<anchor.left+anchor.width*.2);
});

test('radial inventory badge caps visual count while preserving the full accessible count',async()=>{
 const {renderOrbs}=await import('../lib/shared/client/render-orbs.js');const f=harness();
 const props={h:f.h,cfg:{ui:{buttons:true,arc:{},buttonSide:'left'}},orbGeomRef:{current:{slots:[{x:0,y:0}],labels:[],inDelays:[],outDelays:[]}},inventory:{ok:true,stock:{fish:123456}},FEATURE_REGISTRY:[{key:'feed',label:'Fish'}],lastPanelRef:{current:null},feed(){},page:0,t:(s,p)=>s.replace('{count}',String(p?.count)),ICONS:{},visibleCountRef:{current:0},orbOpen:true,ARCRef:{current:null}};
 const result=renderOrbs(props),button=find(result.orbs,n=>n.type==='button');
 assert.equal(find(result.orbs,n=>n.props.className==='kj-stock-badge').children[0],'99+');
 assert(button.props['aria-label'].includes('123456'));assert(button.props['data-tooltip'].includes('123456'));
});
