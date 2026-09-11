/** Explicit preview fixtures only. Never emitted to the inventory or real session store. */
import {sessionCost,PRICING} from '../../lib/shared/session-cost.js';
import {sessionActivity} from '../../lib/shared/activity.js';
export function previewUsage(mode='offpeak',now=Date.now()) {
    const previewTime=Date.parse(mode==='peak'?'2026-09-11T10:30:00+08:00':'2026-09-11T20:30:00+08:00');
    const events=[{seq:0,type:'request/header',time:previewTime,data:{header:{config:{provider:'deepseek',model:'deepseek-flash'}}}}];
    if(mode!=='empty') {
        for(const [index,usage] of [{inputTokens:48000,outputTokens:18000,cacheReadTokens:240000},{inputTokens:36000,outputTokens:14000,cacheReadTokens:180000},{inputTokens:20000,outputTokens:8000,cacheReadTokens:120000}].entries())events.push({seq:index+1,type:'assistant/message',time:Date.parse(index===2?'2026-09-11T09:15:00+08:00':index===1?'2026-09-11T08:20:00+08:00':'2026-09-11T08:00:00+08:00'),data:{turn:1,step:index,usage}});
    }
    const activity=sessionActivity([{type:'turn/start',time:now-186000},{type:'tool/call',time:now-140000,data:{name:'read_file'}},{type:'tool/call',time:now-80000,data:{name:'apply_patch'}},{type:'tool/call',time:now-30000,data:{name:'exec'}},{type:'todo/write',time:now-10000,data:{todos:[{status:'completed'},{status:'completed'},{status:'completed'}]}},{type:'turn/end',time:now,data:{reason:{kind:'completed'}}}]);
    return {...sessionCost(events,0,PRICING,previewTime),sessionId:'preview-session',activity,preview:true,previewTime,updatedAt:now};
}
