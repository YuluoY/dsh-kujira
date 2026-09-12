import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveLocale,configure,translate,number,money,date,temperature,serviceRegion,element,parseNumber,officialPricingUrl} from '../lib/shared/i18n.js';
import {messages} from '../lib/shared/messages.js';
import {createWeatherClient} from '../lib/host/weather.js';
const response=body=>({ok:true,json:async()=>body});

test('system locale respects browser order, explicit overrides and unsupported fallback',()=>{
 assert.equal(resolveLocale('system',['ko-KR','en-US']),'ko-KR');
 assert.equal(resolveLocale('system',['fr-FR','ru-RU']),'ru-RU');
 assert.equal(resolveLocale('system',['en-GB']),'en-US');
 assert.equal(resolveLocale('ru-RU',['zh-CN']),'ru-RU');
 assert.equal(resolveLocale('system',['!invalid','fr-FR']),'en-US');
});
test('all catalog messages have four complete translations with identical placeholders',()=>{
 for(const [key,values] of Object.entries(messages)) {
  const expected=[...key.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort();
  for(const language of ['zh','en','ko','ru']) {
   assert.ok(values[language],key+': '+language);
   assert.deepEqual([...values[language].matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort(),expected,key+': '+language);
  }
 }
});
test('money preserves currency, precision and regional separators; dates use region formatting',()=>{
 const amount=1234.56;
 for(const locale of ['zh-CN','en-US','ko-KR','ru-RU']) {
  assert.equal(money(amount,'CNY',locale),new Intl.NumberFormat(locale,{style:'currency',currency:'CNY',currencyDisplay:'narrowSymbol',minimumFractionDigits:2,maximumFractionDigits:6}).format(amount));
  assert.equal(date('2026-09-11',undefined,locale),new Intl.DateTimeFormat(locale,{year:'numeric',month:'short',day:'numeric'}).format(new Date(2026,8,11,12)));
 }
 assert.ok(money(.000123,'USD','en-US').includes('0.000123'));
 assert.match(money(12.5,'CNY','ru-RU'),/12,50/);
 assert.equal(temperature(0,'en-US'),'32 °F');
 assert.equal(temperature(0,'ko-KR'),'0 °C');
 assert.equal(parseNumber('12,5','ru-RU'),12.5);
 assert.equal(parseNumber('1,234.5','en-US'),1234.5);
 assert.ok(Number.isNaN(parseNumber('12oops','ru-RU')));
});
test('translation never alters option values, model IDs, endpoints or input values',()=>{
 configure('en-US');
 const React={createElement:(type,props,...children)=>({type,props,children})};
 const result=element(React,'input',{'aria-label':'城市',value:'城市',name:'city',type:'text',placeholder:'留空自动定位'});
 assert.equal(result.props['aria-label'],'City');assert.equal(result.props.value,'城市');assert.equal(result.props.name,'city');
 assert.equal(translate('{label}说明',{label:'City'}),'About City');
 assert.equal(translate('deepseek-flash'),'deepseek-flash');
 assert.equal(officialPricingUrl('ko-KR'),'https://api-docs.deepseek.com/quick_start/pricing');
});
test('network region follows time zone independently of UI language',()=>{
 assert.equal(serviceRegion('auto','Asia/Shanghai'),'cn');
 assert.equal(serviceRegion('auto','America/New_York'),'global');
 assert.equal(serviceRegion('cn','America/New_York'),'cn');
 assert.equal(serviceRegion('global','Asia/Shanghai'),'global');
});
test('international city search passes locale, normalizes weather and keeps per-language caches',async()=>{
 const urls=[];
 const query=createWeatherClient(()=> 'Seoul',{fetch:async url=>{
  urls.push(url);
  if(url.includes('/search?'))return response({results:[{name:'서울',latitude:37.5,longitude:127}]});
  return response({current:{temperature_2m:25,relative_humidity_2m:60,weather_code:0,wind_speed_10m:5}});
 }});
 const [a,b]=await Promise.all([query(false,{region:'global',locale:'ko-KR'}),query(false,{region:'global',locale:'ko-KR'})]);
 assert.equal(urls.length,2);assert.ok(urls[0].includes('language=ko'));assert.equal(a.source,'Open-Meteo');assert.equal(b.now.text,'晴');assert.equal(a.now.feelsLike,null);
 await query(false,{region:'global',locale:'ko-KR'});assert.equal(urls.length,2);
 await query(false,{region:'global',locale:'en-US'});assert.equal(urls.length,4);assert.ok(urls[2].includes('language=en'));
});
test('international auto-location uses host IP, public endpoints only and no authorization',async()=>{
 const urls=[];
 const query=createWeatherClient(()=>'',{fetch:async(url,init)=>{
  urls.push(url);assert.ok(!init.headers.Authorization);
  if(url==='https://ipwho.is/')return response({success:true,city:'Boston',latitude:42,longitude:-71});
  return response({current:{temperature_2m:18,weather_code:3}});
 }});
 const result=await query(false,{region:'global',locale:'en-US'});
 assert.equal(result.automatic,true);assert.equal(result.locationSource,'host-ip');assert.equal(result.city,'Boston');assert.equal(urls.length,2);
});
test('weather fails over between public providers and never converts missing data into zero',async()=>{
 let calls=0;
 const query=createWeatherClient(()=> 'New York',{fetch:async url=>{
  calls++;
  if(!url.startsWith('https://uapis.cn/'))throw Error('network');
  assert.ok(url.includes('lang=en'));
  return response({city:'New York',weather:'Light rain',temperature:0,humidity:0});
 }});
 const result=await query(true,{region:'global',locale:'ru-RU'});
 assert.equal(result.source,'UApiPro');assert.equal(result.fallback,true);assert.equal(result.now.temp,0);assert.equal(result.now.feelsLike,null);assert.equal(result.now.text,'小雨');assert.equal(calls,2);
});

test('domestic auto-location needs no credentials; a manual city overrides disabled auto-location',async()=>{
 let city='',calls=0;
 const query=createWeatherClient(()=>city,{fetch:async(url,options)=>{
  calls++;assert(url.startsWith('https://uapis.cn/'));assert.equal(options.headers.Authorization,undefined);
  if(city)assert(url.includes('city='+encodeURIComponent(city)));else assert(!url.includes('city='));
  return response({city:city||'Hangzhou',weather:'晴',temperature:'23'});
 }});
 assert.equal((await query(false,{auto:false})).reason,'no-city');assert.equal(calls,0);
 assert.equal((await query(false)).automatic,true);assert.equal(calls,1);
 city='上海';const manual=await query(false,{auto:false});assert.equal(manual.automatic,false);assert.equal(manual.city,'上海');
 city='';await query(false);assert.equal(calls,2);
});

test('weather outages return an explicit failure or stale data for the same location only',async()=>{
 let city='Shanghai',offline=false;
 const query=createWeatherClient(()=>city,{fetch:async()=>{
  if(offline)throw Error('offline');return response({city:'Shanghai',weather:'晴',temperature:23});
 }});
 await query(false);offline=true;
 const stale=await query(true);assert.equal(stale.ok,true);assert.equal(stale.stale,true);assert.equal(stale.now.temp,23);
 city='Seoul';assert.equal((await query(true)).reason,'weather-unavailable');
 city='';assert.equal((await query(true)).reason,'location-unavailable');
});
