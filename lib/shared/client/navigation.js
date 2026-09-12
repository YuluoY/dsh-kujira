import {
  revealMessage,
  captureChatPosition,
  restoreChatPosition,
} from "./message-navigation.js";
/**
 * @description Resolve task result, file and child-agent navigation through the host APIs.
 * @param {object} dependencies Explicit runtime and state dependencies.
 * @returns {object} Public values for the composing component.
 */
export function createNavigation({ taskRuntime, ctx, history = [] }) {
  const service = (name) => {
    try {
      return ctx.get(name);
    } catch {
      return undefined;
    }
  };
  const remember = (entry) => {
    while (history.length && history.at(-1).to !== entry.from) history.pop();
    history.push(entry);
    if (history.length > 20) history.shift();
  };
  const navigateTask = async (target) => {
    if (!navigateTask.canOpen(target)) return false;
    if (target.sessionId !== taskRuntime?.snapshot().sessionId) return false;
    const sessions = service("sessions");
    if (target.kind === "back") {
      const entry = navigateTask.backTarget();
      if (!entry) return false;
      if (entry.kind === "message") {
        if (!restoreChatPosition(entry.position)) return false;
      } else if (entry.fromAddress) {
        await sessions.openSubagent(entry.fromAddress);
      } else {
        await sessions.open(entry.from);
      }
      if (history.at(-1) === entry) history.pop();
      return true;
    }
    if (target.kind === "message") {
      const position = captureChatPosition();
      const ok = await revealMessage(target, {
        sessions,
        isCurrent: () =>
          !target.signal?.aborted &&
          target.sessionId === taskRuntime?.snapshot().sessionId &&
          (!sessions?.list?.getSnapshot ||
            sessions.list.getSnapshot().current === target.sessionId),
      });
      if (ok && position)
        remember({
          kind: "message",
          from: target.sessionId,
          to: target.sessionId,
          position,
        });
      return ok;
    }
    if (target.kind === "child") {
      if (
        target.parentId !== target.sessionId ||
        target.id === target.sessionId
      )
        return false;
      if (!sessions?.openSubagent) return false;
      const address = {
        parentSessionId: target.parentId,
        childSessionId: target.id,
        mode: target.mode,
      };
      const sourceAddress =
        sessions.subagentAddress?.(target.sessionId) ||
        history.findLast((item) => item.to === target.sessionId)?.toAddress;
      const entry = {
        kind: "child",
        from: target.sessionId,
        to: target.id,
        fromAddress: sourceAddress,
        toAddress: address,
      };
      remember(entry);
      try {
        await sessions.openSubagent(address);
      } catch (error) {
        if (history.at(-1) === entry) history.pop();
        throw error;
      }
      return true;
    }
    const current = taskRuntime?.snapshot().sessionId;
    if (!current) return false;
    if (target.kind === "file") {
      const sidebar = service("sidebarRight");
      if (!sidebar?.openResource) return false;
      const path = target.path.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
      await sidebar.openResource(
        "dsh-resource://file/session/" +
          encodeURIComponent(current) +
          "/" +
          path.split("/").map(encodeURIComponent).join("/"),
      );
      return true;
    }
    return false;
  };
  navigateTask.backTarget = () => {
    const current = taskRuntime?.snapshot().sessionId;
    const sessions = service("sessions");
    let entry = history.at(-1);
    if (!entry || entry.to !== current) {
      const address = current && sessions?.subagentAddress?.(current);
      if (!address?.parentSessionId) return null;
      entry = {
        kind: "child",
        from: address.parentSessionId,
        to: current,
        fromAddress: sessions.subagentAddress?.(address.parentSessionId),
      };
    }
    if (
      sessions?.list?.getSnapshot &&
      sessions.list.getSnapshot().current !== current
    )
      return null;
    if (entry.kind === "message") return entry;
    if (entry.fromAddress)
      return typeof sessions?.openSubagent === "function" ? entry : null;
    return typeof sessions?.open === "function" ? entry : null;
  };
  navigateTask.canOpen = (target) => {
    if (target?.kind === "back") return !!navigateTask.backTarget();
    if (target?.kind === "message")
      return (
        typeof target.key === "string" &&
        !!target.key &&
        Number.isSafeInteger(target.seq) &&
        target.seq >= 0 &&
        typeof service("sessions")?.binding === "function"
      );
    if (target?.kind === "child")
      return (
        !!target.id &&
        ["one-shot", "continuable"].includes(target.mode) &&
        typeof service("sessions")?.openSubagent === "function"
      );
    if (target?.kind === "file")
      return (
        typeof target.path === "string" &&
        !!target.path.trim() &&
        typeof service("sidebarRight")?.openResource === "function"
      );
    return false;
  };
  return { navigateTask };
}
