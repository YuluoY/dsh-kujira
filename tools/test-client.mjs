import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "espree";
import { SHARED_ALLOW, STYLE_FILES } from "../lib/host/resources.js";
import { createClient } from "../lib/shared/client/index.js";
import { createTaskRows } from "../lib/shared/task/rows.js";
import { createTaskIcons } from "../lib/shared/task/icons.js";
import {
  compactStatus,
  isActiveStage,
  statusName,
} from "../lib/shared/task/status.js";
import { configure, translate } from "../lib/shared/i18n.js";
import { messages } from "../lib/shared/messages.js";

const React = {
  Component: class { constructor(props) { this.props=props; } setState(update) { this.state={...this.state,...update}; } },
  createElement: (type, props, ...children) => ({
    type,
    props: props || {},
    children: children.flat(Infinity),
  }),
  useEffect: () => {},
  useLayoutEffect: () => {},
  useRef: (current) => ({ current }),
  useId: () => ":test:",
  useState: (initial) => [
    typeof initial === "function" ? initial() : initial,
    () => {},
  ],
  useCallback: (callback) => callback,
  useMemo: (callback) => callback(),
  Fragment: "fragment",
};
const walk = (node) =>
  node && typeof node === "object"
    ? [node, ...(node.children || []).flatMap(walk)]
    : [];

test("all browser imports are covered by the explicit public resource manifest", async () => {
  for (const file of SHARED_ALLOW) {
    const url = new URL("../lib/shared/" + file, import.meta.url),
      source = await readFile(url, "utf8");
    const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
    for (const statement of ast.body) {
      if (!statement.source?.value?.startsWith(".")) continue;
      const target = new URL(statement.source.value, url);
      const relative = target.pathname.split("/lib/shared/")[1];
      assert.ok(
        relative && SHARED_ALLOW.has(relative),
        `${file} imports an unpublished module: ${relative}`,
      );
    }
  }
  const css = await readFile(
    new URL("../lib/appearance.css", import.meta.url),
    "utf8",
  );
  for (const file of STYLE_FILES) {
    assert.ok(css.includes("./styles/" + file));
    assert.ok(
      (
        await readFile(
          new URL("../lib/styles/" + file, import.meta.url),
          "utf8",
        )
      ).length > 0,
    );
  }
});

test("client composition renders with the host React instance after module extraction", () => {
  const previous = globalThis.matchMedia;
  const previousStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => null },
  });
  globalThis.matchMedia = () => ({ matches: false });
  try {
    const client = createClient(React);
    const root = client.Pet();
    assert.equal(root.props.className, "dsh-kujira-root");
    assert.equal(walk(root).filter((node) => node.type === "video").length, 2);
    assert.equal(
      walk(root).filter((node) => node.props.className === "dsh-kujira-orb")
        .length,
      7,
    );
    assert.equal(typeof client.UsageMount, "function");
  } finally {
    if (previousStorage)
      Object.defineProperty(globalThis, "localStorage", previousStorage);
    else delete globalThis.localStorage;
    if (previous) globalThis.matchMedia = previous;
    else delete globalThis.matchMedia;
  }
});

test("tool names are available in expanded details without cluttering the main status", () => {
  const icon = createTaskIcons(React.createElement);
  const help = () => null;
  for (const locale of ["zh-CN", "en-US", "ko-KR", "ru-RU"]) {
    configure(locale);
    const { operation } = createTaskRows({
      React,
      HelpLabel: help,
      icon,
      detail: null,
      setDetail: () => {},
      busy: false,
      open: () => {},
      brief: (text) => text,
      sessionId: "session",
    });
    const row = operation(
      { id: "call", name: "bash", stage: "testing", status: "running" },
      "current",
    );
    assert.equal(
      walk(row).find((node) => node.type === "code"),
      undefined,
    );
    const expanded = createTaskRows({
      React,
      HelpLabel: help,
      icon,
      detail: "call",
      setDetail: () => {},
      busy: false,
      open: () => {},
      brief: (text) => text,
      sessionId: "session",
    }).operation(
      { id: "call", name: "bash", stage: "testing", status: "running" },
      "current",
    );
    assert.equal(
      walk(expanded).find((node) => node.type === "code")?.children[0],
      "bash",
    );
    assert.ok(!walk(row).some((node) => node.type === help));
    assert.ok(walk(row).some((node) => node.props["data-active"] === "true"));
    const done = operation({
      id: "call",
      name: "bash",
      stage: "testing",
      status: "done",
    });
    assert.ok(!walk(done).some((node) => node.props["data-active"] === "true"));
  }
});

