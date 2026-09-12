import test from 'node:test';
import assert from 'node:assert/strict';
import {selectedTab,tabDestination,createTaskTabs} from '../lib/shared/task/tabs.js';
test('tabs retain valid selections and recover from removed or empty categories',()=>{
 const items=[{id:'team'},{id:'plan'}];assert.equal(selectedTab(items,'plan'),'plan');assert.equal(selectedTab(items,'gone'),'team');assert.equal(selectedTab([],'plan'),null);
});
test('horizontal keyboard navigation wraps, supports Home/End and leaves vertical scrolling alone',()=>{
 assert.equal(tabDestination('ArrowLeft',0,4),3);assert.equal(tabDestination('ArrowRight',3,4),0);assert.equal(tabDestination('Home',3,4),0);assert.equal(tabDestination('End',0,4),3);assert.equal(tabDestination('ArrowDown',0,4),null);assert.equal(tabDestination('ArrowRight',0,0),null);
});
test('tabs expose one focusable selection and mount content for only the visible category',()=>{
 const React={createElement:(type,props,...children)=>({type,props,children}),useId:()=>':tabs:',useRef:()=>({current:null}),useState:v=>[v,()=>{}],useEffect:()=>{},useLayoutEffect:()=>{}};
 let selected;const Tabs=createTaskTabs(React);const root=Tabs({items:[{id:'team',label:'Team',count:2,content:'team-body'},{id:'plan',label:'Plan',count:3,content:'plan-body'}],value:'plan',onChange:v=>{selected=v;}});
 const tabs=root.children[0].children.filter(e=>e.props?.role==='tab'),panels=root.children.filter(e=>e.props?.role==='tabpanel');
 assert.deepEqual(tabs.map(t=>t.props.tabIndex),[-1,0]);assert.equal(panels[0].props.hidden,true);assert.equal(panels[0].children[0],null);assert.equal(panels[1].children[0],'plan-body');
 assert.equal(tabs[1].props['aria-controls'],panels[1].props.id);assert.equal(panels[1].props['aria-labelledby'],tabs[1].props.id);
 tabs[0].props.onClick();assert.equal(selected,'team');
});

test('plan tabs display live completed/total while other category counts remain plain',()=>{
 const React={createElement:(type,props,...children)=>({type,props,children}),useId:()=>':tabs:',useRef:()=>({current:null}),useState:v=>[v,()=>{}],useEffect:()=>{},useLayoutEffect:()=>{}};
 const Tabs=createTaskTabs(React);
 const render=completed=>Tabs({items:[{id:'plan',label:'Plan',count:3,progress:{completed,total:3}},{id:'files',label:'Files',count:8}],value:'plan',onChange:()=>{}}).children[0].children.filter(e=>e.props?.role==='tab').map(e=>e.children[1].children[0]);
 assert.deepEqual(render(2),['2/3','8']);assert.deepEqual(render(3),['3/3','8']);
});

test('a single category uses a compact labelled region instead of an inert tab strip',()=>{
 const React={createElement:(type,props,...children)=>({type,props,children}),useId:()=>':tabs:',useRef:()=>({current:null}),useState:v=>[v,()=>{}],useEffect:()=>{},useLayoutEffect:()=>{}};
 const Tabs=createTaskTabs(React),root=Tabs({items:[{id:'plan',label:'Plan',count:3,progress:{completed:2,total:3},content:'plan-body'}],value:'plan',onChange:()=>{}});
 assert.equal(root.children[1].props.role,'region');assert.equal(root.children[0].children[0],'Plan 2/3');
 assert.equal(root.children[1].children[0],'plan-body');assert(!JSON.stringify(root).includes('tablist'));
});

test('truncation tooltips follow actual dimensions, font and ancestor style changes, and dispose observers',async t=>{
 const {createClampedText}=await import('../lib/shared/task/text.js');
 const saved=new Map(['ResizeObserver','MutationObserver','window','requestAnimationFrame','cancelAnimationFrame'].map(k=>[k,globalThis[k]]));
 t.after(()=>{for(const [key,value] of saved)if(value===undefined)delete globalThis[key];else globalThis[key]=value;});
 let resize,mutation,font,frame,layout,clipped=false,disconnected=0;
 globalThis.requestAnimationFrame=fn=>{frame=fn;return 1;};globalThis.cancelAnimationFrame=()=>{frame=null;};
 globalThis.ResizeObserver=class{constructor(fn){resize=fn;}observe(){}disconnect(){disconnected++;}};
 globalThis.MutationObserver=class{constructor(fn){mutation=fn;}observe(){}disconnect(){disconnected++;}};
 globalThis.window={addEventListener(){},removeEventListener(){}};
 const node={clientWidth:200,scrollWidth:200,clientHeight:20,scrollHeight:20,parentElement:{},ownerDocument:{fonts:{addEventListener(_e,fn){font=fn;},removeEventListener(){}}}};
 const React={createElement:(type,props,...children)=>({type,props,children}),useRef:()=>({current:node}),useState:()=>[clipped,v=>{clipped=v;}],useLayoutEffect:fn=>{layout=fn;}};
 const Text=createClampedText(React);let out=Text({text:'short',lines:1,excerpted:true});const dispose=layout();
 out=Text({text:'short',lines:1,excerpted:true});assert.equal(out.props['data-tooltip'],undefined);
 node.scrollWidth=230;font();frame();out=Text({text:'short',lines:1});assert.equal(out.props['data-tooltip'],'short');
 node.clientWidth=260;resize();frame();out=Text({text:'short',lines:1});assert.equal(out.props['data-tooltip'],undefined);
 node.scrollHeight=60;mutation();frame();out=Text({text:'short',lines:2});assert.equal(out.props['data-tooltip'],'short');
 dispose();assert.equal(disconnected,2);
});
