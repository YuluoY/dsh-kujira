import test from 'node:test';
import assert from 'node:assert/strict';
import {AnimationMenu} from '../lib/shared/client/animation-menu.js';
import {createSearchSelect} from '../lib/shared/client/search-select.js';
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
  for(const thought of [false,true]){const p=bubbleGeometry(a,{width:220,height:100},{w,h},thought);assert(p.left>=12);assert(p.left+p.width<=w-12);assert(p.top>=12);assert(p.top+p.height<=h-12);if(thought){assert(p.below?p.top-34>=12:p.top+p.height+34<=h-12);}}
 }
 const p=bubbleGeometry({left:900,right:1160,top:500,bottom:760,width:260,height:260},{width:200,height:100},{w:1200,h:800},true);assert.equal(p.side,'left');assert(p.top+100<550);
});
test('turning off hover visibility can immediately expire its bubble without losing future automatic alerts',()=>{
 let now=0,value=false;const timers=new Map();let id=0;const clock=createPresenceClock(v=>value=v,{now:()=>now,schedule:fn=>{timers.set(++id,fn);return id;},cancel:id=>timers.delete(id)});
 clock.show(5000);assert(value);clock.hide();assert(!value);assert.equal(timers.size,0);clock.show(5000);assert(value);now=6000;clock.sync();assert(!value);clock.dispose();
});