test("status labels remain understandable without animation and translate in all four locales", () => {
  const stages = [
    "thinking",
    "working",
    "reading",
    "searching",
    "editing",
    "testing",
    "delegating",
    "summarizing",
    "retrying",
    "waiting",
    "paused",
    "done",
    "error",
    "stopped",
    "unknown",
    "idle",
  ];
  for (const stage of stages) {
    const label = statusName(stage);
    assert.ok(messages[label], label);
    for (const locale of ["zh-CN", "en-US", "ko-KR", "ru-RU"])
      assert.ok(translate(label, {}, locale));
  }
  for (const stage of [
    "done",
    "waiting",
    "paused",
    "error",
    "stopped",
    "unknown",
    "idle",
  ])
    assert.equal(isActiveStage(stage), false);
  assert.equal(compactStatus("unrecognized"), "待同步");
  assert.notEqual(statusName("waiting"), statusName("paused"));
});

test("one primary operation survives normal, waiting, completed and partial snapshots", async () => {
  const { taskPresentation } =
    await import("../lib/shared/task/presentation.js");
  assert.equal(taskPresentation(null), null);
  assert.deepEqual(taskPresentation({}).children, []);
  const current = {
    id: "test",
    name: "bash",
    status: "running",
    stage: "testing",
  };
  assert.equal(
    taskPresentation({ stage: "testing", current }).current.id,
    "test",
  );
  for (const stage of [
    "waiting",
    "paused",
    "done",
    "error",
    "stopped",
    "summarizing",
  ])
    assert.equal(taskPresentation({ stage, current }).current, null);
  const large = taskPresentation({
    children: Array(500).fill({}),
    todos: Array(500).fill({}),
    operations: Array(500).fill({}),
    artifacts: Array(500).fill({}),
    tasks: { total: 3, completed: 99 },
  });
  assert.deepEqual(
    [
      large.children.length,
      large.todos.length,
      large.operations.length,
      large.artifacts.length,
    ],
    [200, 50, 40, 20],
  );
  assert.deepEqual(large.tasks, { total: 3, completed: 3 });
  assert.equal(
    taskPresentation({ tasks: { total: 0, completed: 2 } }).tasks,
    null,
  );
  assert.equal(
    taskPresentation({ tasks: { total: 5, completed: NaN } }).tasks.completed,
    0,
  );
});

test("panel height limits and top anchors stay inside small and large viewports", async () => {
  const { panelGeometry } =
    await import("../lib/shared/client/panel-geometry.js");
  for (const w of [280, 375, 600, 768, 1440])
    for (const h of [160, 300, 500, 900, 1800])
      for (const top of [-100, 0, h - 120, h + 100]) {
        const frame = panelGeometry({ top, height: 260 }, { w, h });
        assert.ok(
          frame.maxHeight <= 520 && frame.maxHeight <= Math.floor(h * 0.78),
        );
        assert.ok(frame.top >= 12 && frame.top + frame.maxHeight <= h - 12);
      }
});

test("extreme real-shaped events bound public copy and mark truncated results", async () => {
  const { activityPreview } = await import("./fixtures/activity-preview.mjs");
  const { sessionActivity, cleanText } =
    await import("../lib/shared/activity.js");
  const fixture = activityPreview("extreme"),
    activity = sessionActivity(fixture.events);
  assert.equal(activity.todos.length, 50);
  assert.equal(activity.children.length, 30);
  assert.ok(activity.title.length <= 600);
  assert.equal(activity.titleTruncated, true);
  const result = activity.operations.find((op) => op.name === "bash");
  assert.equal(result.truncated, true);
  assert.ok(result.result.length <= 6000);
  assert.doesNotMatch(cleanText("🐳".repeat(10), 5), /[\uD800-\uDBFF]$/);
  assert.ok(!JSON.stringify(fixture).includes("inputTokens"));
});

