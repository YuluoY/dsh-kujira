import { element } from "./i18n.js";
import { createActivityStore } from "./task/store.js";
import { createTaskIcons } from "./task/icons.js";
import { createTaskBubble } from "./task/bubble.js";
import { createTaskBoundary } from "./task/boundary.js";
/**
 * @description Compose the shared task store and its bubble and panel surfaces.
 * @param {object} React Host React instance.
 * @returns {object} Public task runtime, shared by mascot and composer dock.
 */
export function createActivityRuntime(React) {
  const h = (type, props, ...children) =>
    element(React, type, props, ...children);
  const icon = createTaskIcons(h);
  const Boundary = createTaskBoundary(React);
  let panelModule;
  function Panel(props) {
    const [Component, setComponent] = React.useState(null),
      [failed, setFailed] = React.useState(false),
      [attempt, setAttempt] = React.useState(0);
    React.useEffect(() => {
      let active = true;
      panelModule ||= import("./task/panel.js")
        .then((module) => module.createTaskPanel(React, icon))
        .catch((error) => {
          panelModule = null;
          throw error;
        });
      panelModule
        .then((value) => {
          if (active) setComponent(() => value);
        })
        .catch(() => {
          if (active) setFailed(true);
        });
      return () => {
        active = false;
      };
    }, [attempt]);
    return Component
      ? h(Component, props)
      : h(
          "div",
          {
            className: "dsh-kujira-panel kj-task-panel",
            "data-panel": "activity",
            role: "dialog",
            "aria-label": "任务进展",
          },
          props.shell,
          h(
            "header",
            { className: "kj-head" },
            h("strong", null, "任务进展"),
            h(
              "button",
              { type: "button", className: "kj-back", onClick: props.onClose },
              "关闭任务进展",
            ),
          ),
          h(
            "div",
            { className: "kj-body" },
            failed
              ? h(
                  "button",
                  {
                    type: "button",
                    className: "kj-task-link",
                    onClick: () => {
                      setFailed(false);
                      setAttempt((n) => n + 1);
                    },
                  },
                  "加载失败，请重试",
                )
              : "正在读取任务",
          ),
        );
  }
  return {
    ...createActivityStore(React),
    Bubble: createTaskBubble(React, icon),
    Panel: (props) =>
      h(Boundary, { ...props, key: props.state.sessionId }, h(Panel, props)),
  };
}
