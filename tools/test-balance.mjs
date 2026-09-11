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
