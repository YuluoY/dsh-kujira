import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { compareVersions, installCommand, runCommand } from '../lib/host/harness-install.js';
import { createHarnessUpdater, updateTarget } from '../lib/host/harness-update.js';
import { handleHarnessUpdate, localUpdateRequest } from '../lib/host/harness-update-route.js';
import { renderHarnessUpdate } from '../lib/shared/client/harness-update.js';
import { loadLocale, configure } from '../lib/shared/i18n.js';

const tags={latest:'0.1.5-rc.2',alpha:'0.1.6-alpha.2'};
const installation={current:'0.1.6-alpha.1',installed:'0.1.6-alpha.1',supported:true,manager:'pnpm',path:'/test/global/node_modules/@deepseek-ai/dsh',command:{file:process.execPath,args:['/test/pnpm.cjs']}};
const metadata={name:'@deepseek-ai/dsh',version:tags.alpha,dist:{tarball:'https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.1.6-alpha.2.tgz',integrity:'sha512-test'}};
async function fixture(t, extra={}) {
  const directory=await mkdtemp(join(tmpdir(),'kujira-updater-'));
  let clock=1000000000,calls=0,runs=0,active=0;
  const options={directory,lockDirectory:directory,now:()=>clock,detect:async()=>({...installation}),verify:async()=>tags.alpha,activeTasks:()=>active,
    fetch:async (url,init)=>{calls++;assert.equal(init.headers.Accept,"application/json");return new Response(JSON.stringify(url.endsWith('dist-tags')?tags:metadata));},run:async()=>{runs++;},...extra};
  const service=createHarnessUpdater(options);
  t.after(async()=>{service.dispose();await service.settled();await rm(directory,{recursive:true,force:true});});
  await service.ready;
  return {service,options,directory,calls:()=>calls,runs:()=>runs,advance:n=>clock+=n,active:n=>active=n};
}

