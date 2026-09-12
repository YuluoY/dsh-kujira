import { element } from "../i18n.js";
/**
 * @description Display a project-relative path without changing its navigation target.
 * @param {string} path File path.
 * @param {string} cwd Current project directory.
 * @returns {string} Relative label, or the original path for external files.
 */
export function projectPath(path = "", cwd = "") {
  if (typeof path !== "string") return "";
  if (typeof cwd !== "string") cwd = "";
  const normalize = (value) => {
    const parts = [];
    for (const part of value.replace(/\\/g, "/").split("/")) {
      if (part === ".") continue;
      if (part === ".." && parts.length > 1) parts.pop();
      else parts.push(part);
    }
    return parts.join("/").replace(/\/+$/, "");
  };
  const full = normalize(path),
    root = normalize(cwd);
  const windows = /^[a-z]:\//i.test(root);
  const same = windows ? full.toLowerCase() : full;
  const base = windows ? root.toLowerCase() : root;
  if (base && same.startsWith(base + "/")) return full.slice(root.length + 1);
  if (/^\/+$/.test(cwd) && full.startsWith("/")) return full.slice(1);
  return path.replace(/^\.\//, "");
}
/**
 * @description Clamp text by measured layout and expose full text only when clipped.
 * @param {object} React Host React instance.
 * @returns {Function} Shared text surface.
 */
export function createClampedText(React) {
  const h = (type, props, ...children) =>
    element(React, type, props, ...children);
  return function ClampedText({
    text = "",
    fullText = text,
    lines = 2,
    excerpted = false,
    as = "span",
    className = "",
    ...props
  }) {
    const ref = React.useRef(null);
    const [clipped, setClipped] = React.useState(false);
    React.useLayoutEffect(() => {
      const node = ref.current;
      if (!node) return;
      const measure = () =>
        setClipped(
          node.scrollHeight > node.clientHeight + 1 ||
            node.scrollWidth > node.clientWidth + 1,
        );
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(node);
      return () => observer.disconnect();
    }, [text, lines]);
    return h(
      as,
      {
        ...props,
        ref,
        className: "kj-clamped-text " + className,
        style: { ...props.style, "--kj-text-lines": lines },
        tabIndex:
          props.tabIndex ??
          (as !== "button" && (clipped || excerpted) ? 0 : undefined),
        "data-tooltip": clipped || excerpted ? fullText : props["data-tooltip"],
        "data-tooltip-long": clipped || excerpted ? "true" : undefined,
      },
      text,
    );
  };
}
