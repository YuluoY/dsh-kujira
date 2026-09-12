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
      6,
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
 const ctx={sessions:{openSubagent:async value=>calls.push(['child',value])},sidebarRight:{openResource:async value=>calls.push(['file',value])}};
 const go=createNavigation({ctx,taskRuntime:{snapshot:()=>({sessionId:selected})}}).navigateTask;
 assert.equal(go.canOpen({kind:'turn',turn:1}),false);assert.equal(go.canOpen({kind:'child',id:'c',mode:'unknown'}),false);
 assert.equal(await go({kind:'file',path:'src/a b.ts',sessionId:'parent'}),true);assert.equal(calls[0][1],'dsh-resource://file/session/parent/src/a%20b.ts');
 assert.equal(await go({kind:'child',id:'c',mode:'one-shot',parentId:'parent',sessionId:'parent'}),true);assert.equal(calls[1][1].childSessionId,'c');
 selected='other';assert.equal(await go({kind:'file',path:'a',sessionId:'parent'}),false);
 const missing=createNavigation({ctx:{},taskRuntime:{snapshot:()=>({sessionId:selected})}}).navigateTask;
 assert.equal(missing.canOpen({kind:'file',path:'a'}),false);
});
