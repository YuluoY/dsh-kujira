import test from 'node:test';
import assert from 'node:assert/strict';
import {createSessionAccess} from '../lib/host/session-access.js';
import {createUsageReader} from '../lib/host/usage.js';
import {createActivityReader} from '../lib/host/activity.js';
const inspection = id => ({meta:{id},events:[],inheritedEventCount:0});
test('history inspection is shared by task and cost readers without starting an Agent', async () => {
    let reads=0;
    const controller={inspect:async id => {reads++; return inspection(id);}};
    const access=createSessionAccess(() => null, () => controller);
    await Promise.all([access.prepare('past'),access.prepare('past')]);
    assert.equal(reads,1);
    assert.equal(createUsageReader(() => access, () => null)('past').ok,true);
    assert.equal(createActivityReader(() => access).read('past').ok,true);
});
test('live sessions supersede historical cache; expired history is reread and cache is bounded', async () => {
    let time=0, live;
    const controller={inspect:async id => inspection(id)};
    const access=createSessionAccess(() => ({get:() => live}), () => controller,{now:()=>time,ttl:5,limit:2});
    const before=await access.prepare('a'); time=6;
    assert.notEqual(await access.prepare('a'),before);
    await access.prepare('b');await access.prepare('c');assert.equal(access.get('a'),undefined);
    live={id:'live'};assert.equal(await access.prepare('c'),live);assert.equal(access.get('c'),live);
});
test('failed inspection removes stale data; disposal cannot publish a late result', async () => {
    let fail=false,time=0,resolve;
    let controller={inspect:async id=> {if(fail)throw Error('missing');return inspection(id);}};
    const access=createSessionAccess(() => null,()=>controller,{now:()=>time,ttl:5});
    await access.prepare('a');time=10;fail=true;
    assert.equal(await access.prepare('a'),undefined);assert.equal(access.get('a'),undefined);
    controller={inspect:()=>new Promise(done=>{resolve=done;})};
    const pending=access.prepare('b');await Promise.resolve();access.clear();resolve(inspection('b'));
    await pending;assert.equal(access.get('b'),undefined);
});
