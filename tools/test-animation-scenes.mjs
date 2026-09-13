import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {SCENES,animationNames,scenePool,NO_MIRROR} from '../lib/shared/client/animation-catalog.js';
import {createAnimationDirector} from '../lib/shared/client/animation-director.js';
import {calendarScenes} from '../lib/shared/client/animation-calendar.js';
import {usePointerReaction} from '../lib/shared/client/use-pointer-reaction.js';
import {usePetMotion} from '../lib/shared/client/use-pet-motion.js';
const config=JSON.parse(await readFile(new URL('../assets/pet.config.json',import.meta.url),'utf8'));
const isolated=(key,list)=>({...config,scenes:Object.fromEntries(Object.keys(SCENES).map(k=>[k,k===key?list:[]]))});

test('130 unique local clips cover the pinned upstream set and all runtime references',async()=>{
 const files=(await readdir(new URL('../assets/anim/',import.meta.url))).filter(n=>n.endsWith('.webm'));
 assert.deepEqual(new Set(animationNames(config)),new Set(files.map(n=>n.slice(0,-5))));
 const source=JSON.parse(await readFile(new URL('../assets/animation-sources.json',import.meta.url),'utf8'));
 assert.equal(source.added.length,80);assert.equal(source.added.length+source.existingSameNames.length+Object.keys(source.existingNameMappings).length,106);
 for(const entry of source.added){const bytes=await readFile(new URL('../assets/anim/'+entry.name+'.webm',import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256,entry.name);}
 assert.equal(files.length,130);assert.equal(config.pools.tool,undefined);
});
test('calendar scenes use local dates, lunar festivals and reject leap-month aliases',()=>{
 const date=s=>new Date(s+'T12:00:00');
 for(const [day,festival] of [['2026-02-17','springFestival'],['2026-06-19','dragonBoat'],['2026-09-25','midAutumn'],['2026-10-31','halloween'],['2026-12-25','christmas']])assert.equal(calendarScenes(date(day)).festival,festival,day);
 assert.equal(calendarScenes(date('2025-07-25')).festival,null);
 assert.equal(calendarScenes(date('2026-09-13')).season,'autumn');
 assert.equal(calendarScenes(date('2026-04-05')).festival,null);
});
test('contextual actions use fresh needs and enforce both global and scene cooldowns',()=>{
 let now=1000;const director=createAnimationDirector({now:()=>now,random:()=>0});
 const input={config:isolated('hungry',['hungry']),growth:{satiety:10},date:new Date('2026-09-13T10:00:00')};
 assert.equal(director.next(input).scene,'hungry');now+=90000;assert.equal(director.next(input).scene,'idle');
 now+=510000;assert.equal(director.next(input).scene,'hungry');
 now+=600000;assert.equal(director.next({...input,growth:{satiety:90}}).scene,'idle');
 assert.equal(director.next({...input,prefs:{contextualReactions:false}}).scene,'idle');
});
test('night sleep uses the complete sequence and never mutates the configured pool',()=>{
 const director=createAnimationDirector({random:()=>0});const input={config:isolated('unused',[]),date:new Date('2026-09-13T23:00:00')};
 assert.deepEqual(director.next(input).clips,config.pools.sleep);assert.equal(config.pools.sleep.length,3);
 assert.equal(director.next({...input,date:new Date('2026-09-14T12:00:00')}).scene,'idle');
});
test('weather scenes reject unknown, stale and nonnumeric temperatures',()=>{
 const input={config:isolated('warm',['warm']),date:new Date('2026-09-13T10:00:00')};
 for(const temp of [null,undefined,NaN,'30'])assert.equal(createAnimationDirector({random:()=>0}).next({...input,weather:{ok:true,now:{temp}}}).scene,'idle');
 assert.equal(createAnimationDirector({random:()=>0}).next({...input,weather:{ok:true,now:{temp:32}}}).scene,'warm');
 assert.equal(createAnimationDirector({random:()=>0}).next({...input,weather:{ok:true,stale:true,now:{temp:32}}}).scene,'idle');
});
test('recent clips do not immediately repeat; explicit empty scene overrides remain empty',()=>{
 const director=createAnimationDirector({random:()=>0});const c=isolated('play',['a','b','c']);
 assert.deepEqual([director.scene(c,'play'),director.scene(c,'play'),director.scene(c,'play')],['a','b','c']);
 assert.deepEqual(scenePool({scenes:{play:[]}},'play'),[]);assert.equal(director.scene({scenes:{play:[]}},'play'),null);
 assert(NO_MIRROR.has('写福字'));
});
function environment(t){
 const originals=new Map(['document','setTimeout','clearTimeout'].map(k=>[k,globalThis[k]]));
 const timers=new Map();let id=0;
 globalThis.document=Object.assign(new EventTarget(),{hidden:false});
 globalThis.setTimeout=(fn,ms)=>{timers.set(++id,{fn,ms});return id;};globalThis.clearTimeout=id=>timers.delete(id);
 const cleanups=[];t.after(()=>{cleanups.forEach(f=>f());for(const [key,value]of originals)value===undefined?delete globalThis[key]:globalThis[key]=value;});
 return {timers,cleanups,run(ms){const entry=[...timers].find(([,v])=>v.ms===ms);assert(entry,'missing timer '+ms);timers.delete(entry[0]);entry[1].fn();}};
}
test('pointer greeting needs dwell, cancels on leave and never uses global pointermove polling',t=>{
 const e=environment(t),stage=new EventTarget(),effects=[];let calls=0;
 const props={React:{useRef:v=>({current:v}),useEffect:fn=>effects.push(fn)},ready:true,rootRef:{current:{querySelector:()=>stage}},prefs:{},busyRef:{current:false},dragRef:{current:null},playScene:()=>{calls++;return true;}};
 usePointerReaction(props);const dispose=effects[0]();stage.dispatchEvent(new Event('pointerenter'));stage.dispatchEvent(new Event('pointerleave'));assert.equal(e.timers.size,0);
 stage.dispatchEvent(new Event('pointerenter'));props.busyRef.current=true;e.run(900);assert.equal(calls,0);
 props.busyRef.current=false;stage.dispatchEvent(new Event('pointerenter'));e.run(900);assert.equal(calls,1);
 stage.dispatchEvent(new Event('pointerenter'));assert.equal(e.timers.size,0);dispose();assert.equal(e.timers.size,0);
});
class Video extends EventTarget{
 dataset={};paused=true;ended=false;duration=10;currentTime=0;classList={add(){},remove(){}};
 play(){this.paused=false;return Promise.resolve();}pause(){this.paused=true;}
 load(){this.ended=false;this.dispatchEvent(new Event('canplay'));}
}
function motionFixture(t){
 const env=environment(t),effects=[],a=new Video(),b=new Video();let stage='idle';
 const ref=current=>({current});const props={useCallback:f=>f,useRef:ref,useEffect:f=>effects.push(f),aRef:ref(a),bRef:ref(b),frontRef:ref(a),tokenRef:ref(0),ASSET_BASE:'/test',quietRef:ref(false),currentRef:ref(''),cfgRef:ref(structuredClone(config)),setLabel(){},applyVisual(){},timerRef:ref(0),setBubble(){},prefs:{},prefsRef:ref({playful:true,contextualReactions:true}),bubbleTimerRef:ref(0),busyRef:ref(false),pick:list=>list?.[0],IDLE:'idle',stateRef:ref('idle'),taskRuntime:{animationState:()=>stage},dragRef:ref(null),ready:true};
 const motion=usePetMotion(props);const cleanup=effects.map(f=>f());env.cleanups.push(()=>cleanup.forEach(f=>f?.()));
 return {...env,props,motion,setStage:s=>{stage=s;}};
}
test('dragging wins over state polling and urgent tasks reject decorative playback',t=>{
 const f=motionFixture(t);f.props.dragRef.current={moved:true};f.motion.play(config.dragAnim,{loop:true});
 f.setStage('working');f.run(config.state.pollMs);assert.equal(f.props.currentRef.current,config.dragAnim);assert.equal(f.props.stateRef.current,'working');
 assert.equal(f.motion.playMoment('小提琴演奏'),false);f.props.dragRef.current=null;f.setStage('error');f.run(config.state.pollMs);
 assert.equal(f.props.currentRef.current,'工作状态-垂头叹气冒汗');assert.equal(f.motion.playMoment('小提琴演奏'),false);
});
test('returning to a visible idle page restores its scheduler and no-mirror reaches the video',t=>{
 const f=motionFixture(t);f.motion.play('写福字',{loop:true});assert.equal(f.props.frontRef.current.dataset.noMirror,'true');
 f.timers.clear();document.hidden=true;document.dispatchEvent(new Event('visibilitychange'));
 document.hidden=false;document.dispatchEvent(new Event('visibilitychange'));
 assert([...f.timers.values()].some(v=>v.ms>=config.gapMs[0]&&v.ms<=config.gapMs[1]));
 f.motion.play('待机呼吸休闲');assert.equal(f.props.frontRef.current.dataset.noMirror,'false');
});

 test('explicit animation preview interrupts ambient playback and discards its queued scene',t=>{
 const f=motionFixture(t);
 assert(f.motion.playMoment('小提琴演奏'));
 assert(f.motion.playMoment('三球抛接',{ambient:true}));
 assert.equal(f.props.currentRef.current,'小提琴演奏');
 assert(f.motion.playMoment('下五子棋',{repeat:true,interrupt:true}));
 assert.equal(f.props.currentRef.current,'下五子棋');
 const first=f.props.tokenRef.current;
 assert(f.motion.playMoment('下五子棋',{repeat:true,interrupt:true}));
 assert(f.props.tokenRef.current>first);
 f.props.frontRef.current.dispatchEvent(new Event('ended'));
 assert.notEqual(f.props.currentRef.current,'三球抛接');
 });
