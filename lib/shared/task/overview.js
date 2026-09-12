import { element, t, number } from "../i18n.js";
import { statusName } from "./status.js";
import { markdownExcerpt } from "./markdown.js";
/**
 * @description Keep the latest visible message and measured plan progress compact.
 * @param {object} dependencies Shared panel controls and actions.
 * @returns {Function} Overview renderer.
 */
export function createTaskOverview({
  React,
  icon,
  Text,
  action,
  setDetail,
  open,
  canOpen,
  onClose,
}) {
  const h = (type, props, ...children) =>
    element(React, type, props, ...children);
  return (a, state) => {
    const message = a.messages?.[0];
    const target = message ? { kind: "message", ...message } : null;
    const clickable = target && canOpen(target);
    const title = message?.text || a.title;
    return h(
      "div",
      { className: "kj-task-overview", "data-stage": a.stage },
      h(
        "div",
        { className: "kj-task-phase" },
        h(
          "span",
          {
            "data-tooltip": statusName(a.stage),
            "aria-label": t(statusName(a.stage)),
          },
          icon(a.stage, true),
        ),
        a.stage !== "working" ? h("span", null, statusName(a.stage)) : null,
        a.children.length
          ? h(
              "span",
              { className: "kj-task-team-progress" },
              t("协作") +
                " " +
                number(a.children.filter((x) => x.stage === "done").length) +
                "/" +
                number(a.children.length),
            )
          : null,
      ),
      title
        ? h(
            "div",
            { className: "kj-task-goal-brief" },
            h(Text, {
              as: clickable ? "button" : "span",
              type: clickable ? "button" : undefined,
              className: "kj-task-message-preview",
              text: markdownExcerpt(state.preview ? t(title) : title),
              fullText: title,
              excerpted: markdownExcerpt(title) !== title,
              lines: 2,
              onClick: clickable ? () => open(target) : undefined,
              "aria-label": clickable
                ? t("定位到这条消息") + ": " + markdownExcerpt(title)
                : undefined,
            }),
          )
        : null,
      a.attention || a.error
        ? h(Text, {
            className: "kj-task-attention",
            text: a.attention?.label || a.error,
            lines: 2,
          })
        : null,
      a.stage === "waiting" ? action("返回会话处理", null, onClose) : null,
      a.stage === "paused"
        ? h("p", { className: "kj-task-caption" }, "谷价到来后自动续跑")
        : null,
      a.summary && ["done", "error", "stopped"].includes(a.stage)
        ? h(
            "div",
            { className: "kj-task-result-preview" },
            action(a.stage === "done" ? "查看结果" : "查看进展", null, () =>
              setDetail("result"),
            ),
          )
        : null,
    );
  };
}
