/**
 * @description Resolve task result, file and child-agent navigation through the host APIs.
 * @param {object} dependencies Explicit runtime and state dependencies.
 * @returns {object} Public values for the composing component.
 */
export function createNavigation({ taskRuntime, ctx }) {
  const navigateTask = async (target) => {
    if (!navigateTask.canOpen(target)) return false;
    if (target.sessionId !== taskRuntime?.snapshot().sessionId) return false;
    if (ctx.previewNavigation) return ctx.previewNavigation(target);
    const sessions = ctx.get?.("sessions") || ctx.sessions;
    if (target.kind === "child") {
      if (!sessions?.openSubagent) return false;
      await sessions.openSubagent({
        parentSessionId: target.parentId,
        childSessionId: target.id,
        mode: target.mode,
      });
      return true;
    }
    const current = taskRuntime?.snapshot().sessionId;
    if (!current) return false;
    if (target.kind === "file") {
      const sidebar = ctx.get?.("sidebarRight") || ctx.sidebarRight;
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
  navigateTask.canOpen = (target) => {
    if (target?.kind === "child")
      return (
        !!target.id &&
        ["one-shot", "continuable"].includes(target.mode) &&
        (!!ctx.previewNavigation ||
          typeof (ctx.get?.("sessions") || ctx.sessions)?.openSubagent ===
            "function")
      );
    if (target?.kind === "file")
      return (
        typeof target.path === "string" &&
        !!target.path.trim() &&
        (!!ctx.previewNavigation ||
          typeof (ctx.get?.("sidebarRight") || ctx.sidebarRight)
            ?.openResource === "function")
      );
    return false;
  };
  return { navigateTask };
}
