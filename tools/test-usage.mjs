import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionCost, normalizeUsage, PRICING } from '../lib/shared/session-cost.js';
import { nextSwitch } from '../lib/shared/billing.js';
import { createUsageReader } from '../lib/host/usage.js';
import { reduceSession, aggregate } from '../lib/shared/state-machine.js';
import { apply } from '../lib/index.js';

const peak = Date.parse('2026-09-11T10:00:00+08:00');
const valley = Date.parse('2026-09-11T12:01:00+08:00');
const header = model => ({ type: 'request/header', data: { header: { config: { provider: 'deepseek', model } } } });
const usage = (seq, time, data={}) => ({ seq, time, type: 'assistant/message', data: { turn: 1, step: seq, usage: { inputTokens: 1e6, outputTokens: 1e6, cacheReadTokens: 1e6 }, ...data } });
const flash = header('deepseek-flash');
test('peak and valley are priced at each individual usage time', () => {
    const r = sessionCost([flash, usage(1,peak), usage(2,valley)],0,PRICING,valley);
    assert.ok(Math.abs(r.totals.total-15.06)<1e-10); assert.equal(r.byRate.peak,10.04); assert.equal(r.byRate.offpeak,5.02);
});
test('same turn/step replacement does not double count', () => {
    const r = sessionCost([flash, usage(1,peak), usage(2,peak,{step:1})]);
    assert.equal(r.requests,1); assert.equal(r.totals.total,10.04);
});
test('a retried request has a distinct accounting record', () => {
    const r=sessionCost([flash,usage(1,peak),{type:'llm/retry-started',data:{turn:1,step:1}},usage(2,peak,{step:1})]);
    assert.equal(r.requests,2); assert.equal(r.totals.total,20.08);
});
test('fork history is excluded while its model selection is retained', () => {
    const r=sessionCost([flash,usage(1,peak),usage(2,valley)],2);
    assert.equal(r.requests,1); assert.equal(r.totals.total,5.02);
});
test('model changes preserve the price of older requests', () => {
    const r=sessionCost([flash,usage(1,valley),header('deepseek-v4-pro'),usage(2,valley)]);
    assert.ok(Math.abs(r.totals.total-23.17)<1e-10);
});
test('unknown provider and historical price absence stay unpriced', () => {
    const r=sessionCost([flash,usage(1,Date.parse('2026-09-01')),header('unknown'),usage(2,valley),{type:'request/context',data:{model:'deepseek-flash',provider:'proxy'}},usage(3,valley)]);
    assert.equal(r.complete,false); assert.equal(r.skipped.length,3); assert.equal(r.totals.total,0); assert.equal(r.totals.tokensOut,3e6);
});
test('stream timestamp wins over later settlement time across a price boundary', () => {
    const e=usage(1,valley,{usage:undefined,stream:[{type:'chunk',time:peak,chunk:{type:'usage',usage:{inputTokens:1e6,outputTokens:0}}}]});
    const r=sessionCost([flash,e]);assert.equal(r.totals.total,2);
});
test('cache writes are included in uncached input exactly once', () => {
    assert.deepEqual(normalizeUsage({inputTokens:10,outputTokens:2,cacheReadTokens:100,cacheWriteTokens:5}),{hitTokens:100,missTokens:15,outTokens:2});
});
test('invalid usage and missing timestamps are never converted to free usage', () => {
    assert.equal(normalizeUsage({inputTokens:-1,outputTokens:4}),null);
    const r=sessionCost([flash,usage(1,undefined)]);assert.equal(r.skipped[0].reason,'missing-time');
});
test('empty sessions show absence of usage rather than fabricated spend', () => {
    const r=sessionCost([flash]); assert.equal(r.hasUsage,false);assert.equal(r.requests,0);
});
test('next price change crosses the weekend and uses the exact minute boundary', () => {
    const now=Date.parse('2026-09-12T10:00:30+08:00');const next=nextSwitch(now,PRICING);
    assert.equal(now+next.ms,Date.parse('2026-09-14T09:00:00+08:00'));assert.equal(next.next,'peak');
});
test('reader isolates two selected sessions and rejects missing sessions', () => {
    const logs={a:[flash,usage(1,peak)],b:[flash,usage(1,valley)]};
    const sessions=new Map(Object.keys(logs).map(id=>[id,{snapshotEvents:()=>logs[id],inheritedEventCount:0}]));
    const read=createUsageReader(()=>sessions,()=>PRICING);
    assert.equal(read('a').totals.total,10.04);assert.equal(read('b').totals.total,5.02);assert.equal(read('missing').ok,false);
});
test('completed sessions expire and stop masking other working sessions', () => {
    const a=reduceSession(null,{type:'turn/end',data:{reason:{kind:'completed'}}},peak);
    const b=reduceSession(null,{type:'tool/call',data:{name:'shell'}},peak+20000);
    assert.equal(aggregate({a,b},peak+20000).state,'working');
});
test('host endpoint selects the explicit session and handles absent selection', async () => {
    let handler;
    const logs = [flash, usage(1, valley)];
    const ctx = {
        sessions: new Map([['selected', { snapshotEvents: () => logs, inheritedEventCount: 0 }]]),
        inject(keys, fn) { fn(this); }, effect(fn) { return fn(); }, on() { return () => {}; },
        webServer: { register(route) { handler = route.handler; return () => {}; } },
        credentials: { async resolve() { return undefined; } }
    };
    apply(ctx, { realtime: { enabled: false } });
    const request = async url => {
        const response = { writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } };
        await handler({ url, method: 'GET' }, response); return response;
    };
    const hit = await request('/dsh-kujira/usage?sessionId=selected');
    assert.equal(hit.body.sessionId, 'selected'); assert.equal(hit.body.totals.total, 5.02);
    assert.equal((await request('/dsh-kujira/usage')).status, 400);
    assert.equal((await request('/dsh-kujira/usage?sessionId=other')).body.ok, false);
});

