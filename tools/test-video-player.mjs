import test from 'node:test';
import assert from 'node:assert/strict';
import {createVideoPlayer} from '../lib/shared/client/video-player.js';
import {fishParticles} from '../lib/shared/client/reward-scatter.js';
class Video extends EventTarget {
 dataset={};paused=true;ended=false;duration=10;loop=false;loads=0;
 classList={add(){},remove(){}};
 play(){this.paused=false;return Promise.resolve();}
 pause(){this.paused=true;}
 load(){this.loads++;this.ended=false;}
 emit(type){if(type==='ended'){this.ended=true;this.paused=true;}this.dispatchEvent(new Event(type));}
}
function fixture(quiet = () => false){
 const a=new Video(),b=new Video(),frontRef={current:a},tokenRef={current:0},timers=new Map(),finished=[];let clock=0,serial=0;
 const later=(fn,ms)=>{const id=++serial;timers.set(id,{fn,at:clock+ms});return id;};
 const advance=ms=>{clock+=ms;for(const [id,job] of [...timers])if(job.at<=clock){timers.delete(id);job.fn();}};
 const player=createVideoPlayer({videos:()=>[a,b],frontRef,tokenRef,base:'/assets',quiet,onStart:()=>{},onFinish:failed=>finished.push(failed),later,cancel:id=>timers.delete(id)});
 return {a,b,frontRef,player,finished,timers,advance};
}
test('a full clip outlives 2.2 seconds; outgoing video stays live until crossfade completes',()=>{
 const f=fixture();f.a.play();f.player.play('钱包');f.b.emit('canplay');
 assert.equal(f.frontRef.current,f.b);assert.equal(f.a.paused,false);f.advance(340);assert.equal(f.a.paused,true);
 f.advance(2200);assert.deepEqual(f.finished,[]);assert.equal(f.b.paused,false);
 f.b.emit('ended');assert.deepEqual(f.finished,[false]);f.advance(20000);assert.equal(f.finished.length,1);f.player.dispose();
});
test('rapid replacements cancel stale ready/error handlers and duplicate current clips do not reload',()=>{
 const f=fixture();f.player.play('天气');f.player.play('钱包');f.b.emit('canplay');assert.equal(f.b.dataset.name,'钱包');
 const loads=f.b.loads;assert.equal(f.player.play('钱包'),false);assert.equal(f.b.loads,loads);
 f.player.play('休闲',{loop:true});f.b.emit('ended');assert.deepEqual(f.finished,[]);f.a.emit('canplay');f.player.dispose();
 assert.equal(f.timers.size,0);f.a.emit('error');assert.deepEqual(f.finished,[]);
});
test('loading failure and stalled playback finish once and release timers',()=>{
 const f=fixture();f.player.play('missing');f.advance(10000);f.b.emit('error');f.b.emit('canplay');assert.deepEqual(f.finished,[true]);
 f.player.play('stalled');f.b.emit('canplay');f.advance(15000);f.b.emit('ended');assert.deepEqual(f.finished,[true,true]);f.player.dispose();assert.equal(f.timers.size,0);
});
test('decorative fish stay bounded even for huge rewards and fit inside the mascot',()=>{
 assert.equal(fishParticles(0).length,0);assert.equal(fishParticles(1000000).length,12);
 for(const p of fishParticles(12)){assert(p.x>=9&&p.x<=90);assert(p.delay<800);assert(p.floor>=5&&p.floor<=12);}
});

test('background or focus pauses do not truncate a clip when playback resumes',()=>{
 let quiet=false;const f=fixture(()=>quiet);f.player.play('weather');f.b.currentTime=0;f.b.emit('canplay');
 quiet=true;f.advance(30000);assert.deepEqual(f.finished,[]);
 quiet=false;f.b.currentTime=3;f.advance(5000);assert.deepEqual(f.finished,[]);
 f.b.currentTime=9;f.advance(5000);assert.deepEqual(f.finished,[]);
 f.b.emit('ended');assert.deepEqual(f.finished,[false]);f.player.dispose();assert.equal(f.timers.size,0);
});
