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
