import { element, t, number } from "../i18n.js";
const PAGE_SIZE = 8;
/**
 * @description Limit initial DOM work and progressively show large task collections.
 * @param {object} React Host React instance.
 * @returns {Function} Paged task list component.
 */
export function createTaskList(React) {
  const h = (type, props, ...children) =>
    element(React, type, props, ...children);
  return function TaskList({
    items,
    renderItem,
    listTag = "div",
    listClass,
    limit,
    onShowMore,
  }) {
    const [localVisible, setVisible] = React.useState(PAGE_SIZE);
    const visible = limit ?? localVisible;
    const remaining = Math.max(0, items.length - visible);
    return h(
      React.Fragment,
      null,
      h(
        listTag,
        { className: listClass },
        items.slice(0, visible).map(renderItem),
      ),
      remaining
        ? h(
            "button",
            {
              type: "button",
              className: "kj-task-link kj-task-more",
              onClick: () =>
                onShowMore
                  ? onShowMore(visible + PAGE_SIZE)
                  : setVisible((count) => count + PAGE_SIZE),
            },
            t("再显示 {count} 项", {
              count: number(Math.min(PAGE_SIZE, remaining)),
            }),
          )
        : null,
    );
  };
}
