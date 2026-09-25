import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDesktopPresence} from '../lib/host/desktop-presence.js';
import {DEFAULTS,normalizeSettings,localOrigin,platformCapabilities,createSettings} from '../desktop/src/settings.js';
import {launchCommand,createDshService,probeDsh,shouldReleaseOwnedService,terminateProcessTree} from '../desktop/src/dsh-service.js';
import {windowPlacement} from '../desktop/src/window-layout.js';
import {createProtocol} from '../desktop/src/protocol.js';
import {boundedText,createConnection} from '../desktop/src/connection.js';

test('handoff requires a ready owner, rejects races and recovers after lease expiry',()=>{
 let now=0;const service=createDesktopPresence({now:()=>now});
 const request=service.update({action:'request',mode:'desktop'});
 assert.equal(service.snapshot().desktopActive,false);
 assert.equal(service.update({action:'claim',owner:'desktop-owner-1234',revision:0}),null);
 assert(service.update({action:'claim',owner:'desktop-owner-1234',revision:request.revision}).desktopActive);
 assert.equal(service.update({action:'claim',owner:'desktop-owner-5678',revision:request.revision}),null);
 const browser=service.update({action:'request',mode:'browser'});
 assert.equal(browser.browserReady,false);assert.equal(browser.desktopActive,true);
 assert.equal(service.update({action:'browser-ready',revision:browser.revision-1}),null);
 assert(service.update({action:'browser-ready',revision:browser.revision}).browserReady);
 now=12001;assert.equal(service.snapshot().desktopActive,false);
 assert.equal(service.update({action:'heartbeat',owner:'desktop-owner-1234'}),null);
 const again=service.update({action:'request',mode:'desktop'});
 assert(service.update({action:'claim',owner:'desktop-owner-5678',revision:again.revision}));
 assert.equal(service.update({action:'release',owner:'desktop-owner-1234'}),null);
});
test('settings reject remote origins, credentials, injection and invalid profiles',()=>{
 for(const value of ['https://example.com','http://127.0.0.1:3080/path','http://user:secret@localhost','file:///tmp/x','http://localhost/?x=1'])assert.throws(()=>localOrigin(value));
 for(const value of ['../web','web && bad','web\n'])assert.throws(()=>normalizeSettings({profile:value}));
 assert.equal(normalizeSettings({power:'invalid',login:'yes'}).power,'balanced');
 assert.equal(normalizeSettings({}).login,false);
 assert.equal(localOrigin('http://[::1]:3080'),'http://[::1]:3080');
});
test('Windows launch accepts spaces but rejects command expansion and uses fixed arguments',()=>{
 const command=launchCommand('C:\\Program Files\\pnpm\\dsh.cmd',DEFAULTS,'win32',{});
 assert.equal(command.verbatim,true);assert(command.args.at(-1).includes('"C:\\Program Files\\pnpm\\dsh.cmd" --profile web --no-open'));
 for(const file of ['C:\\a%X%\\dsh.cmd','C:\\a&whoami\\dsh.cmd','C:\\a"\\dsh.cmd'])assert.throws(()=>launchCommand(file,DEFAULTS,'win32',{}));
 const unix=launchCommand('/home/a b/dsh',DEFAULTS,'linux');assert.equal(unix.file,'/home/a b/dsh');assert.equal(unix.verbatim,false);assert.deepEqual(unix.args.slice(0,3),['--profile','web','--no-open']);
});
test('Wayland capabilities are explicit while XWayland retains desktop positioning',()=>{
 assert.equal(platformCapabilities('darwin',{},'auto').allWorkspaces,true);
 assert.equal(platformCapabilities('win32',{},'auto').position,true);
 assert.equal(platformCapabilities('linux',{WAYLAND_DISPLAY:'wayland-0'},'auto').position,false);
 assert.equal(platformCapabilities('linux',{WAYLAND_DISPLAY:'wayland-0',DISPLAY:':0'},'auto').position,true);
 assert.equal(platformCapabilities('linux',{DISPLAY:':0'},'wayland').alwaysOnTop,false);
});
test('placement survives negative monitor coordinates, small work areas and display removal',()=>{
 for(const area of [{x:-1920,y:0,width:1920,height:1040},{x:0,y:24,width:390,height:720},{x:300,y:-900,width:1440,height:900}])
 for(const pet of [{x:-5000,y:-4000},{x:10000,y:10000},{x:0,y:0}])for(const size of [120,260,360]){
  const p=windowPlacement(area,pet,size);assert(p.bounds.x>=area.x);assert(p.bounds.y>=area.y);
  assert(p.bounds.x+p.bounds.width<=area.x+area.width);assert(p.bounds.y+p.bounds.height<=area.y+area.height);
  assert(p.pet.x>=0);assert(p.pet.y>=0);assert(p.pet.x+size<=p.bounds.width);assert(p.pet.y+size<=p.bounds.height);
 }
});
test('serialized writes retain the latest settings without partial files',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'kujira-settings-'));try{
  const store=await createSettings(join(dir,'desktop.json'));
  await Promise.all([store.save({position:{x:1,y:2}}),store.save({position:{x:3,y:4}})]);
  assert.deepEqual(JSON.parse(await readFile(join(dir,'desktop.json'),'utf8')).position,{x:3,y:4});
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('packaged protocol resolves media locally and denies host modules and cross-origin reads',async()=>{
 const urls=[];const route=createProtocol({runtime:'/runtime',desktopRoot:'/desktop',net:{fetch:async url=>{urls.push(url);return new Response('ok');}},connection:{proxy:async()=>new Response('offline',{status:503})}});
 assert.equal((await route(new Request('kujira://app/dsh-kujira/anim/'+encodeURIComponent('被落叶淹没')+'.webm'))).status,200);
 assert(urls[0].endsWith('/runtime/assets/anim/'+encodeURIComponent('被落叶淹没')+'.webm'));
 assert.equal((await route(new Request('kujira://other/ui/renderer.js'))).status,403);
 assert.equal((await route(new Request('kujira://app/dsh-kujira/host/balance.js'))).status,503);
 assert.equal((await route(new Request('kujira://app/src/main.js'))).status,404);
});
test('bounded data reads cancel oversized streams',async()=>{
 let canceled=false;const response=new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array(1024));},cancel(){canceled=true;}}));
 await assert.rejects(boundedText(response,100));assert(canceled);
});
test('an existing DSH is reused and simultaneous open requests share one operation',async()=>{
 let opens=0,spawns=0;const service=createDshService({getSettings:()=>DEFAULTS,logDirectory:'/unused',openUrl:async()=>{opens++;},fetcher:async()=>Response.json({product:'dsh-kujira',protocol:1,instance:'test'}),spawnProcess:()=>{spawns++;}});
 const a=service.openWeb(),b=service.openWeb();assert.equal(a,b);await a;assert.equal(opens,1);assert.equal(spawns,0);
});
test('unidentified occupied ports are not opened or replaced',async()=>{
 let spawned=false;const fetcher=async()=>new Response('another app');
 assert.equal((await probeDsh(DEFAULTS.dshUrl,fetcher)).online,false);
 const service=createDshService({getSettings:()=>DEFAULTS,logDirectory:'/unused',openUrl:()=>{throw Error('must not open');},fetcher,spawnProcess:()=>{spawned=true;}});
 await assert.rejects(service.openWeb(),/port-occupied/);assert.equal(spawned,false);
});
test('offline desktop never forwards transactional or arbitrary renderer requests',async()=>{
 let reads=0;const connection=createConnection({getSettings:()=>DEFAULTS,onState:()=>{},fetcher:()=>{reads++;throw Error('offline');}});
 const request=new Request('kujira://app/dsh-kujira/inventory',{method:'POST',body:'{}'});
 assert.equal((await connection.proxy(request,'inventory')).status,503);
 assert.equal((await connection.proxy(request,'../api/secrets')).status,404);
 assert.equal(reads,0);await connection.dispose();
});