test('semantic versions order numeric prereleases and follow channels without accidental downgrade',()=>{
  for(const [a,b] of [['0.1.6-alpha.10','0.1.6-alpha.2'],['1.0.0','1.0.0-rc.9'],['1.0.0-rc.1','1.0.0-alpha.99'],['0.2.0-alpha.1','0.1.99']])assert(compareVersions(a,b)>0);
  assert.equal(compareVersions('1.0.0-alpha.1','1.0.0-alpha.1'),0);
  assert.equal(updateTarget(tags,'auto','0.1.6-alpha.1'),tags.alpha);
  assert.equal(updateTarget(tags,'latest','0.1.6-alpha.1'),tags.latest);
  assert.equal(updateTarget({latest:'1.0.0',alpha:'0.9.0-alpha.1'},'alpha','0.9.0-alpha.1'),'1.0.0');
  for(const version of ['latest','1.0.0;touch /tmp/pwn','1.0.0$(whoami)','--help',null])assert.throws(()=>compareVersions(version,'1.0.0'));
});
test('commands pin the official package, preserve package manager and never use shell arguments',()=>{
  const pnpm=installCommand(installation,tags.alpha);
  assert.equal(pnpm.file,process.execPath);assert.deepEqual(pnpm.args.slice(0,4),['/test/pnpm.cjs','add','--global','@deepseek-ai/dsh@'+tags.alpha]);
  assert(pnpm.args.includes('--registry=https://registry.npmjs.org'));
  const npm=installCommand({...installation,manager:'npm'},tags.alpha);
  assert(npm.args.includes('--engine-strict'));assert(npm.args.includes('install'));
  assert.throws(()=>installCommand({...installation,supported:false},tags.alpha));
  assert.throws(()=>installCommand(installation,'1.0.0;bad'));
});
test('daily checks coalesce, persist and never install; disabled auto-check still allows manual check',async t=>{
  const f=await fixture(t);
  await Promise.all([f.service.check(),f.service.check(),f.service.check()]);
  assert.equal(f.calls(),1);assert.equal(f.runs(),0);assert.equal(f.service.status().available,true);
  await f.service.check({manual:true});assert.equal(f.calls(),1);
  await f.service.configure({automatic:false,channel:'latest'});assert.equal(f.service.status().available,false);
  f.advance(86400001);await f.service.check();assert.equal(f.calls(),1);
  await f.service.check({manual:true});assert.equal(f.calls(),2);
  const restored=createHarnessUpdater(f.options);await restored.ready;
  assert.equal(restored.status().settings.automatic,false);assert.equal(restored.status().checkedAt,f.service.status().checkedAt);restored.dispose();
  const saved=JSON.parse(await readFile(join(f.directory,'harness-update.json'),'utf8'));assert.equal(saved.settings.channel,'latest');
});
test('network failure retains last known version and retries with backoff',async t=>{
  let fail=false,calls=0;
  const f=await fixture(t,{fetch:async()=>{calls++;if(fail)throw Error('network');return new Response(JSON.stringify(tags));}});
  await f.service.check();f.advance(86400001);fail=true;
  await f.service.check();assert.equal(f.service.status().error,'check-failed');assert.equal(f.service.status().latest,tags.alpha);
  await f.service.check();assert.equal(calls,2);f.advance(3600001);await f.service.check();assert.equal(calls,3);
});
test('explicit install is single-flight, verified and reports restart separately from running version',async t=>{
  let release,runs=0;
  const f=await fixture(t,{run:async command=>{runs++;assert(command.args.includes('@deepseek-ai/dsh@'+tags.alpha));await new Promise(resolve=>release=resolve);}});
  await f.service.check();await f.service.install(tags.alpha);
  while(!release)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.service.status().phase,'installing');await f.service.install(tags.alpha);assert.equal(runs,1);
  release();await f.service.settled();
  assert.equal(f.service.status().installed,tags.alpha);assert.equal(f.service.status().current,installation.current);
  assert.equal(f.service.status().restartRequired,true);assert.equal(f.service.status().available,false);
});
test('active tasks, unknown activity, stale checks, mismatched target and unsupported installs cannot start',async t=>{
  const f=await fixture(t);await f.service.check();
  for(const active of [1,null]){f.active(active);await assert.rejects(f.service.install(tags.alpha));}
  f.active(0);await assert.rejects(f.service.install('99.0.0'));f.advance(86400001);await assert.rejects(f.service.install(tags.alpha));assert.equal(f.runs(),0);
  const unsupported=await fixture(t,{detect:async()=>({...installation,supported:false})});await unsupported.service.check();await assert.rejects(unsupported.service.install(tags.alpha));
});
test('registry identity mismatch and failed verification never claim successful installation',async t=>{
  const f=await fixture(t,{fetch:async url=>new Response(JSON.stringify(url.endsWith('dist-tags')?tags:{...metadata,name:'someone-else'}))});
  await f.service.check();await f.service.install(tags.alpha);await f.service.settled();
  assert.equal(f.runs(),0);assert.equal(f.service.status().error,'registry-invalid');assert.equal(f.service.status().restartRequired,false);
  const g=await fixture(t,{verify:async()=>installation.installed});await g.service.check();await g.service.install(tags.alpha);await g.service.settled();
  assert.equal(g.service.status().error,'verify-failed');assert.equal(g.service.status().restartRequired,false);
});
test('install failures are retryable and concurrent services respect the installation lock',async t=>{
  let fail=true,release;
  const f=await fixture(t,{run:async()=>{if(fail)throw Error('permissions');await new Promise(resolve=>release=resolve);}});
  await f.service.check();await f.service.install(tags.alpha);await f.service.settled();assert.equal(f.service.status().error,'install-failed');
  fail=false;await f.service.install(tags.alpha);while(!release)await new Promise(resolve=>setImmediate(resolve));
  const second=createHarnessUpdater({...f.options,run:async()=>assert.fail('lock must block this install')});
  await second.ready;await second.install(tags.alpha);await second.settled();assert.equal(second.status().error,'update-locked');second.dispose();
  release();await f.service.settled();assert.equal(f.service.status().restartRequired,true);
});
test('preview and disabled services cannot install; persisted settings are validated',async t=>{
  const preview=await fixture(t,{preview:true});await preview.service.check();assert.equal(preview.service.status().canInstall,false);await assert.rejects(preview.service.install(tags.alpha));assert.equal(preview.runs(),0);
  const disabled=await fixture(t,{disabled:true});await disabled.service.check();assert.equal(disabled.calls(),0);await assert.rejects(disabled.service.install(tags.alpha));
  const f=await fixture(t);
  for(const patch of [{automatic:'true'},{channel:'evil'},{command:'anything'},null])await assert.rejects(f.service.configure(patch));
  assert.equal(f.service.status().settings.automatic,true);
});
test('runner reports process failures and cancels a hanging child without a shell',async()=>{
  assert.equal(await runCommand({file:process.execPath,args:['-e','process.stdout.write("verified")']}),'verified');
  await assert.rejects(runCommand({file:process.execPath,args:['-e','process.exit(4)']}),/install-failed/);
  await assert.rejects(runCommand({file:process.execPath,args:['-e','setInterval(()=>{},1000)']},{timeout:20}),/update-timeout/);
});
const request=(body,headers={},remoteAddress='127.0.0.1')=>Object.assign(Readable.from([JSON.stringify(body)]),{method:'POST',headers:{host:'127.0.0.1:3080','x-kujira-update':'1',...headers},socket:{remoteAddress}});
const response=()=>({writeHead(code){this.code=code;},end(body){this.body=JSON.parse(body);}});
test('update route rejects remote requests, cross-origin writes and arbitrary action payloads',async()=>{
  let installed=0;const updater={ready:Promise.resolve(),status:()=>({ok:true}),install:async()=>{installed++;return {ok:true};}};
  for(const req of [request({action:'install',version:tags.alpha},{origin:'https://evil.example'}),request({action:'install',version:tags.alpha},{},'10.0.0.2'),request({action:'install',version:tags.alpha},{host:'evil.example'}),request({action:'install',version:tags.alpha},{'x-kujira-update':undefined})]){
    assert.equal(localUpdateRequest(req),false);const res=response();await handleHarnessUpdate(req,res,updater);assert.equal(res.code,403);
  }
  const invalid=response();await handleHarnessUpdate(request({action:'install',version:tags.alpha,command:'rm'}),invalid,updater);assert.equal(invalid.code,400);assert.equal(installed,0);
  const res=response();await handleHarnessUpdate(request({action:'install',version:tags.alpha},{origin:'http://127.0.0.1:3080'}),res,updater);assert.equal(res.code,200);assert.equal(installed,1);
});
test('update UI exposes exact target, disabled running-task state and restart completion',async()=>{
  await loadLocale('zh-CN');configure('zh-CN');
  const h=(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)});
  const walk=node=>node&&typeof node==='object'?[node,...node.children.flatMap(walk)]:[];
  const base={settings:{automatic:true,channel:'auto'},current:installation.current,available:true,latest:tags.alpha,supported:true,activeTasks:0,canInstall:true,phase:'idle'};
  const render=status=>renderHarnessUpdate({h,controls:{},PanelSelect:'select',fieldLabel:text=>text,update:{status,act(){}}});
  assert(walk(render(base)).some(node=>node.type==='button'&&node.children.includes('安装 '+tags.alpha)&&!node.props.disabled));
  assert(walk(render({...base,activeTasks:1,canInstall:false})).some(node=>node.type==='button'&&node.children.includes('安装 '+tags.alpha)&&node.props.disabled));
  assert(walk(render({...base,restartRequired:true,installed:tags.alpha})).some(node=>node.children.includes('已安装 '+tags.alpha+'，重启 DSH 后生效')));
});

