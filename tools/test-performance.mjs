import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, rm, readFile, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {createActivityReader} from "../lib/host/activity.js";
import {createInventory} from "../lib/host/inventory.js";
import {createSessionAccess} from "../lib/host/session-access.js";
import {createUsageReader} from "../lib/host/usage.js";
import {createSettlementObserver} from "../lib/host/settlement-observer.js";
import {createPoller} from "../lib/shared/client/polling.js";
import {createUsageIndex} from "../lib/host/usage-index.js";
import {sessionCost, costFromRecords, PRICING} from "../lib/shared/session-cost.js";
import {readInventory, seedLegacyInventory} from "./fixtures/inventory-storage.mjs";
import {Writable} from "node:stream";
import {EventEmitter} from "node:events";
import {sendFile} from "../lib/host/http.js";

const turn = {type:"turn/start", seq:0, time:1, data:{turn:1}};
const call = i => ({type:"tool/call", seq:i*2+1, time:i+2, data:{turn:1,callId:"c"+i,name:"bash",arguments:{command:"test"}}});
const result = i => ({type:"tool/result",seq:i*2+2,time:i+3,data:{turn:1,callId:"c"+i,message:{content:[{type:"tool-result",content:[{type:"text",text:"result ".repeat(1000)}]}]}}});
const settle = () => new Promise(resolve => setImmediate(resolve));

test("progress processes the appended suffix without rereading historical result bodies", () => {
  let reads = 0;
  const output = result(0);
  const content = output.data.message.content[0].content;
  Object.defineProperty(output.data.message.content[0], "content", {get() {reads++; return content;}});
  let events = [turn, call(0), output];
  const session = {id:"one",snapshotEvents:() => events};
  const reader = createActivityReader(() => new Map([["one",session]]));
  const first = reader.read("one"), count = reads;
  events = [...events, {type:"step/start",seq:3,time:100,data:{turn:1,step:2}}];
  const next = reader.read("one");
  assert.equal(reads, count);
  assert.notEqual(next, first);
  assert.equal(first.activity.updatedAt, 3);
  assert(reader.detail("one", "c0").text.length > 160);
});

test("200 child summaries stay below 512 KiB and requested details retain their content", () => {
  const events = [turn], sessions = new Map();
  for (let i=0;i<200;i++) {
    const id = "child"+i;
    events.push({type:"subagent/catalog",seq:i+1,time:2,data:{childId:id,mode:"one-shot",label:"测试".repeat(2000)}});
    const childEvents = [turn,...Array.from({length:40},(_,i)=>[call(i),result(i)]).flat(), {type:"assistant/message",seq:82,time:100,data:{message:{content:[{type:"text",text:"完整结果".repeat(1000)}]}}}];
    sessions.set(id,{header:{id,origin:"subagent",parentSession:"parent"},snapshotEvents:() => childEvents});
  }
  sessions.set("parent", {snapshotEvents:() => events});
  const reader = createActivityReader(() => sessions), response = reader.read("parent");
  assert.equal(response.activity.children.length,200);
  assert(Buffer.byteLength(JSON.stringify(response)) < 512*1024);
  assert.equal(response.activity.children[0].operations.length,0);
  assert.equal(reader.detail("parent", "child:child0").text.length,4000);
  assert.equal(reader.detail("parent", "child:unrelated").ok,false);
});

test("worker inventory transactions preserve concurrent writes from two independent processes", async t => {
  const directory = await mkdtemp(join(tmpdir(), "kujira-process-test-"));
  const now = Date.parse("2026-09-14T10:00:00+08:00");
  const wallet = createInventory({directory,now:()=>now});
  t.after(async()=>{await wallet.dispose();await rm(directory,{recursive:true,force:true});});
  await wallet.snapshot();
  const child = new URL("./fixtures/inventory-process.mjs",import.meta.url).pathname;
  await Promise.all(["a","b"].map(prefix=>promisify(execFile)(process.execPath,[child,directory,prefix,"12"])));
  assert(Math.abs((await wallet.snapshot()).credited - 24*.0028)<1e-10);
  const state = readInventory(directory);
  assert.equal(Object.keys(state.settlements).length,24);
});

test("legacy JSON migration is atomic, preserves receipts and retains the original backup", async t => {
  const directory = await mkdtemp(join(tmpdir(), "kujira-migration-test-"));
  let wallet = createInventory({directory});
  t.after(async()=>{await wallet.dispose();await rm(directory,{recursive:true,force:true});});
  await wallet.configure(true);
  await wallet.consume("fish","migration-receipt-001");
  const legacy = readInventory(directory);
  await wallet.dispose();
  await seedLegacyInventory(directory,legacy);
  const original = await readFile(join(directory,"inventory.json"),"utf8");
  wallet = createInventory({directory});
  const result = await wallet.consume("fish","migration-receipt-001");
  assert.equal(result.replayed,true);
  assert.equal(await readFile(join(directory,"inventory.json"),"utf8"),original);
  await wallet.dispose();
  legacy.settlements = {session:{record:{signature:"hash",paid:-1}}};
  await seedLegacyInventory(directory,legacy);
  wallet = createInventory({directory});
  await assert.rejects(wallet.snapshot(),/invalid-settlement/);
  legacy.settlements = {};
  await writeFile(join(directory,"inventory.json"),JSON.stringify(legacy));
  assert.equal((await wallet.snapshot()).free,true);
});