test('handoff preference revisions prevent stale browser settings overriding later desktop edits',()=>{
 const service=createDesktopPresence();
 const request=service.update({action:'request',mode:'desktop',preferences:{appearance:{size:180}}});
 assert.equal(request.preferencesRevision,request.revision);
 const reactivated=service.update({action:'request',mode:'desktop'});
 assert.notEqual(reactivated.preferencesRevision,reactivated.revision);
 const back=service.update({action:'request',mode:'browser',preferences:{appearance:{size:220}}});
 assert.equal(back.preferencesRevision,back.revision);assert.equal(back.preferences.appearance.size,220);
});

test('legacy installed plugins can open Web but cannot pretend to support desktop handoff',async()=>{
 const fetcher=async url=>url.endsWith('/desktop')?new Response('',{status:404}):Response.json({name:'dsh-kujira',route:'/dsh-kujira'});
 const status=await probeDsh(DEFAULTS.dshUrl,fetcher);assert.equal(status.legacy,true);assert.equal(status.online,false);
 let opened=0;const service=createDshService({getSettings:()=>DEFAULTS,openUrl:()=>{opened++;},fetcher,spawnProcess:()=>{throw Error('must not restart');}});
 await service.openWeb();assert.equal(opened,1);
});

test('on-demand startup launches one detached service without shell or output pipes',async()=>{
 let probes=0,spawned=0,opened=0;
 const fetcher=async()=>{
  if(probes++===0)throw Object.assign(Error('offline'),{cause:{code:'ECONNREFUSED'}});
  return Response.json({product:'dsh-kujira',protocol:1,instance:'ready'});
 };
 const service=createDshService({getSettings:()=>DEFAULTS,openUrl:()=>{opened++;},fetcher,resolveExecutable:async()=>'/installed/dsh',spawnProcess:(file,args,options)=>{
  spawned++;assert.equal(file,'/installed/dsh');assert.equal(options.detached,true);assert.equal(options.shell,false);assert.equal(options.stdio,'ignore');assert(args.includes('--no-open'));
  return {once(){return this;},unref(){}};
 }});
 await Promise.all([service.openWeb(),service.openWeb()]);assert.equal(spawned,1);assert.equal(opened,1);
});

