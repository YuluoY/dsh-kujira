import { element, t } from "../i18n.js";

/**
 * @description Load one expanded result independently of progress polling.
 * @param {object} React Host React instance.
 * @param {Function} Markdown Result renderer.
 * @returns {Function} Cancellable result detail component.
 */
export function createTaskDetail(React, Markdown) {
  const h = (type, props, ...children) =>
    element(React, type, props, ...children);
  return function TaskDetail({
    sessionId,
    target,
    fallback = "",
    version,
    onOpenFile,
  }) {
    const [value, setValue] = React.useState(null);
    const [error, setError] = React.useState(false);
    const [retry, setRetry] = React.useState(0);
    React.useEffect(() => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      let active = true;
      setValue(null);
      setError(false);
      fetch(
        "/dsh-kujira/activity?sessionId=" +
          encodeURIComponent(sessionId) +
          "&detail=" +
          encodeURIComponent(target),
        { signal: controller.signal, cache: "no-store" },
      )
        .then((response) => {
          if (!response.ok) throw Error("detail-unavailable");
          return response.json();
        })
        .then((result) => {
          if (
            !result.ok ||
            result.sessionId !== sessionId ||
            result.target !== target
          )
            throw Error("invalid-detail");
          if (active) setValue(result);
        })
        .catch(() => {
          if (active) setError(true);
        })
        .finally(() => clearTimeout(timer));
      return () => {
        active = false;
        clearTimeout(timer);
        controller.abort();
      };
    }, [sessionId, target, version, retry]);
    return h(
      React.Fragment,
      null,
      h(Markdown, {
        text: value?.text || fallback || t("等待工具返回结果"),
        onOpenFile,
      }),
      error
        ? h(
            "button",
            {
              type: "button",
              className: "kj-task-link",
              onClick: () => setRetry((n) => n + 1),
            },
            "加载失败，请重试",
          )
        : null,
      value?.truncated
        ? h(
            "p",
            { className: "kj-task-caption" },
            "显示摘要，完整内容请查看会话",
          )
        : null,
    );
  };
}