test('new requests wait for installation and cancelled requests never restart',async t=>{
 let release,continued=0;
 const f=await fixture(t,{run:async()=>new Promise(resolve=>release=resolve)});
 await f.service.check();await f.service.install(tags.alpha);
 while(!release)await new Promise(resolve=>setImmediate(resolve));
 const controller=new AbortController();
 const cancelled=f.service.gate({signal:controller.signal},()=>assert.fail('cancelled continuation'));
 const waiting=f.service.gate({signal:new AbortController().signal},()=>{continued++;});
 assert.equal(continued,0);controller.abort(Error('cancelled'));await assert.rejects(cancelled,/cancelled/);
 release();await waiting;assert.equal(continued,1);assert.equal(f.service.status().restartRequired,true);
});

test('published version selection supports explicit rollback before restart and remembers the previous version',async t=>{
 let disk=installation.installed;const commands=[];
 const f=await fixture(t,{fetch:async url=>{
  if(url.endsWith('dist-tags'))return new Response(JSON.stringify(tags));
  if(url.endsWith('%2Fdsh'))return new Response(JSON.stringify({name:'@deepseek-ai/dsh',versions:{[installation.installed]:{},[tags.alpha]:{},'0.1.5-rc.2':{},'0.1.0':{deprecated:'removed'}}}));
  return new Response(JSON.stringify({...metadata,version:decodeURIComponent(url.split('/').at(-1))}));
 },run:async command=>{commands.push(command);disk=command.args.find(arg=>arg.startsWith('@deepseek-ai/dsh@')).split('@').at(-1);},verify:async()=>disk});
 await f.service.check();await f.service.install(tags.alpha);await f.service.settled();
 assert.equal(f.service.status().restartRequired,true);assert.deepEqual(f.service.status().previousVersions,[installation.installed]);
 await f.service.listVersions();assert(!f.service.status().versions.includes('0.1.0'));
 await assert.rejects(f.service.install(installation.installed),/update-not-ready/);
 await assert.rejects(f.service.install('0.1.2',{selected:true}),/update-not-ready/);
 await f.service.install(installation.installed,{selected:true});await f.service.settled();
 assert.equal(disk,installation.installed);assert.equal(commands.length,2);assert.equal(f.service.status().restartRequired,false);
 assert.equal(f.service.status().previousVersions[0],tags.alpha);
 const restored=createHarnessUpdater(f.options);await restored.ready;assert.equal(restored.status().previousVersions[0],tags.alpha);restored.dispose();
});

test('version list failure keeps the existing catalogue and cannot authorize arbitrary package versions',async t=>{
 const f=await fixture(t,{fetch:async()=>new Response(JSON.stringify({name:'not-dsh',versions:{'9.0.0':{}}}))});
 await f.service.listVersions();assert.equal(f.service.status().error,'versions-failed');assert.deepEqual(f.service.status().versions,[]);
 await assert.rejects(f.service.install('9.0.0',{selected:true}));assert.equal(f.runs(),0);
});
