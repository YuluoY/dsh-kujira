import test from 'node:test';
import assert from 'node:assert/strict';
import {amountDecimals,amountParts,createAmountTransition} from '../lib/shared/client/rolling-amount.js';
const format=value=>amountParts(value,'en-US','CNY',4);
function clock(){let now=0,serial=0;const jobs=new Map();return {schedule(fn,ms){const id=++serial;jobs.set(id,{fn,at:now+ms});return id;},cancel(id){jobs.delete(id);},advance(ms){now+=ms;for(const [id,job] of [...jobs])if(job.at<=now){jobs.delete(id);job.fn();}},jobs};}
test('precision is bounded and formatting preserves currency and each locale at every setting',()=>{
 assert.deepEqual([undefined,NaN,-3,0,2.8,10].map(amountDecimals),[4,4,0,0,2,6]);
 for(const locale of ['zh-CN','en-US','ko-KR','ru-RU'])for(const currency of ['CNY','USD','KRW','RUB'])for(let places=0;places<=6;places++){
  const part=amountParts(1234.56789,locale,currency,places);
  assert.equal(part.text,new Intl.NumberFormat(locale,{style:'currency',currency,currencyDisplay:'narrowSymbol',minimumFractionDigits:places,maximumFractionDigits:places}).format(1234.56789));
  assert.equal(part.cells.map(c=>c.char).join(''),part.text);assert.equal(new Set(part.cells.map(c=>c.key)).size,part.cells.length);
 }
});
test('digit keys remain aligned at decimal, integer carry and thousands boundaries',()=>{
 const a=format(9.9999),b=format(10),c=format(1000);
 assert.equal(a.cells.find(c=>c.key==='i:0').char,'9');assert.equal(b.cells.find(c=>c.key==='i:0').char,'0');
 assert.equal(b.cells.find(c=>c.key==='i:1').char,'1');assert.equal(c.cells.find(c=>c.key==='i:3').char,'1');
 assert.equal(b.cells.find(c=>c.key==='f:3').char,'0');
});
test('unchanged displayed digits do not animate and a rapid stream keeps only the latest pending amount',()=>{
 const frames=[],time=clock(),control=createAmountTransition(format(1),v=>frames.push(v),time);
 control.update(format(1.000001));assert.equal(frames.length,0);
 control.update(format(1.2));for(let i=3;i<10;i++)control.update(format(1+i/10));
 assert.equal(frames.length,1);assert.equal(frames[0].direction,'up');time.advance(340);
 assert.equal(frames.length,2);assert.equal(frames[1].previous.text,format(1.2).text);assert.equal(frames[1].current.text,format(1.9).text);
 time.advance(340);assert.equal(frames.at(-1).previous,null);assert.equal(time.jobs.size,0);control.dispose();
});
test('decreases roll downward, reduced motion snaps to latest and disposal cancels pending work',()=>{
 const frames=[],time=clock(),control=createAmountTransition(format(2),v=>frames.push(v),time);
 control.update(format(1));assert.equal(frames[0].direction,'down');control.update(format(3));control.update(format(4),false);
 assert.equal(frames.at(-1).previous,null);assert.equal(frames.at(-1).current.value,4);assert.equal(time.jobs.size,0);
 control.update(format(5));control.update(format(6));const count=frames.length;control.dispose();time.advance(1000);assert.equal(frames.length,count);assert.equal(time.jobs.size,0);
});

test('decimal-place control rejects fractions and clamps whole values for decimal-place settings',async()=>{
 const {createControls}=await import('../lib/shared/panel-controls.js');
 let draft,committed=4;
 const React={createElement:(type,props,...children)=>({type,props,children}),useId:()=>'',useRef:()=>({current:null}),useState:fn=>{draft ??= typeof fn==='function'?fn():fn;return[draft,v=>{draft=v;}];},useEffect:()=>{},useLayoutEffect:()=>{}};
 const {NumberField}=createControls(React);
 const render=()=>NumberField({label:'Precision',value:committed,min:0,max:6,integer:true,onChange:v=>{committed=v;}}).children.flatMap(c=>c?.children||[]).find(c=>c?.type==='input');
 render().props.onChange({currentTarget:{value:'4.6'}});assert.equal(committed,4);render().props.onBlur({currentTarget:{value:draft}});assert.equal(draft,'4');
 render().props.onChange({currentTarget:{value:'99'}});render().props.onBlur({currentTarget:{value:draft}});assert.equal(committed,6);assert.equal(draft,'6');
 render().props.onChange({currentTarget:{value:'0'}});render().props.onBlur({currentTarget:{value:draft}});assert.equal(committed,0);
});