test("external menu features register, sort and dispose without replacing built-ins", async () => {
  const { registerFeature, getFeatures, subscribeFeatures, menuLimit } =
    await import("../lib/shared/feature-registry.js");
  let updates = 0;
  const off = subscribeFeatures(() => updates++);
  assert.throws(() =>
    registerFeature({
      id: "settings",
      label: "Override",
      iconPath: "M0 0",
      href: "https://example.com",
    }),
  );
  assert.throws(() =>
    registerFeature({
      id: "bad-url",
      label: "Bad",
      iconPath: "M0 0",
      href: "javascript:alert(1)",
    }),
  );
  const remove = registerFeature({
    id: "test-docs",
    label: "Docs",
    iconPath: "M2 2h12v12H2z",
    href: "https://example.com",
  });
  assert.equal(getFeatures()[0].key, "test-docs");
  assert.equal(updates, 1);
  assert.throws(() =>
    registerFeature({
      id: "test-docs",
      label: "Duplicate",
      iconPath: "M0 0",
      href: "https://example.com",
    }),
  );
  remove();
  assert.equal(getFeatures().length, 0);
  assert.equal(updates, 2);
  off();
  assert.deepEqual([-1, 3, 5, 8, 99, NaN].map(menuLimit), [3, 3, 5, 8, 8, 6]);
});

test("all 50 animation clips belong to a runtime-consumed action route", async () => {
  const { readdir } = await import("node:fs/promises");
  const config = JSON.parse(
    await readFile(
      new URL("../assets/pet.config.json", import.meta.url),
      "utf8",
    ),
  );
  const paths = [
    "idle",
    "action",
    "long",
    "click",
    "sleep",
    "workBreak",
  ].flatMap((key) => config.pools[key] || []);
  paths.push(config.startAnim, config.dragAnim, "翻钱包", "看天气", "吃小鱼干");
  for (const state of Object.values(config.state.map))
    paths.push(...state.anim);
  for (const entries of Object.values(config.state.enter))
    paths.push(...entries);
  const files = await readdir(new URL("../assets/anim", import.meta.url));
  assert.equal(files.filter((file) => file.endsWith(".webm")).length, 50);
  for (const file of files.filter((file) => file.endsWith(".webm")))
    assert.ok(
      paths.includes(file.slice(0, -5)),
      file + " has no playback route",
    );
});

test('the current operation is excluded from history and returns there once settled',async()=>{
 const {taskPresentation}=await import('../lib/shared/task/presentation.js');
 const current={id:'current',status:'running',stage:'working'};
 const snapshot={stage:'working',current,operations:[current,{id:'past',status:'done',stage:'working'}]};
 assert.deepEqual(taskPresentation(snapshot).operations.map(op=>op.id),['past']);
 assert.deepEqual(taskPresentation({...snapshot,stage:'done'}).operations.map(op=>op.id),['current','past']);
});

test('short panels anchor beside the mascot without reserving the full maximum height',async()=>{
 const {panelGeometry}=await import('../lib/shared/client/panel-geometry.js');
 const result=panelGeometry({top:340,height:260},{w:1100,h:807});
 assert.equal(result.top,390);assert(result.maxHeight<520);assert(result.top+result.maxHeight<=795);
 const nearBottom=panelGeometry({top:530,height:260},{w:1100,h:807},360);
 assert.equal(nearBottom.top,435);assert.equal(nearBottom.maxHeight,360);
});

test('task overview excludes cancelled plan items and prioritizes children needing attention',async()=>{
 const {taskPresentation}=await import('../lib/shared/task/presentation.js');
 const view=taskPresentation({stage:'paused',todos:[{status:'completed'},{status:'cancelled'},{status:'pending'}],children:[{id:'done',stage:'done'},{id:'busy',stage:'working'},{id:'help',stage:'waiting'}],operations:[{id:'running',status:'running'}]});
 assert.deepEqual(view.tasks,{total:2,completed:1});assert.deepEqual(view.children.map(c=>c.id),['help','busy','done']);assert.equal(view.records[0].status,'paused');
});
test('task navigation only exposes supported file and child destinations and guards session changes',async()=>{
 const {createNavigation}=await import('../lib/shared/client/navigation.js');let selected='parent';const calls=[];
 const services={sessions:{openSubagent:async value=>calls.push(['child',value])},sidebarRight:{openResource:async value=>calls.push(['file',value])}};
 const ctx=new Proxy({get:name=>services[name]},{get(target,key){if(key in target)return target[key];throw new Error(`cannot get property "${key}" without inject`);}});
 const go=createNavigation({ctx,taskRuntime:{snapshot:()=>({sessionId:selected})}}).navigateTask;
 assert.equal(go.canOpen({kind:'turn',turn:1}),false);assert.equal(go.canOpen({kind:'child',id:'c',mode:'unknown'}),false);
 assert.equal(await go({kind:'file',path:'src/a b.ts',sessionId:'parent'}),true);assert.equal(calls[0][1],'dsh-resource://file/session/parent/src/a%20b.ts');
 assert.equal(await go({kind:'child',id:'c',mode:'one-shot',parentId:'parent',sessionId:'parent'}),true);assert.equal(calls[1][1].childSessionId,'c');
 selected='other';assert.equal(await go({kind:'file',path:'a',sessionId:'parent'}),false);
 const missing=createNavigation({ctx:new Proxy({get:()=>undefined},{get(target,key){if(key in target)return target[key];throw new Error(`undeclared service ${key}`);}}),taskRuntime:{snapshot:()=>({sessionId:selected})}}).navigateTask;
 assert.equal(missing.canOpen({kind:'file',path:'a'}),false);
});