test('browser count releases an owned service only when the last registered page disappears',()=>{
 assert.equal(shouldReleaseOwnedService(0,0),false);
 assert.equal(shouldReleaseOwnedService(0,1),false);
 assert.equal(shouldReleaseOwnedService(2,1),false);
 assert.equal(shouldReleaseOwnedService(1,0),true);
});
test('an already running DSH is not recorded as owned',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'kujira-owned-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 let spawned=0;const service=createDshService({getSettings:()=>DEFAULTS,openUrl:async()=>{},ownershipFile:join(dir,'dsh-owned.json'),fetcher:async()=>Response.json({product:'dsh-kujira',protocol:1,instance:'external'}),spawnProcess:()=>{spawned++;}});
 await service.ready;await service.openWeb();assert.equal(spawned,0);assert.equal(service.ownership(),null);
 assert.equal(service.owns({online:true,presence:{instance:'external'}}),false);
});
test('on-demand start records the spawned pid and reloads that ownership',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'kujira-owned-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const file=join(dir,'dsh-owned.json');let probes=0;
 const service=createDshService({getSettings:()=>DEFAULTS,openUrl:async()=>{},ownershipFile:file,sleep:async()=>{},now:()=>1700000000000,resolveExecutable:async()=>'/installed/dsh',fetcher:async()=>{
  if(probes++===0)throw Object.assign(Error('offline'),{cause:{code:'ECONNREFUSED'}});
  return Response.json({product:'dsh-kujira',protocol:1,instance:'owned-1'});
 },spawnProcess:()=>({pid:4242,once(){return this;},unref(){}})});
 await service.openWeb();assert.equal(service.ownership().pid,4242);assert.equal(service.ownership().instance,'owned-1');
 assert.equal(JSON.parse(await readFile(file,'utf8')).profile,'web');
 const again=createDshService({getSettings:()=>DEFAULTS,openUrl:async()=>{},ownershipFile:file,fetcher:async()=>Response.json({product:'dsh-kujira',protocol:1,instance:'owned-1'})});
 await again.ready;assert.equal(again.owns({online:true,presence:{instance:'owned-1'}}),true);
});
test('a replaced instance is not signalled and a matching pid is',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'kujira-owned-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const file=join(dir,'dsh-owned.json');
 const record={pid:4242,instance:'owned-1',origin:DEFAULTS.dshUrl,profile:'web',startedAt:1};
 await writeFile(file,JSON.stringify(record));
 const signals=[];const replaced=createDshService({getSettings:()=>DEFAULTS,openUrl:async()=>{},ownershipFile:file,processAlive:()=>true,terminate:async pid=>{signals.push(pid);},fetcher:async()=>Response.json({product:'dsh-kujira',protocol:1,instance:'other'})});
 await replaced.ready;assert.deepEqual(await replaced.stopOwned(),{stopped:false,reason:'instance-mismatch'});assert.deepEqual(signals,[]);
 await writeFile(file,JSON.stringify(record));let probes=0;
 const matched=createDshService({getSettings:()=>DEFAULTS,openUrl:async()=>{},ownershipFile:file,processAlive:()=>true,stopTimeout:1000,sleep:async()=>{},now:()=>100,terminate:async pid=>{signals.push(pid);},fetcher:async()=>{
  probes++;return probes<2?Response.json({product:'dsh-kujira',protocol:1,instance:'owned-1'}):Promise.reject(Object.assign(Error('offline'),{cause:{code:'ECONNREFUSED'}}));
 }});
 await matched.ready;assert.equal(shouldReleaseOwnedService(0,0)&&matched.owns({online:true,presence:{instance:'owned-1'}}),false);
 assert.equal(shouldReleaseOwnedService(1,0)&&matched.owns({online:true,presence:{instance:'owned-1'}}),true);
 assert.deepEqual(await matched.stopOwned(),{stopped:true});assert.deepEqual(signals,[4242]);
});
test('terminate targets the unix process group and the windows process tree without a shell',async()=>{
 const signals=[];await terminateProcessTree(12,{platform:'darwin',signal:(pid,name)=>signals.push([pid,name])});
 assert.deepEqual(signals,[[-12,'SIGTERM']]);
 const commands=[];await terminateProcessTree(12,{force:true,platform:'win32',exec:(file,args,options,callback)=>{commands.push([file,args,options.shell]);callback(null);}});
 assert.deepEqual(commands,[['taskkill',['/PID','12','/T','/F'],false]]);
});
test('connect-only mode never starts a missing service',async()=>{
 const service=createDshService({getSettings:()=>({...DEFAULTS,startDsh:'never'}),openUrl:()=>{throw Error('must not open');},fetcher:async()=>{throw Object.assign(Error('offline'),{cause:{code:'ECONNREFUSED'}});},spawnProcess:()=>{throw Error('must not spawn');}});
 await assert.rejects(service.openWeb(),/dsh-offline/);
});

