import { element } from "../i18n.js";
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