test('completed run_code results render with the strict host service context', async () => {
  const { createNavigation } = await import('../lib/shared/client/navigation.js');
  const { createMarkdown } = await import('../lib/shared/task/markdown.js');
  const reads = [];
  const ctx = new Proxy({get(name) { reads.push(name); return undefined; }}, {
    get(target, key) { if (key in target) return target[key]; throw new Error(`cannot get property "${key}" without inject`); },
  });
  const navigate = createNavigation({ctx,taskRuntime:{snapshot:()=>({sessionId:'parent'})}}).navigateTask;
  const Markdown = createMarkdown(React);
  const rows = createTaskRows({React,icon:()=>null,detail:'code-1',setDetail:()=>{},busy:false,
    canOpen:navigate.canOpen,open:navigate,sessionId:'parent',
    markdown:text=>Markdown({text,onOpenFile:navigate.canOpen({kind:'file',path:'.'})?()=>{}:undefined}),
  });
  const nodes = walk(rows.operation({id:'code-1',name:'run_code',stage:'working',status:'done',result:'## Done\n\n```json\n{"ok":true}\n```\n\n[file](src/a.js)'}));
  assert(nodes.some(node=>node.type==='pre'));
  assert(nodes.some(node=>node.props.className==='kj-markdown'));
  assert(!nodes.some(node=>node.props.className==='kj-md-file'));
  assert.deepEqual(reads,['sidebarRight']);
});

test('task detail boundary retains a recoverable panel and supports retry and close', async () => {
  const {createTaskBoundary}=await import('../lib/shared/task/panel.js');
  const Boundary=createTaskBoundary(React);let closed=0;
  const view=new Boundary({children:'healthy',onClose:()=>closed++,shell:'shell'});
  assert.equal(view.render(),'healthy');
  view.state=Boundary.getDerivedStateFromError(new Error('render failed'));
  const nodes=walk(view.render());
  assert(nodes.some(node=>node.props.role==='dialog'));
  nodes.find(node=>node.type==='button' && node.props.autoFocus).props.onClick();
  assert.equal(view.render(),'healthy');
  nodes.find(node=>node.type==='button' && !node.props.autoFocus).props.onClick();
  assert.equal(closed,1);
});