test('desktop UI modules bypass stale caches while video caching remains intact',async()=>{
 const route=createProtocol({runtime:'/runtime',desktopRoot:'/desktop',net:{fetch:async()=>new Response('asset',{headers:{'Cache-Control':'public, max-age=86400'}})},connection:{proxy:async()=>new Response('',{status:404})}});
 const script=await route(new Request('kujira://app/dsh-kujira/shared/client/desktop-settings.js'));
 assert.equal(script.headers.get('cache-control'),'no-store');
 const video=await route(new Request('kujira://app/dsh-kujira/anim/idle.webm'));
 assert.equal(video.headers.get('cache-control'),'public, max-age=86400');
});

test('browser navigation reuses one live tab, rejects overlap and ignores foreign acknowledgements',()=>{
 let now=0;const service=createDesktopPresence({now:()=>now});
 service.update({action:'browser-poll',client:'browser-tab-first1',visible:false,browser:'chrome'});
 service.update({action:'browser-poll',client:'browser-tab-second',visible:true,browser:'firefox'});
 const request=service.update({action:'navigate',target:{kind:'file',sessionId:'session-1',path:'src/file.js'}});
 assert.equal(request.reused,true);assert.equal(request.browser,'firefox');
 assert.equal(service.update({action:'navigate',target:{kind:'web'}}),null);
 assert.equal(service.update({action:'browser-poll',client:'browser-tab-first1'}).navigation,null);
 const command=service.update({action:'browser-poll',client:'browser-tab-second'}).navigation;
 assert.equal(command.target.path,'src/file.js');
 assert.equal(service.update({action:'navigation-ack',client:'browser-tab-first1',id:command.id,success:true}),null);
 service.update({action:'navigation-ack',client:'browser-tab-second',id:command.id,success:true});
 assert.equal(service.update({action:'navigation-status',id:command.id}).result.success,true);
 assert.equal(service.update({action:'browser-poll',client:'browser-tab-second'}).navigation,null);
 now=90001;
 const next=service.update({action:'navigate',target:{kind:'web'}});assert.equal(next.reused,false);
 const first=service.update({action:'browser-poll',client:'new-browser-tab-01'});assert.equal(first.navigation.id,next.navigationId);
 service.update({action:'browser-close',client:'new-browser-tab-01'});assert.equal(service.snapshot().browserCount,0);
});
test('browser activation only uses allowlisted application identities and never opens a URL',async()=>{
 const {focusBrowser}=await import('../desktop/src/browser-focus.js');const calls=[];
 const run=async(...args)=>calls.push(args);
 assert.equal(await focusBrowser('chrome','darwin',run),true);
 assert.deepEqual(calls[0].slice(0,2),['/usr/bin/open',['-b','com.google.Chrome']]);
 assert.equal(await focusBrowser('arbitrary;command','darwin',run),false);assert.equal(calls.length,1);
 assert.equal(await focusBrowser('firefox','linux',async()=>{throw Error('missing wmctrl');}),false);
});
test('macOS tab activation passes the exact origin as an argument and selects an existing tab',async()=>{
 const {focusBrowser}=await import('../desktop/src/browser-focus.js');let args;
 assert.equal(await focusBrowser('chrome','darwin',async(...v)=>{args=v;return {stdout:'matched\n'};},'http://127.0.0.1:3080'),true);
 assert.equal(args[0],'/usr/bin/osascript');assert.equal(args[1][4],'http://127.0.0.1:3080');assert(args[1][3].includes('activeTabIndex'));assert(args[1][3].includes('processIdentifier'));assert(!args[1][3].includes('make new tab'));
 assert.equal(await focusBrowser('chrome','darwin',async()=>{throw Error('permission denied');},'http://127.0.0.1:3080'),false);
});
test('browser return affordance follows the currently registered session',()=>{
 const p=createDesktopPresence();p.update({action:'browser-poll',client:'browser-return-tab',sessionId:'child-1',backKind:'child',visible:true});
 assert.equal(p.snapshot().browserSessionId,'child-1');assert.equal(p.snapshot().browserBackKind,'child');
 const request=p.update({action:'navigate',target:{kind:'back',sessionId:'child-1'}});assert(request.reused);
 p.update({action:'navigation-ack',client:'browser-return-tab',id:request.navigationId,success:true});
 p.update({action:'browser-poll',client:'browser-return-tab',sessionId:'parent-1',backKind:null,visible:true});
 assert.equal(p.snapshot().browserBackKind,null);
});

