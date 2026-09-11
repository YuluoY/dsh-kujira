import { element, t } from "../i18n.js";
import { compactStatus, fileName, statusName } from "./status.js";
/**
 * @description Build consistent progress rows with inline tool metadata and secondary actions.
 * @param {object} dependencies React, shared controls and navigation state.
 * @returns {object} Row renderers and action factory.
 */
export function createTaskRows({
  React,
  HelpLabel,
  icon,
  detail,
  setDetail,
  busy,
  open,
  brief,
  sessionId,
}) {
  const h = (type, props, ...children) =>
    element(React, type, props, ...children);
  const action = (label, target, onClick) =>
    h(
      "button",
      {
        type: "button",
        className: "kj-task-link",
        "aria-busy": busy || undefined,
        disabled: busy,
        onClick: onClick || (() => open(target)),
      },
      h("span", { className: "kj-task-link-copy" }, label),
      h(
        "span",
        { className: "kj-task-link-icon", "aria-hidden": true },
        icon(onClick ? "next" : "open"),
      ),
    );
  const operation = (op, scope = "history") => {
    const expanded = detail === op.id;
    const title =
      {
        reading: "读取资料",
        searching: "检索信息",
        editing: "修改文件",
        testing: "验证结果",
        delegating: "分配子任务",
        waiting: "用户回复",
      }[op.stage] || "执行工具";
    const path = fileName(op.path);
    return h(
      "div",
      { key: op.id, className: "kj-task-operation", "data-status": op.status },
      h(
        "button",
        {
          type: "button",
          className: "kj-task-operation-head",
          "aria-expanded": expanded,
          "aria-controls": "kj-task-result-" + scope + "-" + op.id,
          onClick: () => setDetail(expanded ? null : op.id),
        },
        icon(
          op.status === "running" ? op.stage : op.status,
          scope === "current" && op.status === "running",
        ),
        h(
          "span",
          { className: "kj-task-operation-copy" },
          h(
            "span",
            { className: "kj-task-operation-title" },
            h("strong", null, title),
          ),
          path ? h("span", { className: "kj-task-path" }, path) : null,
        ),
        h("span", { className: "kj-task-status" }, compactStatus(op.status)),
        h(
          "span",
          { className: "kj-task-row-chevron", "aria-hidden": true },
          icon("chevron"),
        ),
      ),
      expanded
        ? h(
            "div",
            {
              id: "kj-task-result-" + scope + "-" + op.id,
              className: "kj-task-operation-detail",
            },
            op.name
              ? h(
                  "div",
                  { className: "kj-task-tool-meta" },
                  h("span", null, "工具"),
                  h("code", { className: "kj-task-tool" }, op.name),
                )
              : null,
            op.path || op.description
              ? h(
                  "div",
                  { className: "kj-task-detail-meta" },
                  h(HelpLabel, {
                    label: "工具信息",
                    help: [op.path, op.description].filter(Boolean).join("\n"),
                  }),
                )
              : null,
            h("p", null, op.result || t("等待工具返回结果")),
            op.truncated
              ? h(
                  "p",
                  { className: "kj-task-caption" },
                  "显示摘要，完整内容请查看会话",
                )
              : null,
            h(
              "div",
              { className: "kj-task-actions" },
              op.path
                ? action("打开文件", { kind: "file", path: op.path })
                : null,
              action("定位会话步骤", { kind: "turn", turn: op.turn }),
            ),
          )
        : null,
    );
  };
  const childRow = (child) =>
    h(
      "div",
      { className: "kj-task-child", key: child.id, "data-stage": child.stage },
      h(
        "div",
        { className: "kj-task-child-heading" },
        icon(child.stage),
        h(HelpLabel, {
          label: child.label || t("子任务"),
          help:
            brief(child.summary) ||
            child.current?.path ||
            t(statusName(child.stage)),
        }),
        h("span", { className: "kj-task-status" }, compactStatus(child.stage)),
      ),
      ["error", "waiting"].includes(child.stage)
        ? h(
            "p",
            { className: "kj-task-attention" },
            brief(child.summary) || t(statusName(child.stage)),
          )
        : null,
      h(
        "div",
        { className: "kj-task-actions" },
        child.summary
          ? action("查看结果", null, () => setDetail("child:" + child.id))
          : null,
        action("打开子代理", {
          kind: "child",
          id: child.id,
          mode: child.mode,
          parentId: sessionId,
        }),
      ),
    );
  return { action, operation, childRow };
}
