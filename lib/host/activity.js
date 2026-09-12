import {sessionActivity, publicText} from '../shared/activity.js';
/** Session-scoped activity, with bounded snapshots for children released after completion. */
export function createActivityReader(getSessions) {
    const completed=new Map(), cache=new WeakMap();
    const fold=session=>{
        const events=session.snapshotEvents(), previous=cache.get(session);
        if(previous?.events===events)return previous.value;
        const value=sessionActivity(events,Number(session.inheritedEventCount)||0);
        cache.set(session,{events,value});return value;
    };
    const observe=(session,event)=>{
        if(!session?.header?.parentSession || session.header.origin!=='subagent' || event?.type!=='turn/end' || typeof session.snapshotEvents!=='function')return;
        const id=session.header.id || session.id;
        completed.delete(id);completed.set(id,{parentId:session.header.parentSession,value:fold(session)});
        if(completed.size>200)completed.delete(completed.keys().next().value);
    };
    const settled=info=>{
        const old=completed.get(info?.id);
        if(!old)return;
        // Provider-level failures can follow a completed child turn.
        if(info.stopReason==='error')old.value={...old.value,stage:'error',phase:'error',label:'子任务执行失败'};
        const summary=publicText(info.lastAssistantMessage,6000);if(summary)old.value={...old.value,summary};
    };
    const read=sessionId=>{
        const session=getSessions()?.get(sessionId);
        if(!session || typeof session.snapshotEvents!=='function')return {ok:false,sessionId,message:'会话尚未载入，请稍后重试。'};
        const activity=fold(session);
        const children=(activity.catalog || activity.children).flatMap(child=>{
            const live=getSessions()?.get(child.id);
            const valid=live?.header?.origin==='subagent' && live.header.parentSession===sessionId;
            const saved=completed.get(child.id);
            const value=valid?fold(live):saved?.parentId===sessionId?saved.value:null;
            if(!activity.children.some(c=>c.id===child.id) && (!value?.startedAt || value.startedAt<activity.startedAt))return [];
            return [{...child,stage:value?.stage || 'unknown',summary:value?.summary || '',summaryTruncated:!!value?.summaryTruncated,current:value?.current || null,operations:value?.operations || [],endedAt:value?.endedAt || null,updatedAt:value?.updatedAt || null}];
        });
        return {ok:true,sessionId,activity:{...activity,children},updatedAt:Date.now()};
    };
    return {read,observe,settled};
}
