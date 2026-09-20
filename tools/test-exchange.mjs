import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createExchangeClient, normalizeExchange } from '../lib/host/exchange.js';
import { exchangeAmount, publishExchange, configureCurrency } from '../lib/shared/exchange.js';
import { money, loadLocale, exchangeNote } from '../lib/shared/i18n.js';
const NOW = Date.parse('2026-09-13T12:00:00Z');
const rows = ['USD','KRW','RUB'].map((quote,i)=>({base:'CNY',quote,date:'2026-09-13',rate:[0.14,190,12][i]}));
const response = (value=rows) => new Response(JSON.stringify(value));

test('explicit currencies and cross rates preserve original billing values',()=>{
 const rates=normalizeExchange(rows,NOW), original={total:100,currency:'CNY'};
 for(const [currency,value] of [['CNY',100],['USD',14],['KRW',19000],['RUB',1200]]) {
  const result=exchangeAmount(original.total,original.currency,currency,rates,NOW);
  assert.ok(Math.abs(result.value-value)<1e-9);assert.equal(result.currency,currency);
 }
 assert.ok(Math.abs(exchangeAmount(14,'USD','KRW',rates,NOW).value-19000)<1e-9);
 assert.equal(exchangeAmount(0,'USD','RUB',rates,NOW).value,0);
 assert.ok(Math.abs(exchangeAmount(-100,'CNY','USD',rates,NOW).value+14)<1e-9);
 assert.deepEqual(original,{total:100,currency:'CNY'});
 assert.equal(exchangeAmount(100,'CNY','KRW',rates,NOW).value,19000);
 assert.equal(exchangeAmount(100,'CNY','CNY',rates,NOW).value,100);
});
test('invalid, missing, expired and unsupported rates never relabel an unconverted amount',()=>{
 const rates=normalizeExchange(rows,NOW);
 for(const broken of [null,{ok:false},{...rates,rates:{CNY:1,USD:0}},{...rates,dates:{} }]) {
  assert.deepEqual(exchangeAmount(100,'CNY','USD',broken,NOW),{value:100,currency:'CNY',converted:false,unavailable:true});
 }
 assert.equal(exchangeAmount(100,'CNY','USD',rates,NOW+8*86400000).currency,'CNY');
 assert.equal(exchangeAmount(100,'EUR','USD',rates,NOW).currency,'EUR');
 assert.equal(exchangeAmount(100,'CNY','USD',{...rates,stale:true},NOW).stale,true);
});
test('normalization rejects duplicates, invalid dates, wrong bases, oversized and nonpositive rates',()=>{
 for(const bad of [[],[rows[0],rows[0],rows[2]],rows.map(r=>({...r,base:'USD'})),rows.map(r=>({...r,rate:-1})),rows.map(r=>({...r,rate:'1'})),rows.map(r=>({...r,date:'2026-02-30'})),rows.map(r=>({...r,date:'2027-01-01'})),rows.map(r=>({...r,date:'2026-08-01'}))])
  assert.throws(()=>normalizeExchange(bad,NOW));
});
test('host coalesces concurrent requests, caches success, backs off failures and bounds stale reuse',async()=>{
 let clock=NOW,calls=0,fail=false;
 const service=createExchangeClient({now:()=>clock,fetch:async(url,init)=>{
  calls++;assert.equal(url,'https://api.frankfurter.dev/v2/rates?base=CNY&quotes=USD,KRW,RUB');
  assert.deepEqual(init.headers,{Accept:'application/json'});
  if(fail)throw Error('offline');return response();
 }});
 const results=await Promise.all(Array.from({length:40},()=>service.query()));
 assert.equal(calls,1);assert(results.every(x=>x.rates.USD===.14));
 await service.query();assert.equal(calls,1);
 clock+=16*60000;fail=true;
 assert.equal((await service.query()).stale,true);assert.equal(calls,2);
 await service.query();assert.equal(calls,2);
 clock+=8*86400000;assert.equal((await service.query()).ok,false);
 service.dispose();assert.equal((await service.query()).reason,'disposed');
});
test('disabled, HTTP failure, oversized body and cancellation fail safely',async()=>{
 const disabled=createExchangeClient({disabled:true,fetch:()=>{throw Error('should not fetch');}});
 assert.equal((await disabled.query()).reason,'disabled');
 for(const res of [new Response('bad',{status:503}),new Response('x'.repeat(17000)),new Response('{bad')]) {
  const s=createExchangeClient({now:()=>NOW,fetch:async()=>res});
  assert.equal((await s.query()).ok,false);s.dispose();
 }
 const s=createExchangeClient({fetch:(_url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('abort'))))});
 const pending=s.query();s.dispose();assert.equal((await pending).ok,false);
});
test('UI formatting labels estimates, currencies and fallback with four complete locales',async()=>{
 await Promise.all(['zh-CN','en-US','ko-KR','ru-RU'].map(loadLocale));
 const today=new Date().toISOString().slice(0,10);
 publishExchange(normalizeExchange(rows.map(r=>({...r,date:today})),Date.now()));
 configureCurrency('USD');
 assert.match(money(100,'CNY','en-US'),/^≈ \$14/);
 configureCurrency('KRW');
 assert.match(money(100,'CNY','ko-KR'),/^≈ ₩19,000/);
 configureCurrency('RUB');
 assert.match(money(100,'CNY','ru-RU'),/1.200,00\s*₽/);
 configureCurrency('USD');
 assert.match(exchangeNote('CNY','en-US'),/Frankfurter/);
 for(const language of ['zh-CN','en-US','ko-KR','ru-RU']) {
  assert.match(money(100,'CNY',language), /14/);
  assert.equal(exchangeAmount(100,'CNY').currency,'USD');
 }
 configureCurrency('original');
 assert.equal(exchangeAmount(100,'CNY').currency,'CNY');
 assert.equal(exchangeNote('CNY','en-US'),'');
 configureCurrency('USD');
 assert.match(money(.0001,'CNY','en-US'),/0.000014/);
 publishExchange(null);
 assert.match(money(100,'CNY','en-US'),/^CNY /);
 assert.match(exchangeNote('CNY','en-US'),/Loading/);
 publishExchange({ok:false});
 assert.match(exchangeNote('CNY','en-US'),/unavailable/);
 configureCurrency('original');
 publishExchange(null);
});

