import { messagePage } from "../shared/task/messages.js";
import { randomUUID } from "node:crypto";
import { sessionActivity, publicText } from "../shared/activity.js";
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
  const fold = (session) => {
    const events = session.snapshotEvents(),
      previous = cache.get(session);
    if (
      previous?.events === events &&
      previous.inherited === Number(session.inheritedEventCount || 0)
    )
      return previous.value;
    const inherited = Number(session.inheritedEventCount) || 0;
    const page = messagePage(events, inherited);
    const value = {
      ...sessionActivity(events, inherited),
      cwd: session.header?.cwd || "",
      messages: page.items,
      messageCount: page.total,
      hasMoreMessages: page.hasMore,
      messageBefore: page.before,
    };
    cache.set(session, {
      events,
      value,
      inherited: Number(session.inheritedEventCount || 0),
    });
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
      value: fold(session),
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
  const read = (sessionId) => {
    const session = getSessions()?.get(sessionId);
    if (!session || typeof session.snapshotEvents !== "function")
      return { ok: false, sessionId, message: "会话尚未载入，请稍后重试。" };
    const activity = fold(session);
    const versions = [];
    const children = (activity.catalog || activity.children).flatMap(
      (child) => {
        const live = getSessions()?.get(child.id);
        const valid =
          live?.header?.origin === "subagent" &&
          live.header.parentSession === sessionId;
        const saved = completed.get(child.id);
        const value = valid
          ? fold(live)
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
            stage: value?.stage || "unknown",
            summary: value?.summary || "",
            summaryTruncated: !!value?.summaryTruncated,
            current: value?.current || null,
            operations: value?.operations || [],
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
      activity: { ...activity, children },
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
      ...messagePage(
        session.snapshotEvents(),
        Number(session.inheritedEventCount) || 0,
        { before },
      ),
    };
  };
  return { read, observe, settled, messages };
}