test('opening radial hit areas cover visible travel and contract after settling',async()=>{
 const {orbHitRegion}=await import('../desktop/ui/hit-regions.js');
 const host={x:100,y:100,width:260,height:260};
 const opening=orbHitRegion(host,34,-150,-90,true),rest=orbHitRegion(host,34,-150,-90,false);
 const hit=(r,x,y)=>x>=r.x&&x<=r.x+r.width&&y>=r.y&&y<=r.y+r.height;
 for(const ratio of [0,.2,.5,.8,1,1.04])assert(hit(opening,230-150*ratio,230-90*ratio));
 assert(hit(rest,80,140));assert(!hit(rest,155,185));assert(!hit(opening,500,500));
});
test('native hit updates are immediate and a pressed gesture cannot click through before release',async()=>{
 const {createWindowController}=await import('../desktop/src/window-controller.js');let ignored,focuses=0,focused=false;
 const screen={getCursorScreenPoint:()=>({x:50,y:50}),on(){},removeListener(){}};
 const win={isFocused:()=>focused,focus:()=>{focused=true;focuses++;},isDestroyed:()=>false,isVisible:()=>true,getBounds:()=>({x:0,y:0,width:820,height:740}),setIgnoreMouseEvents:value=>{ignored=value;}};
 const controller=createWindowController({win,screen,store:{get:()=>({settings:{clickThrough:true}})},capabilities:{clickThrough:true}});
 try {
  assert.equal(ignored,true);assert.equal(focuses,0);
  controller.regions([{x:40,y:40,width:40,height:40}]);assert.equal(ignored,false);
  controller.pointer({x:50,y:50,pressed:true});controller.pointer({x:500,y:500});assert.equal(ignored,false);assert.equal(focuses,1);
  controller.pointer({x:500,y:500,pressed:false});assert.equal(ignored,true);
  controller.pointer({x:50,y:50,pressed:true});controller.regions([]);assert.equal(ignored,false);
  controller.releasePointer();assert.equal(ignored,true);
 } finally {controller.dispose();}
});

test('session navigation reuses a registered DSH page and preserves the exact destination',()=>{
 const service=createDesktopPresence();service.update({action:'browser-poll',client:'session-open-tab',sessionId:'current',visible:true});
 const target={kind:'session',sessionId:'requested-session'};
 const result=service.update({action:'navigate',target});assert.equal(result.reused,true);
 const poll=service.update({action:'browser-poll',client:'session-open-tab',sessionId:'current',visible:true});assert.deepEqual(poll.navigation.target,target);
});