test('DSH official adapter costs the same usage while unrelated providers remain unpriced', () => {
    const official={type:'request/header',data:{header:{config:{provider:'deepseek-official',model:'deepseek-flash'}}}};
    const cost=sessionCost([official,usage(1,valley)]);
    assert.equal(cost.provider,'deepseek-official');assert.equal(cost.complete,true);assert.equal(cost.totals.total,5.02);
    const proxy={type:'request/header',data:{header:{config:{provider:'deepseek-proxy',model:'deepseek-flash'}}}};
    assert.equal(sessionCost([proxy,usage(1,valley)]).skipped[0].reason,'unsupported-provider');
});

test('DSH v2 settlements on the same step are distinct, even without legacy retry events',()=>{
 const sample={inputTokens:0,outputTokens:125000};
 const failed={type:'assistant/attempt',seq:3,time:valley,data:{turn:1,step:1,stream:[{time:valley,chunk:{type:'usage',usage:sample}}]}};
 const success={type:'assistant/message',seq:4,time:valley,data:{turn:1,step:1,stream:[],usage:sample,message:{source:{provider:'deepseek-official',model:'deepseek-flash'}}}};
 const result=sessionCost([flash,failed,success,success]);
 assert.equal(result.requests,2);assert.equal(result.totals.total,1);
});
test('settled message routing overrides a stale request header and unsafe token counts stay unpriced',()=>{
 const e=usage(2,valley,{stream:[],message:{source:{provider:'other',model:'deepseek-flash'}}});
 assert.equal(sessionCost([flash,e]).skipped[0].reason,'unsupported-provider');
 assert.equal(normalizeUsage({inputTokens:Number.MAX_SAFE_INTEGER+1,outputTokens:2}),null);
 assert.equal(normalizeUsage({inputTokens:1.5,outputTokens:2}),null);
});
