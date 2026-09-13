import {performance} from 'node:perf_hooks';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {usageRecords,PRICING} from '../lib/shared/session-cost.js';
import {createUsageIndex} from '../lib/host/usage-index.js';
import {createPeakScheduler} from '../lib/host/scheduler.js';
const time=Date.parse('2026-09-14T10:00:00+08:00');
const sample=seq=>({type:'assistant/message',seq,time:time+seq,data:{turn:1,step:seq,stream:[],usage:{inputTokens:1000,outputTokens:200,cacheReadTokens:2000}}});
const median=values=>+values.sort((a,b)=>a-b)[Math.floor(values.length/2)].toFixed(4);
const report=[];
for(const count of [100,1000,5000]) {
 let events=[{type:'request/header',data:{header:{config:{provider:'deepseek-official',model:'deepseek-flash'}}}},...Array.from({length:count},(_,i)=>sample(i+1))];
 const session={snapshotEvents:()=>events,inheritedEventCount:0},index=createUsageIndex({mutable:true});index(session);
 const full=[],incremental=[],cached=[];
 for(let i=0;i<20;i++){
  events=[...events,sample(count+i+1)];let start=performance.now();usageRecords(events);full.push(performance.now()-start);
  start=performance.now();index(session);incremental.push(performance.now()-start);
  start=performance.now();index(session);cached.push(performance.now()-start);
 }
 report.push({settlements:count,fullScanMs:median(full),appendMs:median(incremental),unchangedMs:median(cached)});
}
const directory=await mkdtemp(join(tmpdir(),'kujira-gate-benchmark-'));
const gate=createPeakScheduler({directory,available:true,getConfig:()=>PRICING});await gate.ready;
const start=performance.now();for(let i=0;i<10000;i++)await gate.gate({signal:new AbortController().signal},()=>undefined);
const gateMs=(performance.now()-start)/10000;gate.dispose();await rm(directory,{recursive:true,force:true});
console.log(JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,method:'Median of 20 synthetic local accounting runs; excludes network, disk and model generation.',accounting:report,disabledGateMeanMs:+gateMs.toFixed(4)},null,2));
