/**
 * Isolated demo events; they carry no billable usage and never earn supplies.
 */
export function activityPreview(mode='working', now=Date.now()) {
    let seq=0;
    const events=[];
    const add=(type,data={},offset=0)=>events.push({type,seq:seq++,time:now-120000+offset,data:{turn:1,step:1,...data}});
    const text=value=>[{type:'text',text:value}];
    const tool=(callId,name,args,offset)=>add('tool/call',{callId,name,arguments:JSON.stringify(args)},offset);
    const result=(callId,output,offset,isError=false)=>add('tool/result',{message:{source:{kind:'tool',callId},content:[{type:'tool-result',isError,content:text(output)}]}},offset);
    if(mode==='idle')return {events:[],children:[]};
    add('turn/start');add('user/message',{source:{kind:'human'},content:text('完善会话费用展示，并验证不同语言下的交互效果。')},1000);
    add('todo/write',{todos:[{content:'检查费用统计与展示逻辑',status:'completed'},{content:'调整面板与峰谷提示',status:mode==='success'?'completed':'in_progress'},{content:'回归测试与交付',status:mode==='success'?'completed':'pending'}]},2000);
    if(mode==='thinking')return {events,children:[]};
    tool('read-1','read',{path:'lib/shared/usage-ui.js'},5000);result('read-1','已读取费用组件，确认峰谷费用按请求发生时段累计。',10000);
    const children=['统计逻辑检查','界面交互检查','回归验证'].map((label,i)=>{
        const id='preview-child-'+i;
        add('subagent/catalog',{version:0,childId:id,childCreatedAt:now-100000,mode:'one-shot',label},20000+i);
        const done=i<2 || mode==='success';
        return {id,label,events:[{seq:0,type:'turn/start',time:now-100000,data:{turn:1}},{seq:1,type:'user/message',time:now-99000,data:{source:{kind:'human'},content:text(label)}},{seq:2,type:'tool/call',time:now-95000,data:{turn:1,step:1,callId:id+'-tool',name:i===2?'bash':'read',arguments:JSON.stringify(i===2?{command:'npm test'}:{path:'lib/shared/usage-ui.js'})}},...(done?[{seq:3,type:'tool/result',time:now-60000,data:{turn:1,message:{source:{callId:id+'-tool'},content:[{type:'tool-result',content:text('检查完成。')}]}}},{seq:4,type:'assistant/message',time:now-50000,data:{turn:1,message:{content:text(i===0?'峰谷分别累计，合计一致；切换地区不会改变历史金额。':i===1?'底栏仅保留峰谷标记与金额，悬浮提示没有重复内容。':'回归测试全部通过，未发现新增失败。')}}},{seq:5,type:'turn/end',time:now-49000,data:{turn:1,reason:{kind:'completed'}}}]:[])]};
    });
    tool('edit-1','edit',{path:'lib/shared/usage-ui.js'},30000);result('edit-1','已收敛底栏信息：峰谷标记 + 当前会话金额。\n货币沿用接口币种，按所选地区格式化。',50000);
    tool('test-1','bash',{command:'npm test'},60000);
    if(mode==='result' || mode==='success'){result('test-1','8 tests passed\n0 failed\n覆盖：币种格式、地区切换、缓存隔离与错误降级。',95000);add('assistant/message',{message:{content:text('已完成费用展示调整，正在整理验证结果。')}},100000);}
    if(mode==='waiting')add('approval/asked',{},110000);
    if(mode==='ask')tool('question-1','ask_user_question',{questions:[]},110000);
    if(mode==='error'){result('test-1','测试服务暂时不可用，请检查网络后重试。',110000,true);add('turn/end',{reason:{kind:'error',error:{message:'验证未完成，已有修改已保留。'}}},120000);}
    if(mode==='abort')add('turn/end',{reason:{kind:'aborted'}},120000);
    if(mode==='retry')add('llm/retry-started',{},115000);
    if(mode==='success'){add('assistant/message',{message:{content:text('已完成会话费用面板优化。\n\n• 底栏只保留峰谷标记与当前会话金额。\n• 悬浮只显示下次切换时间。\n• 保留原币种，人民币显示 ¥，美元显示 $。\n\n验证：8 项国际化测试通过；峰谷合计校验通过。\n修改文件：lib/shared/usage-ui.js。')}},118000);add('turn/end',{reason:{kind:'completed'}},120000);}
    if(mode==='extreme') {
        add('user/message',{source:{kind:'human'},content:text('检查跨语言、超长文本和大量子任务。\n'+('长任务目标 LongTask목표ДлиннаяЗадача🐳 ').repeat(80))},121000);
        add('todo/write',{todos:Array.from({length:50},(_,i)=>({content:'任务 '+(i+1)+' · '+('LongUnbrokenText_长内容_다국어_Подробности_').repeat(10),status:i<12?'completed':'pending'}))},122000);
        for(let i=3;i<30;i++) {
            const id='preview-child-'+i,label='子任务 '+(i+1)+' · '+('LongName_多语言_이름_Название_').repeat(10);
            add('subagent/catalog',{version:0,childId:id,childCreatedAt:now-100000,mode:'one-shot',label},123000+i);
            children.push({id,label,events:[{type:'turn/start',time:now-10000,data:{turn:1}},{type:'assistant/message',time:now-9000,data:{message:{content:text(('测试结果 Result 결과 Результат🐳\n').repeat(600))}}},{type:'turn/end',time:now-8000,data:{turn:1,reason:{kind:'completed'}}}]});
        }
        result('test-1',('LongOutputWithoutSpaces_长结果_긴결과_Результат🐳').repeat(1000),124000);
    }
    return {events,children};
}
