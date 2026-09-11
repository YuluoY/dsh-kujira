/**
 * Bounded public task facts. Never read reasoning blocks, raw streams or hidden prompts.
 */
export const cleanText = (value, limit = 240) => typeof value === 'string' ? value.replace(/\b(?:sk-[\w-]{12,}|Bearer\s+\S+)/gi,'[redacted]').replaceAll(String.fromCharCode(0),'').trim().slice(0,limit).replace(/[\uD800-\uDBFF]$/,'') : '';
export function publicText(blocks, limit = 240) {
    if (!Array.isArray(blocks)) return '';
    return cleanText(blocks.filter(b=>b?.type==='text').map(b=>b.text || '').join('\n'),limit);
}
const parsed = value => {try {return typeof value==='string'?JSON.parse(value):value || {};}catch{return {};}};
const location = e => ({seq:Number.isSafeInteger(e.seq)?e.seq:null,turn:e.data?.turn ?? null,step:e.data?.step ?? null});
export function operationKind(name, args = {}) {
    if (/question/.test(name)) return 'waiting';
    if (/subagent|delegate|spawn_agent/.test(name)) return 'delegating';
    if (/search|grep|glob|find|fetch/.test(name)) return 'searching';
    if (/read|view/.test(name)) return 'reading';
    if (/write|edit|patch/.test(name)) return 'editing';
    if (/exec|bash|shell|run/.test(name)) return /(?:^|\s)(?:test|pytest|vitest|jest|tsc|lint)|npm test|pnpm test/.test(String(args.command || args.cmd || ''))?'testing':'working';
    return 'working';
}
export const phaseLabel = {idle:'准备好了',paused:'峰价暂停',thinking:'正在梳理任务',reading:'正在阅读资料',searching:'正在检索信息',editing:'正在修改文件',testing:'正在验证结果',delegating:'正在分配子任务',working:'正在执行任务',summarizing:'正在整理结果',waiting:'需要你回应',retrying:'正在重试',done:'本轮已完成',error:'遇到问题',stopped:'本轮已停止'};
export function sessionActivity(events, inherited = 0) {
    let value;
    const reset = e => ({phase:'idle',stage:'idle',label:phaseLabel.idle,title:'',startedAt:null,endedAt:null,tools:0,trail:[],operations:[],todos:[],children:[],artifacts:[],summary:'',...location(e || {})});
    value=reset();
    const calls=new Map(),catalog=new Map(),approvals=new Map(); let currentTurn=null,trailIndex=0;
    const setStage=stage=>{value.stage=stage;value.phase=['waiting','done','error','stopped','idle'].includes(stage)?stage:'running';value.label=phaseLabel[stage];};
    const add=(label,e,kind='event')=>{value.trail.push({id:String(e.seq ?? trailIndex++)+':'+kind,label,time:e.time,kind,...location(e)});value.trail=value.trail.slice(-40);};
    for(const e of events.slice(inherited)) {
        if(!e?.type)continue;
        const d=e.data || {};
        if(e.type==='turn/start') {value=reset(e);currentTurn=d.turn;value.startedAt=e.time;calls.clear();approvals.clear();setStage('thinking');}
        if(currentTurn!=null && d.turn!=null && d.turn!==currentTurn)continue;
        if(e.type==='user/message' && (!d.source || ['human','user'].includes(d.source.kind))) {
            const title=publicText(d.content,600);if(title){value.title=title;value.titleTruncated=publicText(d.content,601).length>600;}
        }
        if(e.type==='todo/write' && Array.isArray(d.todos)) {
            value.todos=d.todos.filter(t=>t && ['pending','in_progress','completed','cancelled'].includes(t.status)).slice(0,50).map(t=>({label:cleanText(t.content || t.text,200),status:t.status}));
            value.tasks={total:value.todos.length,completed:value.todos.filter(t=>t.status==='completed').length};
        }
        if(e.type==='tool/call') {
            const args=parsed(d.arguments),name=cleanText(d.name || d.tool,80),id=String(d.callId || 'seq-'+(e.seq ?? value.tools));
            if(calls.has(id))continue;
            const stage=operationKind(name,args),path=cleanText(args.path || args.file_path || args.filePath,500);
            const op={id,name,label:phaseLabel[stage],stage,path,status:'running',time:e.time,endedAt:null,result:'',...location(e)};
            if(/subagent|delegate/.test(name))op.description=cleanText(args.description,160);
            if(stage==='waiting')op.description=cleanText(args.questions?.[0]?.question || args.questions?.[0]?.header,240);
            calls.set(id,op);value.operations.push(op);value.tools++;setStage(stage);value.currentId=id;add(op.label,e,'operation');
        }
        if(e.type==='tool/result') {
            const block=d.message?.content?.find(b=>b.type==='tool-result');
            const op=calls.get(d.message?.source?.callId || d.callId);
            if(op) {
                op.status=block?.isError || d.error?'error':'done';op.endedAt=e.time;
                op.truncated=publicText(block?.content,6001).length>6000;
                op.result=publicText(block?.content,6000) || (op.status==='error'?'工具执行失败':'工具已完成，未返回文字结果');
                if(op.path && op.status==='done' && ['editing'].includes(op.stage)) {
                    const old=value.artifacts.find(a=>a.path===op.path);
                    if(!old)value.artifacts.push({path:op.path,kind:'file',...location(e)});
                }
            }
            if(!value.endedAt) {const pending=value.operations.find(o=>o.status==='running' && o.stage==='waiting') || value.operations.find(o=>o.status==='running');setStage(approvals.size?'waiting':pending?.stage || 'summarizing');value.currentId=pending?.id || op?.id;}
            add(op?.status==='error'?'工具执行失败，正在处理':'工具已完成',e,'result');
        }
        if(e.type==='assistant/message') {
            const text=publicText(d.message?.content,6000);
            if(text) {value.summary=text;value.summaryTruncated=publicText(d.message?.content,6001).length>6000;value.summaryLocation=location(e);add(cleanText(text,100),e,'message');}
        }
        if(e.type==='approval/asked') {setStage('waiting');value.attention={id:d.id || e.seq,label:cleanText(d.reason,400) || '需要你确认，请查看会话中的请求',...location(e)};approvals.set(value.attention.id,value.attention);add(value.attention.label,e,'attention');}
        if(e.type==='approval/decided') {approvals.delete(d.id);value.attention=[...approvals.values()][0] || null;if(!value.endedAt)setStage(approvals.size?'waiting':'working');}
        if(e.type==='llm/retry-started') {setStage('retrying');add(phaseLabel.retrying,e,'retry');}
        if(e.type==='step/start' && !value.endedAt && !value.operations.some(op=>op.status==='running'))setStage('thinking');
        if(e.type==='compaction/start') {setStage('summarizing');add('正在整理上下文',e);}
        if(e.type==='subagent/catalog' && typeof d.childId==='string' && ['one-shot','continuable'].includes(d.mode)) {const child={id:d.childId,mode:d.mode,label:cleanText(d.label,160),createdAt:d.childCreatedAt,time:e.time};catalog.set(child.id,child);if(!value.children.some(c=>c.id===child.id))value.children.push(child);}
        if(e.type==='turn/end') {
            const kind=d.reason?.kind || d.kind;
            setStage(kind==='completed'?'done':kind==='blocked'?'waiting':['error','max-tokens','timeout'].includes(kind)?'error':'stopped');
            value.endedAt=e.time;value.endReason=kind;value.attention=kind==='blocked'?{label:'任务受阻，需要你处理',...location(e)}:null;
            value.error=cleanText(d.reason?.error?.message,600);
            for(const op of value.operations)if(op.status==='running')op.status='stopped';
            add(value.label,e,'end');
        }
        value.updatedAt=e.time;
    }
    value.catalog=[...catalog.values()].slice(-200);
    value.operations=value.operations.slice(-40);value.artifacts=value.artifacts.slice(-20);
    value.current=calls.get(value.currentId) || null;
    return value;
}
export function animationState(activity, now = Date.now()) {
    if(!activity)return 'idle';
    if(activity.endedAt && activity.stage==='done')return now-activity.endedAt<10000?'success':'idle';
    return ({thinking:'thinking',reading:'thinking',searching:'thinking',working:'working',editing:'working',testing:'working',delegating:'working',summarizing:'result',retrying:'result',paused:'idle',waiting:'waiting',error:'error',stopped:'idle'})[activity.stage] || 'idle';
}