test('browser surfaces share a request and last unmount releases background work',async()=>{
 const { observeExchange } = await import('../lib/shared/client/exchange-rates.js');
 const previousFetch=globalThis.fetch,previousDocument=globalThis.document;
 let calls=0,resolveRequest;const events=new Map();
 globalThis.document={hidden:false,addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name)};
 globalThis.fetch=()=>{calls++;return new Promise(resolve=>{resolveRequest=resolve;});};
 const valuesA=[],valuesB=[];
 let stopA,stopB;
 try {
  stopA=observeExchange(v=>valuesA.push(v));stopB=observeExchange(v=>valuesB.push(v));
  assert.equal(calls,1);assert.equal(events.size,1);
  const today=new Date().toISOString().slice(0,10);
  resolveRequest(response(normalizeExchange(rows.map(r=>({...r,date:today})),Date.now())));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(valuesA.at(-1).rates.USD,.14);assert.equal(valuesB.at(-1).rates.KRW,190);
  globalThis.document.hidden=true;events.get('visibilitychange')();
  globalThis.document.hidden=false;events.get('visibilitychange')();
  assert.equal(calls,1);
  stopA();stopA=null;assert.equal(events.size,1);
  stopB();stopB=null;assert.equal(events.size,0);
 } finally {
  stopA?.();stopB?.();globalThis.fetch=previousFetch;globalThis.document=previousDocument;publishExchange(null);
 }
});
