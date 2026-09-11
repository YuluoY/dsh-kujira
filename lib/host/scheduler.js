import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {rateAt,nextSwitch} from '../shared/billing.js';
import {PRICING} from '../shared/session-cost.js';
/**
 * Hold the original pre-step continuation. Never cancel tools or submit a replacement prompt.
 */
export function createPeakScheduler({directory,now=Date.now,getConfig=()=>PRICING,available=false,preview=false,tickMs=1000}) {
    const file=join(directory,'peak-scheduler.json'),waiting=new Map();
    let enabled=false,disposed=false,error='',serial=Promise.resolve();
    const ready=readFile(file,'utf8').then(text=>{const value=JSON.parse(text);if(typeof value.enabled!=='boolean')throw Error();enabled=value.enabled;}).catch(e=>{if(e.code!=='ENOENT')error='调度设置读取失败，请重新保存';});
    const peak=()=>rateAt(now(),getConfig())==='peak';
    const paused=id=>[...waiting.values()].some(item=>item.id===id);
    const tick=()=>{if(disposed || !available || !enabled || !peak())for(const waiter of [...waiting.values()])waiter.release();};
    const timer=setInterval(tick,tickMs);timer.unref?.();
    const snapshot=()=>({ok:true,enabled,available,preview,rate:rateAt(now(),getConfig()),nextAt:nextSwitch(now(),getConfig()).ms==null?null:now()+nextSwitch(now(),getConfig()).ms,paused:new Set([...waiting.values()].map(item=>item.id)).size,error});
    const configure=value=>{
        const work=serial.then(async()=>{
            await ready;
            if(typeof value!=='boolean')throw Error('invalid-setting');
            if(value && !available)throw Error('scheduler-unavailable');
            await mkdir(directory,{recursive:true});
            const temp=file+'.tmp';await writeFile(temp,JSON.stringify({version:1,enabled:value})+'\n',{mode:0o600});await rename(temp,file);
            enabled=value;error='';tick();return snapshot();
        });serial=work.catch(()=>{});return work;
    };
    async function hold(payload) {
        const signal=payload.signal;
        while(!disposed && available && enabled && peak()) {
            if(signal?.aborted)throw signal.reason || new Error('aborted');
            await new Promise((resolve,reject)=>{
                const token={},id=payload.agent?.session?.id || payload.agent?.session?.header?.id || payload.agent?.id;
                const remove=()=>{waiting.delete(token);signal?.removeEventListener('abort',abort);};
                const abort=()=>{remove();reject(signal.reason || new Error('aborted'));};
                waiting.set(token,{id,release:()=>{remove();resolve();}});signal?.addEventListener('abort',abort,{once:true});
                if(signal?.aborted)abort();
            });
        }
        if(signal?.aborted)throw signal.reason || new Error('aborted');
    }
    async function gate(payload,next) {
        await ready;await hold(payload);
        const decision=await next();
        if(decision?.kind==='reject')return decision;
        await hold(payload);return decision;
    }
    return {ready,snapshot,configure,gate,tick,paused,setAvailable:value=>{available=value;tick();},dispose:()=>{disposed=true;clearInterval(timer);tick();}};
}
