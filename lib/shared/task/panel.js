import { createTaskTabs } from "./tabs.js";
import { element, t, number } from "../i18n.js";
import { createControls } from "../panel-controls.js";
import { statusName } from "./status.js";
import { taskPresentation } from "./presentation.js";
import { createTaskList } from "./list.js";
import { createMarkdown, markdownExcerpt } from "./markdown.js";
import { createTaskRows } from "./rows.js";
/**
 * @description Show the current task, attention and outcome before optional supporting records.
 * @param {object} React Host React instance.
 * @param {Function} icon Shared status renderer.
 * @returns {Function} Task overview panel.
 */
export function createTaskPanel(React, icon) {
  const h = (type, props, ...children) =>
    element(React, type, props, ...children);
  const { Skeleton, HelpLabel } = createControls(React);
  const Tabs = createTaskTabs(React);
  const TaskList = createTaskList(React),
    Markdown = createMarkdown(React);
  return function Panel({ state, onClose, shell }) {
    const a = taskPresentation(state.data);
    const [detail, setDetail] = React.useState(null),
      [notice, setNotice] = React.useState(""),
      [busy, setBusy] = React.useState(false);
    const panel = React.useRef(null),
      body = React.useRef(null),
      previous = React.useRef(null),
      alive = React.useRef(true);
    const [tab, setTab] = React.useState(null),
      [limits, setLimits] = React.useState({});
    const scrollMemory = React.useRef({});
    const child = a?.children.find((item) => detail === "child:" + item.id);
    const resultView = detail === "result" || !!child;
    React.useEffect(() => {
      setDetail(null);
      setNotice("");
      setTab(null);
      setLimits({});
      scrollMemory.current = {};
      if (body.current) body.current.scrollTop = 0;
    }, [state.sessionId, a?.startedAt]);
    React.useEffect(() => {
      if (resultView) {
        if (body.current) body.current.scrollTop = 0;
        panel.current?.querySelector("button")?.focus();
      }
    }, [resultView]);
    React.useEffect(() => {
      alive.current = true;
      previous.current = document.activeElement;
      panel.current?.querySelector("button")?.focus();
      return () => {
        alive.current = false;
        if (previous.current?.isConnected) previous.current.focus();
      };
    }, []);
    const canOpen = (target) => !!state.navigate?.canOpen?.(target);
    const open = async (target) => {
      if (busy || !canOpen(target)) return;
      setBusy(true);
      setNotice("");
      try {
        const ok = await state.navigate({
          ...target,
          sessionId: state.sessionId,
        });
        if (alive.current) {
          if (ok) onClose();
          else setNotice("此入口在当前宿主不可用，已保留详情供查看");
        }
      } catch {
        if (alive.current) setNotice("打开失败，请稍后重试");
      } finally {
        if (alive.current) setBusy(false);
      }
    };
    const markdown = (text) =>
      h(Markdown, {
        text,
        onOpenFile: canOpen({ kind: "file", path: "." })
          ? (path) => open({ kind: "file", path })
          : undefined,
      });
    const { action, operation, childRow, childTarget } = createTaskRows({
      React,
      markdown,
      icon,
      detail,
      setDetail,
      busy,
      open,
      canOpen,
      sessionId: state.sessionId,
    });
    const list = (id, items, renderItem, options = {}) =>
      h(TaskList, {
        key: state.sessionId + ":" + a.startedAt + ":" + id,
        items,
        renderItem,
        limit: limits[id] || 8,
        onShowMore: (count) => setLimits((old) => ({ ...old, [id]: count })),
        ...options,
      });
    const category = (id, label, count, content) => ({
      id,
      label,
      count,
      content,
      attention:
        id === "team" &&
        a.children.some((child) => ["waiting", "error"].includes(child.stage)),
    });
    const overview = () =>
      h(
        "div",
        { className: "kj-task-overview", "data-stage": a.stage },
        h(
          "div",
          { className: "kj-task-phase" },
          icon(a.stage, true),
          h("span", null, statusName(a.stage)),
          a.children.length
            ? h(
                "span",
                {
                  className: "kj-task-team-progress",
                  "data-tooltip": t("子任务 {done}/{total} 完成", {
                    done: number(
                      a.children.filter((child) => child.stage === "done")
                        .length,
                    ),
                    total: number(a.children.length),
                  }),
                },
                t("协作") +
                  " " +
                  number(
                    a.children.filter((child) => child.stage === "done").length,
                  ) +
                  "/" +
                  number(a.children.length),
              )
            : null,
        ),
        a.title
          ? h(
              "div",
              { className: "kj-task-goal-brief" },
              h(HelpLabel, {
                label: markdownExcerpt(state.preview ? t(a.title) : a.title),
                help: a.title.length > 70 ? a.title : undefined,
              }),
            )
          : null,
        a.attention || a.error
          ? h(
              "p",
              { className: "kj-task-attention" },
              a.attention?.label || a.error,
            )
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
        a.tasks?.total
          ? h(
              "div",
              { className: "kj-task-progress" },
              h(
                "div",
                { className: "kj-task-progress-heading" },
                h(HelpLabel, {
                  label: "计划进度",
                  help: "仅按已上报的计划项统计，不代表整个任务的完成百分比。",
                }),
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
      if (resultView)
        return h(
          "div",
          { className: "kj-task-result" },
          child ? h("h3", null, child.label || t("子任务")) : null,
          markdown(
            child
              ? child.summary || t("等待子任务进展")
              : a.summary || t("本轮未返回文字结果"),
          ),
          child?.summaryTruncated || (!child && a.summaryTruncated)
            ? h(
                "p",
                { className: "kj-task-caption" },
                "显示摘要，完整内容请查看会话",
              )
            : null,
          child
            ? action("打开子代理", childTarget(child))
            : action("返回会话", null, onClose),
        );
      const categories = [
        a.children.length
          ? category(
              "team",
              "协作",
              a.children.length,
              list("team", a.children, childRow),
            )
          : null,
        a.todos.length
          ? category(
              "plan",
              "计划",
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
                          : todo.status === "cancelled"
                            ? "stopped"
                            : "idle",
                    ),
                    h(
                      "span",
                      {
                        tabIndex: todo.label?.length > 90 ? 0 : undefined,
                        "data-tooltip":
                          todo.label?.length > 90 ? todo.label : undefined,
                      },
                      todo.label,
                    ),
                  ),
                { listTag: "ol", listClass: "kj-task-plan" },
              ),
            )
          : null,
        a.artifacts.length
          ? category(
              "files",
              "文件",
              a.artifacts.length,
              list("files", a.artifacts, (file) =>
                h(
                  "div",
                  { className: "kj-task-file", key: file.path },
                  action(file.path, { kind: "file", path: file.path }) ||
                    h("code", { className: "kj-task-path" }, file.path),
                ),
              ),
            )
          : null,
        a.records.length
          ? category(
              "steps",
              "记录",
              a.records.length,
              list("steps", a.records, operation),
            )
          : null,
      ].filter(Boolean);
      return h(
        React.Fragment,
        null,
        overview(),
        h(Tabs, {
          items: categories,
          value: tab,
          onChange: setTab,
          scrollMemory,
        }),
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
            resultView ? setDetail(null) : onClose();
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
            resultView
              ? child
                ? child.stage === "done"
                  ? "子任务结果"
                  : "子任务进展"
                : a?.stage === "done"
                  ? "本轮结果"
                  : "本轮进展"
              : "任务进展",
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
        {
          className: "kj-body",
          "data-detail": resultView ? "true" : undefined,
          ref: body,
        },
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

/**
 * @description Isolate task-detail rendering failures from the companion overlay.
 * @param {object} React Host React instance.
 * @returns {Function} Recoverable task-panel boundary.
 */
export function createTaskBoundary(React) {
  const h = (type, props, ...children) =>
    element(React, type, props, ...children);
  return class TaskBoundary extends React.Component {
    state = { failed: false };
    static getDerivedStateFromError() {
      return { failed: true };
    }
    componentDidCatch() {
      console.warn(
        "[dsh-kujira] Task details could not render; companion retained.",
      );
    }
    render() {
      if (!this.state.failed) return this.props.children;
      return h(
        "div",
        {
          className: "dsh-kujira-panel kj-task-panel",
          "data-panel": "activity",
          role: "dialog",
          "aria-label": "任务进展",
          onKeyDown: (event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              this.props.onClose();
            }
          },
        },
        this.props.shell,
        h(
          "header",
          { className: "kj-head" },
          h("strong", { className: "kj-title" }, "任务进展"),
          h(
            "button",
            {
              type: "button",
              className: "kj-task-link",
              onClick: this.props.onClose,
            },
            "关闭任务进展",
          ),
        ),
        h(
          "div",
          { className: "kj-body", "data-detail": "true" },
          h(
            "p",
            { className: "kj-task-notice", role: "status" },
            "任务详情暂时无法显示",
          ),
          h(
            "button",
            {
              type: "button",
              className: "kj-task-link",
              autoFocus: true,
              onClick: () => this.setState({ failed: false }),
            },
            "重试",
          ),
        ),
      );
    }
  };
}