test('desktop saves strictly reject invalid switches, enum values, and invalid local ports',()=>{
 for(const patch of [{login:'yes'},{power:'invalid'},{alwaysOnTop:1}])assert.throws(()=>normalizeSettings(patch,{strict:true}));
 assert.throws(()=>localOrigin('http://127.0.0.1:0'));assert.throws(()=>localOrigin('http://127.0.0.1:3080\n'));
});

test('panel hit testing retains transparent entrance frames and tracks settled and resized edges',async()=>{
 const {surfaceHitRegion}=await import('../desktop/ui/hit-regions.js');
 const {createWindowController}=await import('../desktop/src/window-controller.js');
 let ignored,rect={x:20,y:26,width:290,height:280},playState='running',endTime=220;
 const element={getBoundingClientRect:()=>rect,getAnimations:()=>[{playState,effect:{getComputedTiming:()=>({endTime})}}]};
 const style={display:'flex',visibility:'visible',opacity:'0'};
 const screen={getCursorScreenPoint:()=>({x:16,y:24}),on(){},removeListener(){}};
 const win={isDestroyed:()=>false,isVisible:()=>true,getBounds:()=>({x:0,y:0,width:820,height:740}),setIgnoreMouseEvents:value=>{ignored=value;}};
 const controller=createWindowController({win,screen,store:{get:()=>({settings:{clickThrough:true}})},capabilities:{clickThrough:true}});
 try {
  const first=surfaceHitRegion(element,style);assert(first.rect);assert(first.moving);
  style.opacity='0.5';rect={x:15,y:20,width:300,height:290};
  const middle=surfaceHitRegion(element,style);assert(middle.moving);controller.regions([middle.rect]);assert.equal(ignored,false);
  style.opacity='1';playState='finished';rect={x:12,y:18,width:304,height:300};
  const settled=surfaceHitRegion(element,style);assert.equal(settled.moving,false);controller.regions([settled.rect]);assert.equal(ignored,false);
  controller.pointer({x:13,y:19});assert.equal(ignored,false);
  rect={...rect,height:500};controller.regions([surfaceHitRegion(element,style).rect]);
  controller.pointer({x:13,y:500});assert.equal(ignored,false);
  controller.pointer({x:400,y:500});assert.equal(ignored,true);
  style.display='none';assert.equal(surfaceHitRegion(element,style).rect,null);
  style.display='flex';style.visibility='hidden';assert.equal(surfaceHitRegion(element,style).rect,null);
  style.visibility='visible';style.opacity='0';assert.equal(surfaceHitRegion(element,style).rect,null);
  style.opacity='1';playState='running';endTime=Infinity;assert.equal(surfaceHitRegion(element,style).moving,false);
 } finally {controller.dispose();}
});

test('desktop resizing preserves corner margins and duplicate sizes do not emit position feedback',async()=>{
 const {createWindowController}=await import('../desktop/src/window-controller.js');
 for(const corner of ['tl','tr','bl','br']){
  const area={x:-1200,y:24,width:1200,height:900};
  const position={x:corner.endsWith('l')?area.x+16:area.x+area.width-260-16,y:corner.startsWith('t')?area.y+16:area.y+area.height-260-16};
  let bounds={x:0,y:0,width:820,height:740};const sent=[];
  const screen={getCursorScreenPoint:()=>({x:0,y:0}),getPrimaryDisplay:()=>({workArea:area}),getDisplayNearestPoint:()=>({workArea:area}),on(){},removeListener(){}};
  const win={isDestroyed:()=>false,isVisible:()=>true,getBounds:()=>bounds,setBounds:b=>{bounds=b;},setIgnoreMouseEvents(){},webContents:{send:(_,p)=>sent.push({...p,bounds:{...bounds}})}};
  const store={get:()=>({position,settings:{display:'remember',clickThrough:true}})};
  const c=createWindowController({win,screen,store,capabilities:{clickThrough:true}});
  try {
   c.place(260);const initialCount=sent.length;c.place(260);c.place(260);assert.equal(sent.length,initialCount);
   for(const size of [120,360,120,360,260]){
    c.place(size);const p=sent.at(-1),x=p.bounds.x+p.x,y=p.bounds.y+p.y;
    assert.equal(corner.endsWith('l')?x-area.x:area.x+area.width-x-size,16,corner);
    assert.equal(corner.startsWith('t')?y-area.y:area.y+area.height-y-size,16,corner);
   }
  }finally{c.dispose();}
 }
});
