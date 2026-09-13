import {performance} from 'node:perf_hooks';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=new URL("..",import.meta.url).pathname;
const load=relative=>import(pathToFileURL(join(root,relative)).href);
const {createActivityReader}=await load('lib/host/activity.js');
const {createInventory}=await load('lib/host/inventory.js');
const {PRICING}=await load('lib/shared/session-cost.js');
const time=Date.parse('2026-09-14T10:00:00+08:00');
const median=values=>+values.sort((a,b)=>a-b)[Math.floor(values.length/2)].toFixed(3);
const sample=fn=>{const start=performance.now();fn();return performance.now()-start;};
const makeEvents=(count,textSize=6000)=>{
 const text='output '.repeat(Math.ceil(textSize/7)).slice(0,textSize);
 const events=[{seq:0,time,type:'turn/start',data:{turn:1}}];
 for(let i=0;i<count;i++)events.push(
  {seq:2*i+1,time:time+i+1,type:'tool/call',data:{turn:1,step:i,callId:'c'+i,name:'bash',arguments:{command:'test'}}},
  {seq:2*i+2,time:time+i+2,type:'tool/result',data:{turn:1,step:i,callId:'c'+i,message:{content:[{type:'tool-result',content:[{type:'text',text}]}]}}});
 return events;
};
const output={environment:{node:process.version,platform:process.platform,arch:process.arch},activity:[],children:[],inventory:[]};
for(const count of [100,1000,5000]){
 let events=makeEvents(count);
 const session={header:{id:'root'},snapshotEvents:()=>events};
 const reader=createActivityReader(()=>({get:()=>session}));
 const coldMs=sample(()=>reader.read('root')),changed=[],cached=[];
 for(let i=0;i<5;i++){
  events=[...events,{seq:events.length,time:time+count+i+3,type:'step/start',data:{turn:1,step:count+i}}];
  changed.push(sample(()=>reader.read('root')));cached.push(sample(()=>reader.read('root')));
 }
 output.activity.push({operations:count,events:events.length,resultCharsPerOp:6000,coldMs:+coldMs.toFixed(3),appendMedianMs:median(changed),unchangedMedianMs:median(cached)});
}
for(const count of [1,10,50,200]){
 const rootEvents=[{seq:0,time,type:'turn/start',data:{turn:1}}];
 const sessions=new Map();
 for(let i=0;i<count;i++){
  const id='child-'+i;rootEvents.push({seq:i+1,time:time+1,type:'subagent/catalog',data:{childId:id,mode:'one-shot',label:id}});
  const events=makeEvents(40);sessions.set(id,{header:{id,origin:'subagent',parentSession:'root'},snapshotEvents:()=>events});
 }
 sessions.set('root',{header:{id:'root'},snapshotEvents:()=>rootEvents});
 const reader=createActivityReader(()=>sessions);let value,body;
 const foldMs=sample(()=>value=reader.read('root'));
 const serializeMs=sample(()=>body=JSON.stringify(value));
 output.children.push({children:count,operationsEach:40,resultCharsEach:6000,responseBytes:Buffer.byteLength(body),foldMs:+foldMs.toFixed(3),serializeMs:+serializeMs.toFixed(3)});
}
const directory=await mkdtemp(join(tmpdir(),'kujira-benchmark-ledger-'));
let wallet;
try {
 const options={directory,now:()=>time,getConfig:()=>PRICING};
 wallet=createInventory(options);await wallet.snapshot();await wallet.configure(true);await wallet.dispose();
 for(const count of [0,1000,10000,50000]) {
  const db=new DatabaseSync(join(directory,'inventory.sqlite'));
  db.exec('BEGIN; DELETE FROM settlements;');
  const insert=db.prepare('INSERT INTO settlements VALUES(?,?,?,?)');
  for(let i=0;i<count;i++)insert.run(Math.floor(i/1000).toString(16).padStart(64,'0'),i.toString(16).padStart(64,'0'),'a'.repeat(64),1000);
  db.exec('COMMIT');db.close();
  wallet=createInventory(options);await wallet.snapshot();
  const durations=[],lags=[];
  for(let i=0;i<7;i++) {
   let peakLag=0,last=performance.now();
   const timer=setInterval(()=>{const current=performance.now();peakLag=Math.max(peakLag,current-last-2);last=current;},2);
   const start=performance.now();await wallet.consume('fish',`benchmark-${count}-${i}-0000000`);durations.push(performance.now()-start);
   await new Promise(resolve=>setTimeout(resolve,3));clearInterval(timer);lags.push(peakLag);
  }
  await wallet.dispose();
  output.inventory.push({ledgerRows:count,databaseBytes:(await stat(join(directory,'inventory.sqlite'))).size,consumeMedianMs:median(durations),maxTimerDelayMs:+Math.max(...lags).toFixed(3)});
 }
} finally {await wallet?.dispose();await rm(directory,{recursive:true,force:true});}
console.log(JSON.stringify(output,null,2));
