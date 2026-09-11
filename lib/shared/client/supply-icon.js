/**
 * @description Shared SVG inventory symbols for gains, action buttons and history.
 * @param {Function} h Element factory.
 * @param {string} kind Supply kind.
 * @param {object} props SVG attributes.
 * @returns {object} SVG element.
 */
export function supplyIcon(h, kind, props = {}) {
  const paths = {
    fish: "M5 12c4-7 11-7 14 0-3 7-10 7-14 0ZM5 12l-3-4v8l3-4Zm8-4v8m-4-7 2 3-2 3",
    pat: "M8 12V7a1.5 1.5 0 0 1 3 0v4-7a1.5 1.5 0 0 1 3 0v7-5a1.5 1.5 0 0 1 3 0v6-2a1.5 1.5 0 0 1 3 0v5c0 5-3 7-7 7-3 0-5-2-7-5l-3-4c-1-2 1-3 2-2l3 3Z",
    play: "m12 2 9 5v10l-9 5-9-5V7l9-5Zm0 10L3 7m9 5 9-5m-9 5v10M8 4l9 5M7 9v10m10-9v9",
    stretch:
      "M9 5a3 3 0 1 0 6 0 3 3 0 0 0-6 0Zm-6 5 6 3h6l6-3m-9 3v4m0 0-5 5m5-5 5 5",
  };
  return h(
    "svg",
    {
      viewBox: "0 0 24 24",
      width: 22,
      height: 22,
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.5,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": true,
      ...props,
    },
    h("path", { d: paths[kind] || paths.fish }),
    kind === "fish"
      ? h("circle", {
          cx: 16,
          cy: 11,
          r: 1,
          fill: "currentColor",
          stroke: "none",
        })
      : null,
  );
}
