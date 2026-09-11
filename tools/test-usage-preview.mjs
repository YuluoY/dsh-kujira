import {test} from 'node:test';
import assert from 'node:assert/strict';
import {previewUsage} from './fixtures/usage-preview.mjs';
test('preview provides explicitly marked peak and off-peak examples using the real pricing calculator',()=>{
 const off=previewUsage('offpeak',100),peak=previewUsage('peak',100);
 assert.equal(off.preview,true);assert.equal(peak.preview,true);assert.equal(off.rate,'offpeak');assert.equal(peak.rate,'peak');
 assert.equal(off.requests,3);assert.equal(off.totals.tokensHit,540000);assert.equal(off.totals.tokensMiss,104000);assert.equal(off.totals.tokensOut,40000);
 assert.equal(peak.totals.total,off.totals.total);assert.ok(off.byRate.peak>0 && off.byRate.offpeak>0);assert.ok(Math.abs(off.byRate.peak+off.byRate.offpeak-off.totals.total)<1e-8);assert.equal(off.sessionId,'preview-session');
 assert.ok(off.next.ms>0);assert.equal(off.updatedAt,100);
});
test('the empty preview keeps pricing-period data without fabricating usage',()=>{
 const empty=previewUsage('empty');assert.equal(empty.hasUsage,false);assert.equal(empty.requests,0);assert.equal(empty.totals.total,0);assert.equal(empty.provider,'deepseek');
});