test('project path labels respect root boundaries, external files and Windows separators', async()=>{
 const {projectPath}=await import('../lib/shared/task/text.js');
 assert.equal(projectPath('/work/app/src/a.js','/work/app'),'src/a.js');
 assert.equal(projectPath('/work/app-other/a.js','/work/app'),'/work/app-other/a.js');
 assert.equal(projectPath('/work/app/../outside.js','/work/app'),'/work/app/../outside.js');
 assert.equal(projectPath('C:\\Work\\App\\src\\a.ts','c:\\work\\app'),'src/a.ts');
 assert.equal(projectPath('./src/a.js','/work/app'),'src/a.js');
 assert.equal(projectPath('/src/a.js','/'),'src/a.js');
 assert.equal(projectPath('/work/app/.hidden/file','/work/app'),'.hidden/file');
});
test('message pages use durable identities, deduplicate updates, preserve roles and exclude hidden context',async()=>{
 const {messagePage}=await import('../lib/shared/task/messages.js');
 const e=(type,seq,data={})=>({type,seq,data});
 const events=[e('turn/start',0,{turn:1}),e('user/message',1,{id:'a',source:{kind:'user'},content:[{type:'text',text:'Same'}]}),e('step/start',2,{step:1}),e('assistant/message',3,{turn:1,step:1,message:{content:[{type:'reasoning',text:'secret'}]}}),e('assistant/message',4,{turn:1,step:1,message:{content:[{type:'text',text:'First'}]}}),e('assistant/message',5,{turn:1,step:1,message:{content:[{type:'text',text:'Updated'}]}}),e('user/message',6,{source:{kind:'plugin'},content:[{type:'text',text:'hidden'}]}),e('turn/start',7,{turn:2}),e('user/message',8,{id:'b',source:{kind:'user'},content:[{type:'text',text:'Same'}]})];
 const page=messagePage(events,0,{limit:2});assert.equal(page.total,3);assert(page.hasMore);assert.deepEqual(page.items.map(x=>x.key),['13:input-messageb','14:assistant-step1:1']);assert.equal(page.items[1].text,'Updated');
 assert.equal(messagePage(events,0,{before:page.before}).items[0].key,'13:input-messagea');assert.equal(messagePage(events,7).total,1);assert(!JSON.stringify(page).includes('secret'));
});
test('message location is exact, releases host turn following and cancels after a session switch',async()=>{
 const {revealMessage}=await import('../lib/shared/client/message-navigation.js');
 const old=globalThis.matchMedia;globalThis.matchMedia=()=>({matches:true});
 try {
  const calls=[];let current=true,loaded=false;
  const node={dataset:{chatAnchorKey:'exact'},getClientRects:()=>[{}],scrollIntoView:()=>calls.push('scroll'),setAttribute:()=>{},focus:()=>calls.push('focus')};
  const nav={getAttribute:()=> '跳转到第 2 轮',click:()=>calls.push('native')};
  const doc={querySelectorAll:selector=>selector.startsWith('nav')?[nav]:loaded?[node]:[]};
  const target={sessionId:'s',key:'exact',seq:10,startSeq:8,turn:2};
  const sessions={binding:()=>({session:{loadThrough:async seq=>{assert.equal(seq,8);loaded=true;}}})};
  assert.equal(await revealMessage(target,{sessions,isCurrent:()=>current,document:doc}),true);assert.deepEqual(calls,['native','scroll','focus']);
  loaded=false;calls.length=0;sessions.binding=()=>({session:{loadThrough:async()=>{current=false;loaded=true;}}});
  assert.equal(await revealMessage(target,{sessions,isCurrent:()=>current,document:doc}),false);assert.deepEqual(calls,[]);
 }finally{globalThis.matchMedia=old;}
});

test('message history pages are session-scoped and reject invalid cursors',async()=>{
 const {createActivityReader}=await import('../lib/host/activity.js');
 const events=Array.from({length:65},(_,seq)=>({type:'user/message',seq,data:{id:'m'+seq,source:{kind:'user'},content:[{type:'text',text:'Message '+seq}]}}));
 const sessions=new Map([['a',{header:{cwd:'/work/a'},snapshotEvents:()=>events}],['b',{header:{cwd:'/work/b'},snapshotEvents:()=>[]}]]);
 const reader=createActivityReader(()=>sessions),first=reader.read('a').activity;
 assert.equal(first.cwd,'/work/a');assert.equal(first.messages.length,30);assert.equal(first.messageCount,65);
 const next=reader.messages('a',first.messageBefore);assert.equal(next.items.length,30);assert(next.items.every(x=>x.seq<first.messageBefore));
 assert.equal(reader.messages('b',first.messageBefore).items.length,0);assert.equal(reader.messages('a',NaN).ok,false);assert.equal(reader.messages('a',-1).ok,false);assert.equal(reader.messages('missing',2).ok,false);
});

test('attachment-only user messages remain locatable without revealing hidden reasoning',async()=>{
 const {messagePage}=await import('../lib/shared/task/messages.js');
 const page=messagePage([{type:'user/message',seq:1,data:{id:'image',source:{kind:'user'},content:[{type:'image',data:'private-binary'}]}},{type:'assistant/message',seq:2,data:{turn:1,step:1,message:{content:[{type:'reasoning',text:'hidden'}]}}}]);
 assert.equal(page.total,1);assert.equal(page.items[0].key,'13:input-messageimage');assert.equal(page.items[0].text,'附件消息');assert(!JSON.stringify(page).includes('private-binary'));
});

