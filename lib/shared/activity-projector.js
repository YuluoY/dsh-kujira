import {
  cleanText,
  publicText,
  parsed,
  location,
  operationKind,
  phaseLabel,
} from "./activity-facts.js";
/**
 * @description Incrementally project task events into bounded visible facts.
 * @returns {object} Event consumer and detached public snapshot.
 */
export function createActivityProjection() {
  let value;
  const reset = (e) => ({
    phase: "idle",
    stage: "idle",
    label: phaseLabel.idle,
    title: "",
    startedAt: null,
    endedAt: null,
    tools: 0,
    trail: [],
    operations: [],
    todos: [],
    children: [],
    artifacts: [],
    summary: "",
    ...location(e || {}),
  });
  value = reset();
  const calls = new Map(),
    catalog = new Map(),
    approvals = new Map(),
    files = new Map(),
    pending = new Map(),
    waiting = new Map(),
    nested = [],
    bodies = new Map(),
    detailedParents = new Set(),
    order = new WeakMap();
  let currentTurn = null,
    trailIndex = 0;
  let plan = [],
    planTurn = null,
    planTime = null,
    title = "",
    titleTruncated = false;
  const setStage = (stage) => {
    value.stage = stage;
    value.phase = ["waiting", "done", "error", "stopped", "idle"].includes(
      stage,
    )
      ? stage
      : "running";
    value.label = phaseLabel[stage];
  };
  const add = (label, e, kind = "event") => {
    value.trail.push({
      id: String(e.seq ?? trailIndex++) + ":" + kind,
      label,
      time: e.time,
      kind,
      ...location(e),
    });
    value.trail = value.trail.slice(-40);
  };
  const append = (e) => {
    if (!e?.type) return;
    const d = e.data || {};
    if (e.type === "turn/start") {
      value = reset(e);
      value.title = title;
      value.titleTruncated = titleTruncated;
      currentTurn = d.turn;
      value.startedAt = e.time;
      calls.clear();
      approvals.clear();
      pending.clear();
      waiting.clear();
      nested.length = 0;
      bodies.clear();
      detailedParents.clear();
      setStage("thinking");
    }
    if (currentTurn != null && d.turn != null && d.turn !== currentTurn) return;
    if (
      e.type === "user/message" &&
      (!d.source || ["human", "user"].includes(d.source.kind))
    ) {
      const nextTitle = publicText(d.content, 600);
      if (nextTitle) {
        title = nextTitle;
        titleTruncated = publicText(d.content, 601).length > 600;
        value.title = title;
        value.titleTruncated = titleTruncated;
      }
    }
    if (e.type === "todo/write" && Array.isArray(d.todos)) {
      planTurn = currentTurn;
      planTime = e.time;
      plan = d.todos
        .filter(
          (t) =>
            t &&
            ["pending", "in_progress", "completed", "cancelled"].includes(
              t.status,
            ),
        )
        .slice(0, 50)
        .map((t) => ({
          label: cleanText(t.content || t.text, 4000),
          status: t.status,
        }));
    }
    if (
      e.type === "tool/call" ||
      e.type === "tool/ptc-dispatch-start" ||
      e.type === "tool/ptc-dispatch"
    ) {
      const ptc = e.type.startsWith("tool/ptc-");
      if (
        ptc &&
        (typeof d.subCallId !== "string" ||
          (!calls.has(d.parentCallId) && !calls.has("ptc:" + d.parentCallId)))
      )
        return;
      const args = parsed(d.arguments),
        name = cleanText(d.name || d.tool, 80),
        id = ptc
          ? "ptc:" + d.subCallId
          : String(d.callId || "seq-" + (e.seq ?? value.tools));
      if (!calls.has(id)) {
        const stage = operationKind(name, args),
          path = cleanText(args.path || args.file_path || args.filePath, 500);
        const op = {
          id,
          name,
          parentId: ptc
            ? calls.has(d.parentCallId)
              ? d.parentCallId
              : "ptc:" + d.parentCallId
            : null,
          paths: [],
          label: phaseLabel[stage],
          stage,
          path,
          status: "running",
          time: e.time,
          endedAt: null,
          result: "",
          ...location(e),
        };
        if (
          stage === "editing" &&
          path &&
          (/^(write|edit|write_file|edit_file)$/.test(name) ||
            (name === "str_replace_editor" &&
              ["create", "str_replace", "insert"].includes(args.command)))
        )
          op.paths = [path];
        if (/subagent|delegate/.test(name))
          op.description = cleanText(args.description, 160);
        if (stage === "waiting")
          op.description = cleanText(
            args.questions?.[0]?.question || args.questions?.[0]?.header,
            240,
          );
        calls.set(id, op);
        order.set(op, value.tools);
        value.operations.push(op);
        pending.set(id, op);
        if (stage === "waiting") waiting.set(id, op);
        if (op.parentId) {
          nested.push(op);
          detailedParents.add(op.parentId);
        }
        value.tools++;
        if (!value.endedAt) setStage(approvals.size ? "waiting" : stage);
        value.currentId = id;
        add(op.label, e, "operation");
      }
    }
    if (e.type === "tool/result" || e.type === "tool/ptc-dispatch") {
      const ptc = e.type === "tool/ptc-dispatch";
      const block = ptc
        ? d
        : Array.isArray(d.message?.content)
          ? d.message.content.find((b) => b?.type === "tool-result")
          : undefined;
      const op = calls.get(
        ptc ? "ptc:" + d.subCallId : d.message?.source?.callId || d.callId,
      );
      if (!op || op.endedAt != null) return;
      if (op.endedAt == null) {
        op.status = !block || block.isError || d.error ? "error" : "done";
        op.endedAt = e.time ?? 0;
        bodies.set(op.id, publicText(block?.content, 6001));
        if (op.status === "error" && !value.operations.includes(op)) {
          value.operations.push(op);
          value.operations.sort((a, b) => order.get(a) - order.get(b));
        }
        pending.delete(op.id);
        waiting.delete(op.id);
        if (op.path && op.status === "done" && ["editing"].includes(op.stage)) {
          for (const path of op.paths) {
            files.delete(path);
            files.set(path, { path, kind: "file", ...location(e) });
          }
          while (files.size > 20) files.delete(files.keys().next().value);
        }
      }
      if (!value.endedAt) {
        while (nested.length && !pending.has(nested.at(-1).id)) nested.pop();
        const current =
          waiting.values().next().value ||
          nested.at(-1) ||
          pending.values().next().value;
        setStage(approvals.size ? "waiting" : current?.stage || "summarizing");
        value.currentId = current?.id || op?.id;
      }
      add(
        op?.status === "error" ? "工具执行失败，正在处理" : "工具已完成",
        e,
        "result",
      );
    }
    if (e.type === "assistant/message") {
      const text = publicText(d.message?.content, 6000);
      if (text) {
        value.summary = text;
        value.summaryTruncated =
          publicText(d.message?.content, 6001).length > 6000;
        value.summaryLocation = location(e);
        add(cleanText(text, 100), e, "message");
      }
    }
    if (e.type === "approval/asked") {
      setStage("waiting");
      value.attention = {
        id: d.id || e.seq,
        label: cleanText(d.reason, 400) || "需要你确认，请查看会话中的请求",
        ...location(e),
      };
      approvals.set(value.attention.id, value.attention);
      add(value.attention.label, e, "attention");
    }
    if (e.type === "approval/decided") {
      approvals.delete(d.id);
      value.attention = [...approvals.values()][0] || null;
      if (!value.endedAt) setStage(approvals.size ? "waiting" : "working");
    }
    if (e.type === "llm/retry-started") {
      setStage("retrying");
      add(phaseLabel.retrying, e, "retry");
    }
    if (e.type === "step/start" && !value.endedAt && !pending.size)
      setStage("thinking");
    if (e.type === "compaction/start") {
      setStage("summarizing");
      add("正在整理上下文", e);
    }
    if (
      e.type === "subagent/catalog" &&
      typeof d.childId === "string" &&
      ["one-shot", "continuable"].includes(d.mode)
    ) {
      const child = {
        id: d.childId,
        mode: d.mode,
        label: cleanText(d.label, 4000),
        createdAt: d.childCreatedAt,
        time: e.time,
      };
      catalog.set(child.id, child);
      if (!value.children.some((c) => c.id === child.id))
        value.children.push(child);
    }
    if (e.type === "turn/end") {
      const kind = d.reason?.kind || d.kind;
      setStage(
        kind === "completed"
          ? "done"
          : kind === "blocked"
            ? "waiting"
            : ["error", "max-tokens", "timeout"].includes(kind)
              ? "error"
              : "stopped",
      );
      value.endedAt = e.time;
      value.endReason = kind;
      value.attention =
        kind === "blocked"
          ? { label: "任务受阻，需要你处理", ...location(e) }
          : null;
      value.error = cleanText(d.reason?.error?.message, 600);
      for (const op of pending.values()) op.status = "stopped";
      pending.clear();
      waiting.clear();
      nested.length = 0;
      add(value.label, e, "end");
    }
    value.updatedAt = e.time;
    // Retain visible history and running operations; call identities preserve duplicate pairing.
    value.operations = value.operations.filter(
      (op) =>
        !(
          op.name === "run_code" &&
          detailedParents.has(op.id) &&
          op.status !== "error"
        ),
    );
    value.operations = value.operations.filter(
      (op, index, all) => op.status === "running" || index >= all.length - 40,
    );
    const retained = new Set(value.operations.map((op) => op.id));
    retained.add(value.currentId);
    for (const id of bodies.keys()) if (!retained.has(id)) bodies.delete(id);
  };
  const operation = (op, includeText) => {
    if (!op) return null;
    const result = bodies.get(op.id) || "";
    return {
      ...op,
      paths: [...op.paths],
      result:
        cleanText(result, includeText ? 6000 : 160) ||
        (op.endedAt != null
          ? op.status === "error"
            ? "工具执行失败"
            : "工具已完成，未返回文字结果"
          : ""),
      truncated: result.length > (includeText ? 6000 : 160),
      detailAvailable: bodies.has(op.id),
    };
  };
  const snapshot = ({ includeText = true } = {}) => {
    const view = {
      ...value,
      trail: [...value.trail],
      children: [...value.children],
    };
    view.todos = plan;
    view.planTurn = planTurn;
    view.planTime = planTime;
    view.tasks = {
      total: plan.filter((t) => t.status !== "cancelled").length,
      completed: plan.filter((t) => t.status === "completed").length,
    };
    view.artifacts = [...files.values()].reverse();
    view.catalog = [...catalog.values()].slice(-200);
    view.operations = value.operations.map((op) => operation(op, includeText));
    view.artifacts = view.artifacts.slice(-20);
    view.current = operation(calls.get(view.currentId), includeText);
    return view;
  };
  return { append, snapshot };
}
