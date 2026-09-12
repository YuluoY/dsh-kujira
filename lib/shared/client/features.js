/**
 * @description Describe radial menu actions and their panel bindings.
 * @param {object} dependencies Explicit runtime and state dependencies.
 * @returns {object} Public values for the composing component.
 */
export function createFeatures({ ICONS, icon, h }) {
  const FEATURE_REGISTRY = [
    { key: "balance", label: "余额", icon: ICONS.balance, kind: "panel" },
    { key: "weather", label: "天气", icon: ICONS.weather, kind: "panel" },
    { key: "growth", label: "养成", icon: ICONS.growth, kind: "panel" },
    { key: "feed", label: "投喂", icon: ICONS.feed, kind: "action" },
    {
      key: "settings",
      label: "设置",
      icon: icon([
        h("path", { key: "a", d: "M4 7h16M4 17h16" }),
        h("circle", { key: "b", cx: 9, cy: 7, r: 3 }),
        h("circle", { key: "c", cx: 15, cy: 17, r: 3 }),
      ]),
      kind: "panel",
    },
    {
      key: "activity",
      label: "任务进展",
      kind: "panel",
      icon: icon([
        h("path", {
          key: "a",
          d: "M8 6h12M8 12h12M8 18h12M3 6h1M3 12h1M3 18h1",
        }),
      ]),
    },
    {
      key: "github",
      label: "GitHub",
      icon: icon([
        h("path", {
          key: "g",
          d: "M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.86c-2.78.6-3.37-1.18-3.37-1.18-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.64-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.99 1.03-2.69-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.03A9.6 9.6 0 0 1 12 6.82c.85 0 1.71.12 2.51.34 1.91-1.3 2.75-1.03 2.75-1.03.55 1.38.2 2.4.1 2.65.64.7 1.03 1.6 1.03 2.69 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.75c0 .27.18.58.69.48A10 10 0 0 0 12 2z",
          fill: "currentColor",
          stroke: "none",
        }),
      ]),
      kind: "link",
      href: "https://github.com/YuluoY/dsh-kujira",
    },
  ];
  return { FEATURE_REGISTRY };
}
