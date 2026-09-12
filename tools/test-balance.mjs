import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createBalanceClient} from '../lib/host/balance.js';

const entry = (currency, total, granted, toppedUp) => ({currency,total_balance:total,granted_balance:granted,topped_up_balance:toppedUp});
const ctx = {credentials:{resolve:async()=>({value:'test-only-placeholder'})}};

test('balance preserves every currency independently and reuses the successful cache', async t => {
    let calls=0;
    t.mock.method(globalThis,'fetch',async()=>{
        calls++;
        return {ok:true,json:async()=>({is_available:true,balance_infos:[entry('CNY','110.00','10.00','100.00'),entry('USD','3.125','0','3.125')]})};
    });
    const query=createBalanceClient(ctx), result=await query(false);
    assert.equal(result.ok,true);
    assert.deepEqual(result.balances,[{currency:'¥',rawCurrency:'CNY',total:110,granted:10,toppedUp:100},{currency:'$',rawCurrency:'USD',total:3.125,granted:0,toppedUp:3.125}]);
    assert.equal(result.total,110);
    assert.equal(result.available,true);
    assert.equal((await query(false)).cached,true);
    assert.equal(calls,1);
    await query(true);
    assert.equal(calls,2);
    assert.ok(!JSON.stringify(result).includes('test-only-placeholder'));
});

test('zero/negative balances and unavailable account state remain truthful', async t => {
    t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>({is_available:false,balance_infos:[entry('CNY','-0.25','0','-0.25')]})}));
    const result=await createBalanceClient(ctx)(true);
    assert.equal(result.total,-0.25);
    assert.equal(result.granted,0);
    assert.equal(result.available,false);
});

test('incomplete or malformed data is not converted into a zero balance and does not replace cache', async t => {
    let body={is_available:true,balance_infos:[entry('CNY','20','0','20')]};
    t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>body}));
    const query=createBalanceClient(ctx);
    await query(true);
    for(const entries of [[],[null],[entry('CNY','','0','0')],[entry('CNY','NaN','0','0')],[entry('CNY','5',null,'5')]]) {
        body={is_available:true,balance_infos:entries};
        assert.equal((await query(true)).reason,'bad-data');
        assert.equal((await query(false)).total,20);
    }
    body={balance_infos:[entry('CNY','0','0','0')]};
    assert.equal((await query(true)).available,null);
});

test('missing, blank or failing credentials never make an upstream request', async t => {
    t.mock.method(globalThis,'fetch',async()=>{assert.fail('unexpected request');});
    for (const context of [null,{}, {get credentials(){throw Error('unavailable');}}, {credentials:{resolve:async()=>{throw Error('locked');}}}, {credentials:{resolve:async()=>({value:' '})}}]) {
        const result=await createBalanceClient(context)(false);
        assert.equal(result.reason,'no-key');assert.equal(result.discardPrevious,true);
    }
});

test('credential changes invalidate old balances and concurrent refreshes share a request',async t=>{
    let key='first-test-placeholder',calls=0;
    const context={credentials:{resolve:async()=>({value:key})}};
    t.mock.method(globalThis,'fetch',async(url,options)=>{
        assert.equal(url,'https://api.deepseek.com/user/balance');assert.equal(options.headers.Authorization,'Bearer '+key);calls++;
        return {ok:true,json:async()=>({balance_infos:[entry('CNY',String(calls),'0',String(calls))]})};
    });
    const query=createBalanceClient(context);
    await Promise.all([query(true),query(true),query(false)]);assert.equal(calls,1);
    key='second-test-placeholder';assert.equal((await query(false)).total,2);assert.equal(calls,2);
    key='';assert.equal((await query(false)).reason,'no-key');assert.equal(calls,2);
    key='second-test-placeholder';assert.equal((await query(false)).total,3);
});

test('an older account response cannot overwrite the new account cache',async t=>{
    let key='old-test-placeholder',release,started;
    const began=new Promise(resolve=>{started=resolve;});
    t.mock.method(globalThis,'fetch',async(_url,options)=>{
        if(options.headers.Authorization.includes('old-test')) {started();await new Promise(resolve=>{release=resolve;});}
        return {ok:true,json:async()=>({balance_infos:[entry('CNY',options.headers.Authorization.includes('old-test')?'99':'3','0','3')]})};
    });
    const query=createBalanceClient({credentials:{resolve:async()=>({value:key})}});
    const old=query(true);await began;key='new-test-placeholder';assert.equal((await query(true)).total,3);
    release();assert.equal((await old).reason,'credentials-changed');assert.equal((await query(false)).total,3);
});

test('authentication failure clears stale balances while temporary outages preserve same-account data',async t=>{
    let mode='ok';
    t.mock.method(globalThis,'fetch',async()=>{
        if(mode==='network')throw Error('network');
        if(mode==='timeout')throw new DOMException('timeout','TimeoutError');
        if(mode==='json')return {ok:true,json:async()=>{throw Error('invalid JSON');}};
        return mode==='ok'?{ok:true,json:async()=>({balance_infos:[entry('CNY','5','0','5')]})}:{ok:false,status:401};
    });
    const query=createBalanceClient(ctx);await query(true);
    for (const [modeValue,reason] of [['network','network'],['timeout','timeout'],['json','bad-json']]) {
        mode=modeValue;const result=await query(true);assert.equal(result.reason,reason);assert.equal(result.discardPrevious,false);
    }
    mode='unauthorized';assert.equal((await query(true)).discardPrevious,true);
    assert.equal((await query(false)).reason,'http-401');
    const {finishRefresh}=await import('../lib/shared/panel-controls.js');
    assert.equal(finishRefresh({ok:true,total:5},{ok:false,discardPrevious:true}).total,undefined);
    assert.equal(finishRefresh({ok:true,total:5},{ok:false,message:'network'}).total,5);
});
