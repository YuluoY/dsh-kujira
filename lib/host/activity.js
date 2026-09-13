import { createMessageIndex } from "../shared/task/messages.js";
import { randomUUID } from "node:crypto";
import { createActivityProjection, publicText, cleanText } from "../shared/activity.js";
/**
 * @description Read session activity and bounded released-child snapshots across turns.
 * @param {Function} getSessions Live or read-only session lookup.
 * @returns {object} Cached activity reader and settlement observers.
 */
export function createActivityReader(getSessions) {
  const completed = new Map(),
    cache = new WeakMap(),
    snapshots = new WeakMap();
  const epoch = randomUUID();
  let revision = 0;
  const index = (session) => {
    const events = session.snapshotEvents(),
      inherited = Number(session.inheritedEventCount) || 0;
    let saved = cache.get(session);
    if (
      !saved ||
      saved.inherited !== inherited ||
      events.length < saved.offset ||
      events[0] !== saved.first ||
      (saved.offset && events[saved.offset - 1] !== saved.last)
    ) {
      saved = {
        projection: createActivityProjection(),
        messages: createMessageIndex(),
        offset: inherited,
        inherited,
        first: events[0],
        views: new Map(),
      };
      cache.set(session, saved);
    }
    if (saved.events === events) return saved;
    for (let offset = saved.offset; offset < events.length; offset++) {
      saved.projection.append(events[offset]);
      saved.messages.append(events[offset]);
    }
    saved.events = events;
    saved.offset = events.length;
    saved.last = events.at(-1);
    saved.views.clear();
    return saved;
  };
  const fold = (session, compact = false) => {
    const saved = index(session);
    if (saved.views.has(compact)) return saved.views.get(compact);
    const page = saved.messages.page({ textLimit: 160 });
    const value = {
      ...saved.projection.snapshot({ includeText: !compact }),
      cwd: session.header?.cwd || "",
      messages: page.items,
      messageCount: page.total,
      hasMoreMessages: page.hasMore,
      messageBefore: page.before,
    };
    if (compact) {
      value.summaryTruncated ||= value.summary.length > 160;
      value.summary = cleanText(value.summary, 160);
      value.todos = value.todos.map((item) => ({
        ...item,
        label: item.label.slice(0, 160),
      }));
      value.operationCount = value.operations.length;
      value.operations = value.operations.slice(-128);
      value.detailsOnDemand = true;
    }
    saved.views.set(compact, value);
    return value;
  };
  const observe = (session, event) => {
    if (
      !session?.header?.parentSession ||
      session.header.origin !== "subagent" ||
      event?.type !== "turn/end" ||
      typeof session.snapshotEvents !== "function"
    )
      return;
    const id = session.header.id || session.id;
    completed.delete(id);
    completed.set(id, {
      parentId: session.header.parentSession,
      value: fold(session, true),
    });
    if (completed.size > 200) completed.delete(completed.keys().next().value);
  };
  const settled = (info) => {
    const old = completed.get(info?.id);
    if (!old) return;
    // Provider-level failures can follow a completed child turn.
    if (info.stopReason === "error")
      old.value = {
        ...old.value,
        stage: "error",
        phase: "error",
        label: "子任务执行失败",
      };
    const summary = publicText(info.lastAssistantMessage, 6000);
    if (summary) old.value = { ...old.value, summary };
  };
  const read = (sessionId, { compact = true } = {}) => {
    const session = getSessions()?.get(sessionId);
    if (!session || typeof session.snapshotEvents !== "function")
      return { ok: false, sessionId, message: "会话尚未载入，请稍后重试。" };
    const activity = fold(session, compact);
    const versions = [];
    const children = (activity.catalog || activity.children).flatMap(
      (child) => {
        const live = getSessions()?.get(child.id);
        const valid =
          live?.header?.origin === "subagent" &&
          live.header.parentSession === sessionId;
        const saved = completed.get(child.id);
        const value = valid
          ? fold(live, compact)
          : saved?.parentId === sessionId
            ? saved.value
            : null;
        versions.push(value);
        const ongoing =
          value &&
          (value.stage === "waiting" ||
            value.stage === "paused" ||
            (value.startedAt != null &&
              value.endedAt == null &&
              !["idle", "unknown", "done", "stopped", "error"].includes(
                value.stage,
              )));
        const recent =
          value &&
          activity.startedAt != null &&
          ((value.startedAt != null && value.startedAt >= activity.startedAt) ||
            (value.endedAt != null && value.endedAt >= activity.startedAt));
        if (
          !activity.children.some((c) => c.id === child.id) &&
          !ongoing &&
          !recent
        )
          return [];
        return [
          {
            ...child,
            label: compact ? (child.label || "").slice(0, 160) : child.label,
            stage: value?.stage || "unknown",
            summary: compact
              ? (value?.summary || "").slice(0, 160)
              : value?.summary || "",
            summaryTruncated: !!value?.summaryTruncated,
            current:
              compact && value?.current
                ? { ...value.current, result: "" }
                : value?.current || null,
            detailAvailable: !!value,
            operations: compact ? [] : value?.operations || [],
            endedAt: value?.endedAt || null,
            updatedAt: value?.updatedAt || null,
          },
        ];
      },
    );
    const old = snapshots.get(session);
    if (
      old?.activity === activity &&
      versions.length === old.versions.length &&
      versions.every((v, i) => v === old.versions[i])
    )
      return old.response;
    const response = {
      ok: true,
      sessionId,
      activity: {
        ...activity,
        ...(compact ? { catalog: undefined } : {}),
        children,
      },
      epoch,
      revision: ++revision,
      updatedAt: Date.now(),
    };
    snapshots.set(session, { activity, versions, response });
    return response;
  };
  const messages = (sessionId, before) => {
    const session = getSessions()?.get(sessionId);
    if (!session || !Number.isSafeInteger(before) || before < 0)
      return { ok: false };
    return {
      ok: true,
      sessionId,
      ...index(session).messages.page({ before, textLimit: 160 }),
    };
  };
  const detail = (sessionId, target) => {
    const session = getSessions()?.get(sessionId);
    if (!session || typeof target !== "string" || target.length > 512)
      return { ok: false, sessionId };
    let value, operation;
    if (target.startsWith("child:")) {
      const id = target.slice(6),
        child = getSessions()?.get(id);
      const parent = fold(session, true);
      if (!(parent.catalog || parent.children).some((item) => item.id === id))
        return { ok: false, sessionId };
      value =
        child?.header?.origin === "subagent" &&
        child.header.parentSession === sessionId
          ? fold(child)
          : completed.get(id)?.parentId === sessionId
            ? completed.get(id).value
            : null;
    } else {
      value = fold(session);
      operation =
        value.operations.find((item) => item.id === target) ||
        (value.current?.id === target ? value.current : null);
    }
    if (!value) return { ok: false, sessionId };
    return {
      ok: true,
      sessionId,
      target,
      text:
        target.startsWith("child:") || target === "result"
          ? value.summary
          : operation?.result || "",
      truncated:
        target.startsWith("child:") || target === "result"
          ? value.summaryTruncated
          : operation?.truncated || false,
    };
  };
  return { read, observe, settled, messages, detail };
}
