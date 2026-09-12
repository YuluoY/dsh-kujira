import { element } from "../i18n.js";
/**
 * @description Split the last path segment into a readable stem and extension tag.
 * @param {string} path Original file path.
 * @returns {object} Filename, display stem and extension without guessing for dotfiles.
 */
export function fileLabel(path = "") {
  const name =
    path.replace(/\\/g, "/").split("/").filter(Boolean).pop() || path;
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1
    ? { name, stem: name.slice(0, dot), extension: name.slice(dot + 1) }
    : { name, stem: name, extension: "" };
}
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
    excerpted: _excerpted = false,
    as = "span",
    className = "",
    ...props
  }) {
    const ref = React.useRef(null);
    const [clipped, setClipped] = React.useState(false);
    React.useLayoutEffect(() => {
      const node = ref.current;
      if (!node) return;
      let active = true,
        frame = 0;
      const measure = () => {
        frame = 0;
        if (active)
          setClipped(
            node.scrollHeight > node.clientHeight + 0.5 ||
              node.scrollWidth > node.clientWidth + 0.5,
          );
      };
      const schedule = () => {
        if (!frame) frame = requestAnimationFrame(measure);
      };
      measure();
      const observer = new ResizeObserver(schedule);
      observer.observe(node);
      if (node.parentElement) observer.observe(node.parentElement);
      const styles = new MutationObserver(schedule);
      for (let parent = node; parent; parent = parent.parentElement)
        styles.observe(parent, {
          attributes: true,
          attributeFilter: ["class", "style"],
        });
      const fonts = node.ownerDocument.fonts;
      fonts?.addEventListener?.("loadingdone", schedule);
      fonts?.ready?.then(() => active && schedule());
      window.addEventListener("resize", schedule);
      return () => {
        active = false;
        cancelAnimationFrame(frame);
        observer.disconnect();
        styles.disconnect();
        fonts?.removeEventListener?.("loadingdone", schedule);
        window.removeEventListener("resize", schedule);
      };
    }, [text, lines]);
    return h(
      as,
      {
        ...props,
        ref,
        "data-lines": lines,
        className: "kj-clamped-text " + className,
        style: { ...props.style, "--kj-text-lines": lines },
        tabIndex:
          props.tabIndex ?? (as !== "button" && clipped ? 0 : undefined),
        "data-tooltip": clipped ? fullText : props["data-tooltip"],
        "data-tooltip-long": clipped ? "true" : undefined,
      },
      text,
    );
  };
}
