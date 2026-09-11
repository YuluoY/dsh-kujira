/**
 * @description Resolve task result, file and child-agent navigation through the host APIs.
 * @param {object} dependencies Explicit runtime and state dependencies.
 * @returns {object} Public values for the composing component.
 */
export function createNavigation({ taskRuntime, ctx }) {
  const navigateTask = async (target) => {
    if (target.sessionId !== taskRuntime?.snapshot().sessionId) return false;
    if (ctx.previewNavigation) return ctx.previewNavigation(target);
    const sessions = ctx.get?.("sessions") || ctx.sessions;
    if (target.kind === "child") {
      if (!sessions?.openSubagent) return false;
      sessions.openSubagent({
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
      sidebar.openResource(
        "dsh-resource://file/session/" +
          encodeURIComponent(current) +
          "/" +
          path.split("/").map(encodeURIComponent).join("/"),
      );
      return true;
    }
    if (target.kind === "turn" && Number.isSafeInteger(target.turn)) {
      const rows = [
        ...document.querySelectorAll('[data-chat-turn="' + target.turn + '"]'),
      ];
      const row = rows.find((el) => el.getClientRects().length && !el.hidden);
      if (!row) return false;
      row.scrollIntoView({
        block: "center",
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
      row.classList.add("kj-task-located");
      setTimeout(() => row.classList.remove("kj-task-located"), 1600);
      return true;
    }
    return false;
  };
  return { navigateTask };
}
