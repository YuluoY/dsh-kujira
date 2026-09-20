import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rateAt, nextSwitch, costOf } from '../lib/shared/billing.js';
import { PRICING } from '../lib/shared/session-cost.js';
import { holidayCalendar } from '../lib/shared/holidays.js';
import { HOLIDAY_YEARS } from '../lib/shared/holiday-data.js';
import { createHolidayCalendar, normalizeHolidayYear } from '../lib/host/holidays.js';
import { createPeakScheduler } from '../lib/host/scheduler.js';
import { createUsageIndex } from '../lib/host/usage-index.js';

const at = (date) => Date.parse(date + '+08:00');
const current = HOLIDAY_YEARS.find((year) => year.year === 2026);
const future = { year: 2027, papers: ['https://www.gov.cn/example'], days: [
  { date: '2026-12-31', name: 'test new year', isOffDay: true },
  { date: '2027-01-01', name: 'test new year', isOffDay: true },
] };

test('Chinese holidays and weekend makeup work are off-peak in every locale', () => {
  for (const locale of ['zh-CN','en-US','ko-KR','ru-RU']) {
    const config = { ...PRICING, locale };
    assert.equal(rateAt(at('2026-10-01T10:00:00'), config), 'offpeak');
    assert.equal(rateAt(at('2026-10-07T15:00:00'), config), 'offpeak');
    assert.equal(rateAt(at('2026-10-10T10:00:00'), config), 'offpeak');
    assert.equal(rateAt(at('2026-10-08T10:00:00'), config), 'peak');
    assert.equal(rateAt(at('2026-10-08T12:00:00'), config), 'offpeak');
    assert.equal(rateAt(Date.parse('2026-10-01T02:00:00Z'), config), 'offpeak');
  }
  assert.equal(rateAt(at('2026-10-10T10:00:00'), { ...PRICING, workdays: [6] }), 'offpeak');
  const usage = { missTokens: 1000000, hitTokens: 0, outTokens: 0 };
  assert.equal(costOf(usage, 'deepseek-flash', at('2026-10-01T10:00:00'), PRICING).total, 1);
  assert.equal(costOf(usage, 'deepseek-flash', at('2026-10-08T10:00:00'), PRICING).total, 2);
});

test('next switch crosses nine-day Spring Festival and exact holiday boundaries', () => {
  for (const [start, end] of [
    ['2026-02-13T18:00:30', '2026-02-24T09:00:00'],
    ['2026-09-30T18:00:30', '2026-10-08T09:00:00'],
    ['2026-10-08T11:59:59', '2026-10-08T12:00:00'],
    ['2026-10-09T18:00:00', '2026-10-12T09:00:00'],
  ]) assert.equal(nextSwitch(at(start), PRICING).ms, at(end) - at(start));
});

test('next-year notices cover December while placeholders and malformed data are rejected', () => {
  const calendar = holidayCalendar([normalizeHolidayYear(future,2027), current]);
  assert.equal(rateAt(at('2026-12-31T10:00:00'), { ...PRICING, holidayCalendar: calendar }), 'offpeak');
  for (const value of [
    { year: 2027, papers: [], days: [] },
    { ...future, days: [{...future.days[0], date:'2027-02-30'}] },
    { ...future, days: [{...future.days[0], isOffDay:'true'}] },
    { ...future, days: [future.days[0],future.days[0]] },
    { ...future, papers: ['https://example.com/calendar'] },
  ]) assert.throws(() => normalizeHolidayYear(value,2027));
});

