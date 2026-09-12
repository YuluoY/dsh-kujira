import { element, t, number } from "../i18n.js";
/**
 * @description Choose a valid visible tab while retaining the user's selection.
 * @param {Array} items Available categories.
 * @param {string} value Selected category.
 * @returns {string|null} Existing selection or first category.
 */
export function selectedTab(items, value) {
  return items.some((item) => item.id === value) ? value : items[0]?.id || null;
}
/**
 * @description Resolve horizontal tabs keyboard navigation with wrapping.
 * @param {string} key Keyboard key.
 * @param {number} index Current index.
 * @param {number} count Available tab count.
 * @returns {number|null} Destination index or no navigation.
 */
export function tabDestination(key, index, count) {
  if (!count) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowLeft") return (index + count - 1) % count;
  if (key === "ArrowRight") return (index + 1) % count;
  return null;
}
/**
 * @description Create a controlled tab strip with lazy panels and per-category scroll memory.
 * @param {object} React Host runtime.
 * @returns {Function} Tabs component.
 */
export function createTaskTabs(React) {
  const countLabel = (item) =>
    item.progress
      ? number(item.progress.completed) + "/" + number(item.progress.total)
      : number(item.count);
  const h = (type, props, ...children) =>
    element(React, type, props, ...children);
  return function Tabs({ items, value, onChange, scrollMemory }) {
    const id = React.useId(),
      bar = React.useRef(null),
      pane = React.useRef(null);
    const localMemory = React.useRef({});
    const memory = scrollMemory || localMemory;
    const active = selectedTab(items, value),
      index = items.findIndex((item) => item.id === active);
    const signature = items
      .map((item) => item.id + ":" + item.label + ":" + countLabel(item))
      .join("|");
    const [indicator, setIndicator] = React.useState({ left: 0, width: 0 });
    React.useEffect(() => {
      if (active !== value) onChange(active);
    }, [active, value, onChange]);
    React.useLayoutEffect(() => {
      if (!bar.current || index < 0) return;
      const buttons = bar.current.querySelectorAll('[role="tab"]');
      const measure = () => {
        const selected = buttons[index];
        if (!selected) return;
        setIndicator((old) =>
          old.left === selected.offsetLeft && old.width === selected.offsetWidth
            ? old
            : { left: selected.offsetLeft, width: selected.offsetWidth },
        );
      };
      measure();
      buttons[index]?.scrollIntoView({ block: "nearest", inline: "nearest" });
      const observer = new ResizeObserver(measure);
      observer.observe(bar.current);
      buttons.forEach((button) => observer.observe(button));
      return () => observer.disconnect();
    }, [active, signature]);
    React.useLayoutEffect(() => {
      if (pane.current) pane.current.scrollTop = memory.current[active] || 0;
    }, [active]);
    if (!items.length) return null;
    if (items.length === 1)
      return h(
        "section",
        { className: "kj-task-tabs kj-single-category" },
        h(
          "div",
          { id: id + "-heading", className: "kj-single-heading" },
          t(items[0].label) + " " + countLabel(items[0]),
        ),
        h(
          "div",
          {
            className: "kj-tabpanel",
            role: "region",
            "aria-labelledby": id + "-heading",
            ref: pane,
            tabIndex: 0,
            onScroll: (e) => {
              memory.current[active] = e.currentTarget.scrollTop;
            },
          },
          items[0].content,
        ),
      );
    const select = (next) => {
      if (pane.current) memory.current[active] = pane.current.scrollTop;
      onChange(next);
    };
    return h(
      "div",
      { className: "kj-task-tabs" },
      h(
        "div",
        {
          ref: bar,
          className: "kj-tablist",
          role: "tablist",
          "aria-label": "任务详情类别",
        },
        ...items.map((item, i) =>
          h(
            "button",
            {
              key: item.id,
              id: id + "-tab-" + i,
              type: "button",
              role: "tab",
              tabIndex: item.id === active ? 0 : -1,
              "aria-selected": item.id === active,
              "aria-label": item.attention
                ? t(item.label) +
                  " " +
                  countLabel(item) +
                  " · " +
                  t("有任务需要处理")
                : undefined,
              "aria-controls": id + "-panel-" + i,
              "data-tooltip": item.progress?.help
                ? t(item.progress.help)
                : undefined,
              onClick: () => select(item.id),
              onKeyDown: (e) => {
                const next = tabDestination(e.key, i, items.length);
                if (next === null) return;
                e.preventDefault();
                select(items[next].id);
                bar.current.querySelectorAll('[role="tab"]')[next]?.focus();
              },
            },
            h("span", null, item.label),
            h("span", { className: "kj-tab-count" }, countLabel(item)),
            item.attention
              ? h("span", {
                  className: "kj-tab-alert",
                  "aria-label": t("有任务需要处理"),
                  "data-tooltip": t("有任务需要处理"),
                })
              : null,
          ),
        ),
        h("span", {
          className: "kj-tab-indicator",
          "aria-hidden": true,
          style: {
            width: indicator.width + "px",
            transform: "translateX(" + indicator.left + "px)",
          },
        }),
      ),
      ...items.map((item, i) =>
        h(
          "div",
          {
            key: item.id,
            id: id + "-panel-" + i,
            role: "tabpanel",
            "aria-labelledby": id + "-tab-" + i,
            hidden: item.id !== active,
            tabIndex: 0,
            className: "kj-tabpanel",
            ref: item.id === active ? pane : null,
            onScroll: (e) => {
              if (item.id === active)
                memory.current[active] = e.currentTarget.scrollTop;
            },
          },
          item.id === active ? item.content : null,
        ),
      ),
    );
  };
}
