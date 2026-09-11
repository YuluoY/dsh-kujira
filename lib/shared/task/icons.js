import { isActiveStage } from "./status.js";
/**
 * @description Render consistent task and navigation symbols. Motion is opt-in for live state.
 * @param {Function} h Localized element factory.
 * @returns {Function} Icon renderer.
 */
export function createTaskIcons(h) {
  const icon = (kind, animated = false) =>
    h(
      "svg",
      {
        className: "kj-status-icon",
        "data-active": animated && isActiveStage(kind) ? "true" : undefined,
        viewBox: "0 0 20 20",
        width: 16,
        height: 16,
        "aria-hidden": true,
      },
      h("path", {
        d:
          {
            idle: "M10 4a6 6 0 1 1 0 12 6 6 0 0 1 0-12",
            unknown: "M8 7a2 2 0 1 1 3 2c-1 0-1 1-1 2m0 3v.1",
            working: "m5 5 5 5-5 5M11 15h5",
            next: "m8 4 6 6-6 6",
            back: "m12 4-6 6 6 6",
            chevron: "m6 8 4 4 4-4",
            open: "M6 4h10v10M16 4 4 16",
            done: "m4 10 4 4 8-8",
            error: "m6 6 8 8m0-8-8 8",
            waiting: "M3 4h14v9H8l-4 3v-3H3zM7 8h6",
            paused: "M7 4v12M13 4v12",
            stopped: "M5 5h10v10H5z",
            reading: "M3 4h6l1 2 1-2h6v12h-6l-1 1-1-1H3z",
            searching: "M13 13l4 4M14 8a6 6 0 1 1-12 0 6 6 0 0 1 12 0",
            editing: "m4 13 9-9 3 3-9 9-4 1z",
            testing: "m7 3 0 5-4 8h14l-4-8V3M6 3h8M6 12h8",
            delegating: "M10 3v5M4 10h12M4 10v6m12-6v6M7 3h6",
            thinking: "M5 12a6 6 0 1 1 10 0l-2 3H7zM7 18h6",
            summarizing: "M4 5h12M4 10h12M4 15h8",
            retrying: "M16 7a6 6 0 1 0 0 7M16 3v5h-5",
          }[kind] || "m5 5 5 5-5 5M11 15h5",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.5,
        strokeLinecap: "round",
        strokeLinejoin: "round",
      }),
    );
  return icon;
}