test('calendar refresh coalesces, persists and retains valid notices during outages', async (t) => {
  const directory = await mkdtemp(join(tmpdir(),'kujira-holidays-'));
  t.after(() => rm(directory,{recursive:true,force:true}));
  let clock = at('2026-09-20T10:00:00'), calls = 0, offline = false;
  const service = createHolidayCalendar({ directory, now:()=>clock, fetch:async (url,init) => {
    calls++; assert.equal(init.headers,undefined);
    if (offline) throw Error('offline');
    return new Response(JSON.stringify(url.endsWith('/2027.json') ? future : current));
  } });
  t.after(() => service.dispose());
  await Promise.all([service.refresh(),service.refresh(),service.refresh()]);
  assert.equal(calls,2);assert.deepEqual(service.calendar().years,[2025,2026,2027]);
  const first = service.calendar();
  await service.refresh();assert.equal(calls,2);assert.equal(service.calendar(),first);
  assert.equal(JSON.parse(await readFile(join(directory,'holidays.json'),'utf8')).years.length,3);
  offline=true;clock+=86400001;
  await service.refresh();assert.equal(calls,6);assert.equal(service.calendar(),first);
  await service.refresh();assert.equal(calls,6);
  const restored=createHolidayCalendar({directory,now:()=>clock,disabled:false});
  t.after(()=>restored.dispose());await restored.ready;
  assert.equal(restored.calendar().days['2026-12-31'],true);
});

test('empty future response never erases a published calendar and disabled mode stays offline', async (t) => {
  const directory=await mkdtemp(join(tmpdir(),'kujira-holiday-empty-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  let clock=at('2026-09-20T10:00:00'), empty=false;
  const service=createHolidayCalendar({directory,now:()=>clock,fetch:async url=>new Response(JSON.stringify(
    url.endsWith('/2027.json') ? empty ? {year:2027,papers:[],days:[]} : future : current
  ))});
  t.after(()=>service.dispose());await service.refresh();const previous=service.calendar();
  empty=true;clock+=86400001;await service.refresh();assert.equal(service.calendar(),previous);
  const disabled=createHolidayCalendar({directory,disabled:true,fetch:()=>{throw Error('unexpected network');}});
  t.after(()=>disabled.dispose());await disabled.refresh();assert.equal(disabled.calendar().days['2026-10-01'],true);
});

test('scheduler gates and usage indexes follow updated calendars immediately', async (t) => {
  const directory=await mkdtemp(join(tmpdir(),'kujira-holiday-schedule-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const clock=at('2026-10-01T10:00:00');
  let config={...PRICING,holidayCalendar:{years:[2026],days:{}}};
  const scheduler=createPeakScheduler({directory,now:()=>clock,getConfig:()=>config,available:true});
  t.after(()=>scheduler.dispose());await scheduler.configure(true);
  let resumed=false;
  const held=scheduler.gate({agent:{id:'holiday'},signal:new AbortController().signal},()=>{resumed=true;});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(scheduler.snapshot().rate,'peak');assert.equal(resumed,false);
  const events=[{type:'request/header',data:{header:{config:{provider:'deepseek',model:'deepseek-flash'}}}},
    {seq:1,type:'assistant/message',time:clock,data:{usage:{inputTokens:1000000,outputTokens:0}}}];
  const session={snapshotEvents:()=>events};const index=createUsageIndex();
  assert.equal(index(session,config).rows.get('seq:1').result.total,2);
  config=PRICING;scheduler.tick();await held;
  assert.equal(resumed,true);assert.equal(scheduler.snapshot().rate,'offpeak');
  assert.equal(scheduler.snapshot().nextAt,at('2026-10-08T09:00:00'));
  assert.equal(index(session,config).rows.get('seq:1').result.total,1);
});

test('invalid calendar holds safely and year coverage refreshes across New Year', async (t) => {
  const directory=await mkdtemp(join(tmpdir(),'kujira-holiday-invalid-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  let clock=at('2026-12-31T20:00:00'), config={...PRICING,peakHours:[]};
  const scheduler=createPeakScheduler({directory,now:()=>clock,getConfig:()=>config});
  t.after(()=>scheduler.dispose());await scheduler.ready;
  assert.equal(scheduler.snapshot().calendarYearKnown,true);
  clock=at('2027-01-01T00:00:00');assert.equal(scheduler.snapshot().calendarYearKnown,false);
  config={...PRICING,holidayCalendar:{years:[],days:null}};
  assert.equal(scheduler.snapshot().rate,'unknown');assert.ok(scheduler.snapshot().error);
});