test('task navigation returns through nested child sessions and ignores unrelated routes',async()=>{
 const {createNavigation}=await import('../lib/shared/client/navigation.js');
 let current='root';const history=[],addresses=new Map();
 const sessions={list:{getSnapshot:()=>({current})},subagentAddress:id=>addresses.get(id),open:id=>{current=id;},openSubagent:address=>{addresses.set(address.childSessionId,address);current=address.childSessionId;}};
 const runtime={snapshot:()=>({sessionId:current})};
 const make=()=>createNavigation({taskRuntime:runtime,ctx:{get:()=>sessions},history}).navigateTask;
 const go=make();await go({kind:'child',sessionId:'root',parentId:'root',id:'child',mode:'continuable'});
 assert.equal(make().backTarget().from,'root');
 await make()({kind:'child',sessionId:'child',parentId:'child',id:'grandchild',mode:'one-shot'});
 await make()({kind:'back',sessionId:'grandchild'});assert.equal(current,'child');
 await make()({kind:'back',sessionId:'child'});assert.equal(current,'root');assert.equal(history.length,0);
 current='unrelated';assert.equal(make().backTarget(),null);
 current='child';assert.equal(make().backTarget().from,'root'); // Native navigation/refresh can recover the parent address.
});
test('failed and stale child navigation never invents a return route',async()=>{
 const {createNavigation}=await import('../lib/shared/client/navigation.js');const history=[];
 const sessions={openSubagent:async()=>{throw Error('not found');},open:()=>{}};
 const go=createNavigation({taskRuntime:{snapshot:()=>({sessionId:'s'})},ctx:{get:()=>sessions},history}).navigateTask;
 assert.equal(await go({kind:'child',sessionId:'s',parentId:'wrong',id:'child',mode:'one-shot'}),false);
 await assert.rejects(go({kind:'child',sessionId:'s',parentId:'s',id:'child',mode:'one-shot'}));
 assert.equal(history.length,0);assert.equal(go.backTarget(),null);
 assert.equal(await go({kind:'back',sessionId:'other'}),false);
});
test('message return restores the original anchor offset and refuses a missing anchor',async()=>{
 const {captureChatPosition,restoreChatPosition}=await import('../lib/shared/client/message-navigation.js');
 const old=globalThis.getComputedStyle;globalThis.getComputedStyle=()=>({overflowY:'auto'});
 try {
  const scroller={scrollTop:200,scrollHeight:2000,clientHeight:200,getBoundingClientRect:()=>({top:0})};
  const anchor={dataset:{chatAnchorKey:'old-message'},parentElement:scroller,getClientRects:()=>[{}],getBoundingClientRect:()=>({top:250-scroller.scrollTop,bottom:350-scroller.scrollTop}),setAttribute:()=>{},focus:()=>{}};
  const flow={...scroller,querySelectorAll:()=>[anchor]};
  const doc={querySelector:()=>flow,querySelectorAll:()=>[anchor]};
  const position=captureChatPosition(doc);assert.equal(position.offset,50);
  scroller.scrollTop=600;assert.equal(restoreChatPosition(position,doc),true);assert.equal(scroller.scrollTop,200);
  assert.equal(restoreChatPosition({key:'missing',offset:0},doc),false);
 }finally{globalThis.getComputedStyle=old;}
});

test('Markdown file navigation preserves host viewer selection and safely encodes the original path',async()=>{
 const {createNavigation}=await import('../lib/shared/client/navigation.js');const calls=[];
 const go=createNavigation({ctx:{get:name=>name==='sidebarRight'?{openResource:(...args)=>calls.push(args)}:undefined},taskRuntime:{snapshot:()=>({sessionId:'s'})}}).navigateTask;
 assert.equal(await go({kind:'file',sessionId:'s',path:'docs/说明 #1.MD'}),true);
 assert.equal(calls[0].length,1);assert.equal(calls[0][0],'dsh-resource://file/session/s/docs/%E8%AF%B4%E6%98%8E%20%231.MD');
});

test('file labels separate extension tags without losing dotfiles or compound filenames',async()=>{
 const {fileLabel}=await import('../lib/shared/task/text.js');
 assert.deepEqual(fileLabel('src/a.test.tsx'),{name:'a.test.tsx',stem:'a.test',extension:'tsx'});
 assert.deepEqual(fileLabel('C:\\work\\.gitignore'),{name:'.gitignore',stem:'.gitignore',extension:''});
 assert.equal(fileLabel('README.MD').extension,'MD');assert.equal(fileLabel('LICENSE').stem,'LICENSE');
});