test("one cancelled history subscriber leaves another intact and all-cancel stops the source", async () => {
  let finish, sourceSignal;
  // Use a stable controller, matching the injected DSH service identity.
  const controller = {inspect:(id,signal)=>{sourceSignal=signal;return new Promise(resolve=>{finish=()=>resolve({meta:{id},events:[]});});}};
  const shared = createSessionAccess(()=>null,()=>controller);
  const a=new AbortController(),b=new AbortController();
  const first=shared.prepare("id",{signal:a.signal}),second=shared.prepare("id",{signal:b.signal});
  await settle();a.abort(Error("cancel-a"));await assert.rejects(first,/cancel-a/);
  assert.equal(sourceSignal.aborted,false);finish();assert.equal((await second).id,"id");
  const c=new AbortController();const third=shared.prepare("next",{signal:c.signal});
  await settle();c.abort(Error("cancel-c"));await assert.rejects(third,/cancel-c/);assert.equal(sourceSignal.aborted,true);
  finish();shared.clear();
});

test("history concurrency is global across parent queries and queued cancellation removes work", async () => {
  let running=0, peak=0;
  const controller={inspect:(id,signal)=>new Promise((resolve,reject)=>{
    running++;peak=Math.max(peak,running);
    const timer=setTimeout(()=>{running--;resolve({meta:{id},events:[]});},5);
    signal.addEventListener("abort",()=>{clearTimeout(timer);running--;reject(signal.reason);},{once:true});
  })};
  const access=createSessionAccess(()=>null,()=>controller,{concurrency:2});
  await Promise.all(Array.from({length:10},(_,i)=>access.prepare(String(i))));
  assert.equal(peak,2);access.clear();
});

test("usage deadline returns partial totals before starting further child batches", async () => {
  let calls=0;
  const root={snapshotEvents:()=>Array.from({length:20},(_,i)=>({type:"subagent/catalog",data:{childId:String(i),mode:"one-shot"}}))};
  const access={get:id=>id==="root"?root:null,prepare:(_id,{signal})=>new Promise((resolve,reject)=>{calls++;signal.addEventListener("abort",()=>reject(signal.reason),{once:true});})};
  const read=createUsageReader(()=>access,()=>PRICING,{timeoutMs:20});
  const keepAlive=setTimeout(()=>{},100);
  try {const result=await read.tree("root");assert.equal(result.complete,false);assert.equal(result.children.unavailable,20);assert.equal(calls,4);}
  finally {clearTimeout(keepAlive);}
});

test("polling remains single-flight and aborts in-flight work on disposal", async () => {
  let calls=0, signal, release;
  const surface={hidden:false,addEventListener(){},removeEventListener(){}};
  const poller=createPoller(current=>{calls++;signal=current;return new Promise(resolve=>{release=resolve;});},{interval:2,document:surface});
  await settle();for(let i=0;i<20;i++)poller.refresh();
  assert.equal(calls,1);poller.dispose();assert.equal(signal.aborted,true);release();await settle();assert.equal(calls,1);
});

test("settlement bursts coalesce while persistence is running and disposal drains the final snapshot", async () => {
  let tick, finish, calls=0;
  const observer=createSettlementObserver(()=>{calls++;return calls===1?new Promise(resolve=>{finish=resolve;}):undefined;},{schedule:callback=>{tick=callback;return 1;},cancel:()=>{},concurrency:1});
  observer.enqueue({id:"one"});tick();await settle();
  for(let i=0;i<100;i++)observer.enqueue({id:"one"});
  tick();await settle();assert.equal(calls,1);finish();await observer.dispose();assert.equal(calls,2);
});

test("mutable accounting accumulates replacements without changing previously returned totals", () => {
  const time=Date.parse("2026-09-14T10:00:00+08:00");
  let events=[{type:"request/header",data:{header:{config:{provider:"deepseek",model:"deepseek-flash"}}}}];
  const session={snapshotEvents:()=>events},index=createUsageIndex({mutable:true});
  let previous;
  for(let i=0;i<30;i++) {
    events=[...events,{type:"assistant/message",seq:i+1,time,data:{turn:1,step:i%7,usage:{inputTokens:1000+i,outputTokens:200}}}];
    const value=costFromRecords(index(session),PRICING,time),expected=sessionCost(events,0,PRICING,time);
    assert(Math.abs(value.totals.total-expected.totals.total)<1e-12);
    if(previous)assert.equal(previous.copy,previous.value.totals.total);
    previous={value,copy:value.totals.total};
  }
});

test("video range and conditional requests preserve exact bytes and release response streams", async t => {
  const directory=await mkdtemp(join(tmpdir(),"kujira-http-cache-test-"));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const file=join(directory,"test.webm"),bytes=Buffer.from("0123456789abcdefghijklmnopqrstuvwxyz");
  await writeFile(file,bytes);
  const request=async(headers={},method="GET")=>{
    const chunks=[],req=Object.assign(new EventEmitter(),{method,headers});
    const res=new Writable({write(chunk,_encoding,done){chunks.push(Buffer.from(chunk));done();}});
    res.writeHead=(status,headers)=>{res.status=status;res.headers=headers;};
    const finished=new Promise((resolve,reject)=>{res.once("finish",resolve);res.once("error",reject);});
    assert.equal(await sendFile(req,res,file,".webm","no-cache"),true);
    await finished;
    return {status:res.status,headers:res.headers,body:Buffer.concat(chunks)};
  };
  const range=await request({range:"bytes=2-5"});
  assert.equal(range.status,206);assert.equal(range.body.toString(),"2345");assert.equal(range.headers["content-range"],"bytes 2-5/36");
  const suffix=await request({range:"bytes=-3"});assert.equal(suffix.body.toString(),"xyz");
  const head=await request({range:"bytes=2-5"},"HEAD");assert.equal(head.body.length,0);assert.equal(head.headers["content-length"],"4");
  assert.equal((await request({range:"bytes=100-200"})).status,416);
  const cached=await request({"if-none-match":range.headers.etag});assert.equal(cached.status,304);assert.equal(cached.body.length,0);
});
