import { element, t, number } from "../i18n.js";
import { projectPath } from "./text.js";
import { markdownExcerpt } from "./markdown.js";
/**
 * @description Compose task categories using common clamped rows and explicit navigation.
 * @param {object} deps Shared row renderers.
 * @returns {Function} Category builder.
 */
export function createTaskCategories({
  React,
  Text,
  list,
  icon,
  action,
  childRow,
  operation,
  Messages,
  messageMemory,
}) {
  const h = (type, props, ...children) =>
    element(React, type, props, ...children);
  const category = (id, label, items, content, attention = false) =>
    items.length
      ? { id, label, count: items.length, content, attention }
      : null;
  return (a, state) =>
    [
      category(
        "team",
        "协作",
        a.children,
        list("team", a.children, childRow),
        a.children.some((x) => ["waiting", "error"].includes(x.stage)),
      ),
      category(
        "plan",
        "计划",
        a.todos,
        list(
          "plan",
          a.todos,
          (todo, i) =>
            h(
              "li",
              { key: i, "data-status": todo.status },
              h(
                "span",
                {
                  "data-tooltip":
                    todo.status === "in_progress" ? t("执行中") : undefined,
                  "aria-label":
                    todo.status === "in_progress" ? t("执行中") : undefined,
                },
                icon(
                  todo.status === "completed"
                    ? "done"
                    : todo.status === "in_progress"
                      ? "working"
                      : todo.status === "cancelled"
                        ? "stopped"
                        : "idle",
                  todo.status === "in_progress",
                ),
              ),
              h(Text, { text: todo.label, lines: 2 }),
            ),
          { listTag: "ol", listClass: "kj-task-plan" },
        ),
      ),
      category(
        "files",
        "文件",
        a.artifacts,
        list("files", a.artifacts, (file) =>
          h(
            "div",
            { className: "kj-task-file", key: file.path },
            action(
              projectPath(file.path, a.cwd),
              { kind: "file", path: file.path },
              null,
              { fullText: file.path },
            ) ||
              h(Text, {
                text: projectPath(file.path, a.cwd),
                fullText: file.path,
                lines: 2,
              }),
          ),
        ),
      ),
      category("steps", "记录", a.records, list("steps", a.records, operation)),
      a.messages?.length
        ? {
            id: "messages",
            label: "对话",
            count: a.messageCount,
            content: h(Messages, {
              key: state.sessionId,
              activity: a,
              sessionId: state.sessionId,
              action,
              memory: messageMemory,
            }),
          }
        : null,
    ].filter(Boolean);
}
/**
 * @description Page older message links on demand while retaining live updates and loaded history.
 * @param {object} React Host React.
 * @returns {Function} Message index component.
 */
export function createMessageList(React) {
  const h = (type, props, ...children) =>
    element(React, type, props, ...children);
  return function Messages({ activity, sessionId, action, memory }) {
    const [history, setHistory] = React.useState(() => memory.current);
    const [busy, setBusy] = React.useState(false),
      [error, setError] = React.useState(false);
    const controller = React.useRef(null);
    React.useEffect(() => () => controller.current?.abort(), []);
    const merged = new Map(history.items.map((x) => [x.id, x]));
    for (const item of activity.messages) merged.set(item.id, item);
    const items = [...merged.values()].sort((a, b) => b.seq - a.seq);
    const more = history.hasMore ?? activity.hasMoreMessages;
    const load = async () => {
      if (busy) return;
      setBusy(true);
      setError(false);
      const abort = new AbortController();
      controller.current = abort;
      try {
        const before = history.before ?? activity.messageBefore;
        const response = await fetch(
          "/dsh-kujira/activity?sessionId=" +
            encodeURIComponent(sessionId) +
            "&messagesBefore=" +
            before,
          { signal: abort.signal },
        );
        if (!response.ok) throw Error();
        const value = await response.json();
        if (
          !value.ok ||
          value.sessionId !== sessionId ||
          !Array.isArray(value.items)
        )
          throw Error();
        if (abort.signal.aborted) return;
        const next = {
          items: [...items, ...value.items],
          before: value.before,
          hasMore: value.hasMore,
        };
        memory.current = next;
        setHistory(next);
      } catch {
        if (!abort.signal.aborted) setError(true);
      } finally {
        if (!abort.signal.aborted) setBusy(false);
      }
    };
    return h(
      "div",
      { className: "kj-task-messages" },
      ...items.map((item) =>
        h(
          "div",
          { key: item.id, className: "kj-task-message-row" },
          h(
            "span",
            { className: "kj-task-caption" },
            t(item.role === "user" ? "你" : "助手") +
              " · " +
              t("第 {turn} 轮", { turn: number(item.turn) }),
          ),
          action(
            markdownExcerpt(item.text),
            { kind: "message", ...item },
            null,
            {
              fullText: item.text,
              excerpted: markdownExcerpt(item.text) !== item.text,
            },
          ) ||
            h(
              "p",
              { className: "kj-task-caption" },
              markdownExcerpt(item.text),
            ),
        ),
      ),
      error
        ? h(
            "p",
            { role: "status", className: "kj-task-notice" },
            "加载失败，请重试",
          )
        : null,
      more
        ? h(
            "button",
            {
              type: "button",
              className: "kj-task-link",
              disabled: busy,
              onClick: load,
            },
            busy ? "正在加载…" : "更早的消息",
          )
        : null,
    );
  };
}
