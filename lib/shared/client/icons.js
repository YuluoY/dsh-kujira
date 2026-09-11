/**
 * @description Create mascot menu and weather icons with the host element factory.
 * @param {object} dependencies Explicit runtime and state dependencies.
 * @returns {object} Public values for the composing component.
 */
export function createIcons({ h }) {
  const SVG_ATTRS = {
    viewBox: "0 0 24 24",
    width: 17,
    height: 17,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true",
    focusable: "false",
  };
  function icon(children) {
    return h("svg", SVG_ATTRS, children);
  }
  const ICONS = {
    weather: icon([
      h("circle", { key: "s", cx: 16.6, cy: 6.6, r: 2.5 }),
      h("path", {
        key: "c",
        d: "M5 18.6h9.9a3.6 3.6 0 0 0 .3-7.2 5 5 0 0 0-9.6.9A3.6 3.6 0 0 0 5 18.6z",
      }),
    ]),

    balance: icon([
      h("path", {
        key: "body",
        d: "M5 5h13a2 2 0 0 1 2 2v12H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm0 0 11-3v3",
      }),
      h("path", { key: "pocket", d: "M20 10h-5a2.5 2.5 0 0 0 0 5h5" }),
      h("circle", {
        key: "clasp",
        cx: 15.5,
        cy: 12.5,
        r: 0.65,
        fill: "currentColor",
        stroke: "none",
      }),
    ]),

    growth: icon([
      h("path", {
        key: "h",
        d: "M12 20.3l-7.1-7a4.6 4.6 0 0 1 6.5-6.5l.6.6.6-.6a4.6 4.6 0 0 1 6.5 6.5z",
      }),
    ]),

    feed: icon([
      h("path", {
        key: "b",
        d: "M4.6 12c2.4-3.2 5.2-4.8 8.2-4.8 3 0 5.7 1.8 7.8 4.8-2.1 3-4.8 4.8-7.8 4.8-3 0-5.8-1.6-8.2-4.8z",
      }),
      h("path", {
        key: "t",
        d: "M4.6 12L2 8.4v7.2z",
        fill: "currentColor",
        stroke: "none",
      }),
      h("circle", {
        key: "e",
        cx: 17.6,
        cy: 11.2,
        r: 0.85,
        fill: "currentColor",
        stroke: "none",
      }),
    ]),

    more: icon([
      h("circle", {
        key: "a",
        cx: 5.4,
        cy: 12,
        r: 1.35,
        fill: "currentColor",
        stroke: "none",
      }),
      h("circle", {
        key: "b",
        cx: 12,
        cy: 12,
        r: 1.35,
        fill: "currentColor",
        stroke: "none",
      }),
      h("circle", {
        key: "c",
        cx: 18.6,
        cy: 12,
        r: 1.35,
        fill: "currentColor",
        stroke: "none",
      }),
    ]),

    back: icon([h("path", { key: "b", d: "M14.6 5.4L8 12l6.6 6.6" })]),

    refresh: icon([
      h("path", { key: "a", d: "M18.4 9.4A7 7 0 0 0 6.6 7.2L4.8 9" }),
      h("path", { key: "b", d: "M4.8 4.7V9h4.3" }),
      h("path", { key: "c", d: "M5.6 14.6a7 7 0 0 0 11.8 2.2l1.8-1.8" }),
      h("path", { key: "d", d: "M19.2 19.3V15h-4.3" }),
    ]),

    chevron: icon([h("path", { key: "c", d: "M6.8 9.3L12 14.5l5.2-5.2" })]),
  };
  const CLOUD = "M4.8 19a4 4 0 0 0 .4-7 5 5 0 0 1 9-1.1 4.2 4.2 0 0 1 .4 8.1Z";
  const CLOUD_SM =
    "M5 15.2a3.4 3.4 0 0 0 .4-6.2 4.6 4.6 0 0 1 8.4-1 3.7 3.7 0 0 1 .3 7.2Z";
  const FLAKES = [
    { x: 8.3, y: 18.4 },
    { x: 12, y: 20.1 },
    { x: 15.7, y: 18.4 },
  ].map((f, i) =>
    h("path", {
      key: "f" + i,
      d:
        "M" +
        (f.x - 1.1) +
        " " +
        (f.y - 1.1) +
        "l2.2 2.2M" +
        (f.x + 1.1) +
        " " +
        (f.y - 1.1) +
        "l-2.2 2.2",
    }),
  );
  const WEATHER = {
    clear: [
      h("circle", { key: "c", cx: 12, cy: 12, r: 4.3 }),
      h("path", {
        key: "a",
        d: "M12 2.4v2.5M12 19.1v2.5M2.4 12h2.5M19.1 12h2.5",
      }),
      h("path", {
        key: "b",
        d: "M5.2 5.2l1.8 1.8M17 17l1.8 1.8M18.8 5.2L17 7M7 17l-1.8 1.8",
      }),
    ],
    partly: [
      h("circle", { key: "c", cx: 16.7, cy: 6.9, r: 2.7 }),
      h("path", { key: "p", d: CLOUD }),
    ],
    cloudy: [h("path", { key: "p", d: CLOUD })],
    fog: [
      h("path", { key: "p", d: CLOUD_SM }),
      h("path", { key: "l", d: "M3.4 18h17.2M6 21.2h12" }),
    ],
    drizzle: [
      h("path", { key: "p", d: CLOUD_SM }),
      h("path", { key: "l", d: "M8.8 18.2l-.8 2.2M13.6 18.2l-.8 2.2" }),
    ],
    rain: [
      h("path", { key: "p", d: CLOUD_SM }),
      h("path", {
        key: "l",
        d: "M7.6 17.8l-1.3 3.6M12 17.8l-1.3 3.6M16.4 17.8l-1.3 3.6",
      }),
    ],
    snow: [h("path", { key: "p", d: CLOUD_SM })].concat(FLAKES),
    storm: [
      h("path", { key: "p", d: CLOUD_SM }),
      h("path", { key: "l", d: "M13 17.2l-3 3.1h3.5l-2.8 2.9" }),
    ],
  };
  function weatherIcon(shape, size) {
    const px = size || 15;

    return h(
      "svg",
      Object.assign({}, SVG_ATTRS, {
        key: "w",
        width: px,
        height: px,
      }),
      WEATHER[shape] || WEATHER.cloudy,
    );
  }
  return {
    SVG_ATTRS,
    icon,
    ICONS,
    CLOUD,
    CLOUD_SM,
    FLAKES,
    WEATHER,
    weatherIcon,
  };
}
