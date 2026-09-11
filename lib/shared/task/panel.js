import { element, t, number } from "../i18n.js";
import { createControls } from "../panel-controls.js";
import { statusName } from "./status.js";
import { taskPresentation } from "./presentation.js";
import { createTaskList } from "./list.js";
import { createTaskRows } from "./rows.js";
/**
 * @description Create the task panel with a brief overview and progressively disclosed details.
 * @param {object} React Host React instance.
 * @param {Function} icon Shared task icon renderer.
 * @returns {Function} Task panel component.
 */
export function createTaskPanel(React, icon) {
  const h = (type, props, ...children) =>
    element(React, type, props, ...children);
  const { useState, useEffect, useRef } = React;
  const { Skeleton, Disclosure, HelpLabel } = createControls(React);
  const TaskList = createTaskList(React);
  return function Panel({ state, onClose, shell }) {
    const a = taskPresentation(state.data);
    const brief = (text) => {
      const value = state.preview ? t(text || "") : text || "";
      return value.length > 240 ? value.slice(0, 240) + "…" : value;
    };
    const help = (label, copy) => h(HelpLabel, { label, help: copy });
    const [detail, setDetail] = useState(null),
      [notice, setNotice] = useState(""),
      [busy, setBusy] = useState(false);
    const selectedChild = a?.children.find(
      (child) => "child:" + child.id === detail,
    );
    const resultView = detail === "result" || !!selectedChild;
    const body = useRef(null),
      panel = useRef(null),
      previous = useRef(null);
    useEffect(() => {
      setDetail(null);
      setNotice("");
      if (body.current) body.current.scrollTop = 0;
    }, [state.sessionId, a?.startedAt]);
    useEffect(() => {
      if (resultView) {
        if (body.current) body.current.scrollTop = 0;
        panel.current?.querySelector("button")?.focus();
      }
    }, [resultView]);
    useEffect(() => {
      previous.current = document.activeElement;
      panel.current?.querySelector("button")?.focus();
      return () => {
        if (previous.current?.isConnected) previous.current.focus();
      };
    }, []);
    const open = async (target) => {
      setNotice("");
      setBusy(true);
      try {
        const ok = await state.navigate?.({
          ...target,
          sessionId: state.sessionId,
        });
        if (!ok) setNotice("此入口在当前宿主不可用，已保留详情供查看");
      } catch {
        setNotice("打开失败，请稍后重试");
      } finally {
        setBusy(false);
      }
    };
    const { action, operation, childRow } = createTaskRows({
      React,
      HelpLabel,
      icon,
      detail,
      setDetail,
      busy,
      open,
      brief,
      sessionId: state.sessionId,
    });
    const accordionName = React.useId();
    const list = (id, items, renderItem, options = {}) =>
      h(TaskList, {
        key: state.sessionId + ":" + a.startedAt + ":" + id,
        items,
        renderItem,
        ...options,
      });
    const disclosure = (id, title, count, content) =>
      h(
        Disclosure,
        { key: id, label: title, count, name: accordionName },
        content,
      );
    const overview = () =>
      h(
        "div",
        { className: "kj-task-overview", "data-stage": a.stage },
        a.current
          ? h(
              "div",
              { className: "kj-task-current" },
              operation(a.current, "current"),
            )
          : h(
              "div",
              { className: "kj-task-phase" },
              icon(a.stage, true),
              h("span", null, statusName(a.stage)),
            ),
        a.attention || a.error
          ? h(
              "p",
              { className: "kj-task-attention" },
              a.attention?.label || a.error,
            )
          : null,
        a.stage === "waiting"
          ? action("前往处理", {
              kind: "turn",
              turn: a.attention?.turn || a.turn,
            })
          : null,
        a.summary && ["done", "error", "stopped"].includes(a.stage)
          ? h(
              "div",
              { className: "kj-task-result-preview" },
              h("p", null, a.summary),
              action("查看结果", null, () => setDetail("result")),
            )
          : null,
        a.tasks?.total
          ? h(
              "div",
              { className: "kj-task-progress" },
              h(
                "div",
                { className: "kj-task-progress-heading" },
                help(
                  "计划进度",
                  t("仅按已上报的计划项统计，不代表整个任务的完成百分比。"),
                ),
                h(
                  "span",
                  null,
                  number(a.tasks.completed) + " / " + number(a.tasks.total),
                ),
              ),
              h(
                "div",
                {
                  role: "progressbar",
                  "aria-label": "计划完成情况",
                  "aria-valuenow": a.tasks.completed,
                  "aria-valuemin": 0,
                  "aria-valuemax": a.tasks.total,
                },
                h("i", {
                  style: {
                    width: (100 * a.tasks.completed) / a.tasks.total + "%",
                  },
                }),
              ),
            )
          : null,
      );
    const content = () => {
      if (state.loading)
        return h(Skeleton, { kind: "growth", label: "正在读取任务" });
      if (!a)
        return h(
          "div",
          { className: "kj-task-empty" },
          h("strong", null, "暂时没有任务进展"),
          h("p", null, "会话产生操作后会在这里显示。"),
        );
      if (selectedChild)
        return h(
          "div",
          { className: "kj-task-result" },
          h("h3", null, selectedChild.label || t("子任务")),
          h("p", null, selectedChild.summary || t("等待子任务进展")),
          action("打开子代理", {
            kind: "child",
            id: selectedChild.id,
            mode: selectedChild.mode,
            parentId: state.sessionId,
          }),
        );
      if (detail === "result")
        return h(
          "div",
          { className: "kj-task-result" },
          h("p", null, a.summary || t("本轮未返回文字结果")),
          a.summaryTruncated
            ? h(
                "p",
                { className: "kj-task-caption" },
                "显示摘要，完整内容请查看会话",
              )
            : null,
          action("定位会话结果", {
            kind: "turn",
            turn: a.summaryLocation?.turn || a.turn,
          }),
        );
      return h(
        React.Fragment,
        null,
        overview(),
        a.children.length
          ? disclosure(
              "team",
              "子代理协作",
              a.children.length,
              list("team", a.children, childRow),
            )
          : null,
        a.todos.length
          ? disclosure(
              "plan",
              "任务计划",
              a.todos.length,
              list(
                "plan",
                a.todos,
                (todo, i) =>
                  h(
                    "li",
                    { key: i, "data-status": todo.status },
                    icon(
                      todo.status === "completed"
                        ? "done"
                        : todo.status === "in_progress"
                          ? "working"
                          : "idle",
                    ),
                    h("span", null, todo.label),
                  ),
                { listTag: "ol", listClass: "kj-task-plan" },
              ),
            )
          : null,
        a.artifacts.length
          ? disclosure(
              "files",
              "修改文件",
              a.artifacts.length,
              list("files", a.artifacts, (file) =>
                h(
                  "div",
                  { className: "kj-task-file", key: file.path },
                  action(file.path, { kind: "file", path: file.path }),
                ),
              ),
            )
          : null,
        a.operations.length
          ? disclosure(
              "steps",
              "执行过程",
              a.operations.length,
              list("steps", a.operations, (op) => operation(op, "history")),
            )
          : null,
        a.title
          ? disclosure(
              "goal",
              "任务目标",
              null,
              h(
                "div",
                { className: "kj-task-goal" },
                h("p", null, a.title),
                a.titleTruncated
                  ? h(
                      "p",
                      { className: "kj-task-caption" },
                      "显示摘要，完整内容请查看会话",
                    )
                  : null,
                action("定位会话步骤", { kind: "turn", turn: a.turn }),
              ),
            )
          : null,
      );
    };
    return h(
      "div",
      {
        ref: panel,
        className: "dsh-kujira-panel kj-task-panel",
        "data-panel": "activity",
        role: "dialog",
        "aria-label": "任务进展",
        onKeyDown: (e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        },
      },
      shell,
      h(
        "header",
        { className: "kj-head" },
        h(
          "div",
          { className: "kj-titles" },
          h(
            "strong",
            { className: "kj-title" },
            resultView ? "本轮结果" : "任务进展",
          ),
          state.preview ? h("span", { className: "kj-sub" }, "模拟会话") : null,
        ),
        h(
          "button",
          {
            type: "button",
            className: "kj-back",
            "aria-label": resultView ? "返回任务进展" : "关闭任务进展",
            "data-tooltip": resultView ? "返回任务进展" : "关闭任务进展",
            onClick: () => (resultView ? setDetail(null) : onClose()),
          },
          icon(resultView ? "back" : "error"),
        ),
      ),
      h(
        "div",
        { className: "kj-body", ref: body },
        content(),
        state.error || notice
          ? h(
              "p",
              { className: "kj-task-notice", role: "status" },
              notice || state.error,
            )
          : null,
      ),
    );
  };
}
