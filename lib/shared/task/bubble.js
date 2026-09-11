import { element, t, number } from "../i18n.js";
import { statusName } from "./status.js";
/**
 * @description Create the compact speech bubble for live task progress.
 * @param {object} React Host React instance.
 * @param {Function} icon Status icon renderer.
 * @returns {Function} Bubble component.
 */
export function createTaskBubble(React, icon) {
  const h = (type, props, ...children) =>
    element(React, type, props, ...children);
  function Bubble({ state, onOpen, shell }) {
    const a = state.data;
    if (!state.sessionId || (!state.loading && !a?.startedAt && !state.error))
      return null;
    const children = a?.children || [],
      done = children.filter((c) => c.stage === "done").length,
      running = children.filter(
        (c) =>
          ![
            "done",
            "error",
            "stopped",
            "unknown",
            "idle",
            "waiting",
            "paused",
          ].includes(c.stage),
      ).length;
    const important = [
      "waiting",
      "error",
      "done",
      "stopped",
      "paused",
    ].includes(a?.stage);
    const label = state.error
      ? "进展同步中断"
      : state.loading
        ? "正在读取任务"
        : !important && children.length
          ? t("子任务 {done}/{total} 完成", {
              total: number(children.length),
              done: number(done),
            })
          : t(statusName(a?.stage));
    const context =
      !important && children.length
        ? t("{count} 个执行中", { count: number(running) })
        : important
          ? a?.stage === "paused"
            ? "谷价到来后自动续跑"
            : a?.stage === "done"
              ? "点击查看本轮结果"
              : a?.attention?.label ||
                a?.current?.description ||
                a?.error ||
                "点击查看任务进展"
          : a?.current?.description ||
            a?.current?.path?.split(/[\\/]/).pop() ||
            a?.todos?.find((item) => item.status === "in_progress")?.label ||
            a?.title ||
            "点击查看任务进展";
    return h(
      "button",
      {
        type: "button",
        className: "dsh-kujira-bubble kj-task-bubble",
        "data-stage": a?.stage || "thinking",
        "aria-label": t("查看任务进展"),
        "aria-haspopup": "dialog",
        "aria-expanded": false,
        onClick: onOpen,
      },
      h(
        "span",
        { className: "kj-task-symbol" },
        icon(state.error ? "error" : a?.stage, true),
      ),
      h(
        "span",
        { className: "kj-task-bubble-copy" },
        h("strong", { "aria-live": important ? "polite" : "off" }, label),
        h("span", null, context),
      ),
      h("span", { className: "kj-task-open", "aria-hidden": true }, "›"),
      shell,
    );
  }
  return Bubble;
}
