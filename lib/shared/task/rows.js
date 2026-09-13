import { element, t } from "../i18n.js";
import { createClampedText, projectPath, fileLabel } from "./text.js";
import { compactStatus, isActiveStage } from "./status.js";
/**
 * @description Render compact task rows with local details and capability-checked host actions.
 * @param {object} options Shared renderers, navigation and disclosure state.
 * @returns {object} Action and row factories.
 */
export function createTaskRows({
  React,
  Text: SharedText,
  markdown,
  icon,
  detail,
  setDetail,
  busy,
  open,
  canOpen,
  sessionId,
  cwd = "",
}) {
  const h = (type, props, ...children) =>
    element(React, type, props, ...children);
  const Text = SharedText || createClampedText(React);
  const action = (label, target, onClick, options = {}) => {
    if (!onClick && !canOpen(target)) return null;
    return h(
      "button",
      {
        type: "button",
        className: "kj-task-link",
        disabled: busy,
        "aria-label": options.file ? fileLabel(target.path).name : undefined,
        "data-tooltip": options.file
          ? options.fullText || target.path
          : undefined,
        "data-tooltip-long": options.file ? "true" : undefined,
        onClick: onClick || (() => open(target)),
      },
      h(Text, {
        className: "kj-task-link-copy",
        tabIndex: -1,
        text: options.file ? fileLabel(target.path).stem : t(label),
        fullText: options.fullText || t(label),
        excerpted: options.excerpted || false,
        lines: options.lines || 2,
      }),
      options.file && fileLabel(target.path).extension
        ? h(
            "span",
            { className: "kj-file-extension", "aria-label": t("文件类型") },
            fileLabel(target.path).extension,
          )
        : null,
      h(
        "span",
        { className: "kj-task-link-icon", "aria-hidden": true },
        icon(onClick ? "next" : "open"),
      ),
    );
  };
  const operation = (op) => {
    const expanded = detail === op.id;
    const title =
      {
        reading: "读取资料",
        searching: "检索信息",
        editing: "修改文件",
        testing: "运行检查",
        delegating: "分配子任务",
        waiting: "用户回复",
      }[op.stage] ||
      op.name ||
      "执行工具";
    return h(
      "div",
      { key: op.id, className: "kj-task-operation", "data-status": op.status },
      h(
        "button",
        {
          type: "button",
          className: "kj-task-operation-head",
          "aria-expanded": expanded,
          onClick: () => setDetail(expanded ? null : op.id),
        },
        icon(
          op.status === "running" ? op.stage : op.status,
          op.status === "running",
        ),
        h(
          "span",
          { className: "kj-task-operation-copy" },
          h(Text, { as: "strong", text: t(title), lines: 2, tabIndex: -1 }),
          op.path || op.description
            ? h(Text, {
                className: "kj-task-path",
                tabIndex: -1,
                text: op.path ? projectPath(op.path, cwd) : op.description,
                fullText: op.path || op.description,
                lines: 1,
              })
            : null,
        ),
        h(
          "span",
          {
            className:
              "kj-task-status" +
              (["running", "done", "completed"].includes(op.status)
                ? " kj-visually-hidden"
                : ""),
          },
          compactStatus(op.status),
        ),
        h(
          "span",
          { className: "kj-task-row-chevron", "aria-hidden": true },
          icon("chevron"),
        ),
      ),
      expanded
        ? h(
            "div",
            { className: "kj-task-operation-detail" },
            op.name && title !== op.name
              ? h("code", { className: "kj-task-tool" }, op.name)
              : null,
            op.path
              ? h(Text, {
                  className: "kj-task-path",
                  text: projectPath(op.path, cwd),
                  fullText: op.path,
                  lines: 2,
                })
              : null,
            op.result
              ? markdown(op.result, op.id)
              : h(
                  "p",
                  { className: "kj-task-caption" },
                  op.status === "running"
                    ? "等待工具返回结果"
                    : op.status === "paused"
                      ? "谷价到来后自动续跑"
                      : "本步骤没有文字结果",
                ),
            op.truncated
              ? h(
                  "p",
                  { className: "kj-task-caption" },
                  "显示摘要，完整内容请查看会话",
                )
              : null,
            op.path
              ? action("打开文件", { kind: "file", path: op.path })
              : null,
          )
        : null,
    );
  };
  const childTarget = (child) => ({
    kind: "child",
    id: child.id,
    mode: child.mode,
    parentId: sessionId,
  });
  const childRow = (child) =>
    h(
      "div",
      { key: child.id, className: "kj-task-child", "data-stage": child.stage },
      h(
        "div",
        { className: "kj-task-child-heading" },
        icon(child.stage, isActiveStage(child.stage)),
        h(Text, { as: "strong", text: child.label || t("子任务"), lines: 2 }),
        h(
          "span",
          {
            className:
              "kj-task-status" +
              (isActiveStage(child.stage) || child.stage === "done"
                ? " kj-visually-hidden"
                : ""),
          },
          compactStatus(child.stage),
        ),
      ),
      h(
        "div",
        { className: "kj-task-actions" },
        child.summary
          ? action(
              ["done", "error", "stopped"].includes(child.stage)
                ? "查看结果"
                : "查看进展",
              null,
              () => setDetail("child:" + child.id),
            )
          : action(
              ["waiting", "error"].includes(child.stage)
                ? "前往处理"
                : "打开子代理",
              childTarget(child),
            ),
      ),
    );
  return { action, operation, childRow, childTarget };
}
