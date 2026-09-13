import { animationNames } from "./animation-catalog.js";

/**
 * @description Play only explicit changes to a valid clip selection; mounting and clearing are inert.
 * @param {object} props React, configuration and controlled selection dependencies.
 * @returns {object} Searchable animation selector.
 */
export function AnimationMenu({
  React,
  h,
  config,
  SearchSelect,
  blocked,
  playMoment,
  value = "",
  onValueChange = () => {},
}) {
  const names = React.useMemo(() => animationNames(config), [config]);
  const [error, setError] = React.useState("");
  const select = (next) => {
    if (blocked || next === value || (next && !names.includes(next))) return;
    if (next && !playMoment(next, { repeat: true, interrupt: true })) {
      setError("当前动作暂不可播放，请稍后重新选择");
      return;
    }
    onValueChange(next);
    setError("");
  };
  return h(
    "div",
    null,
    h(
      "p",
      { className: "hint" },
      "选择后播放并收起面板，不消耗补给或改变养成数值。",
    ),
    h("div", { className: "kj-setting" },
      h("span", null, "选择动作"),
      h(SearchSelect, {
      label: "选择动作",
      value,
      options: names.map((n) => [n, n]),
      onChange: select,
      disabled: blocked,
      error,
    })),
    blocked
      ? h("p", { className: "hint" }, "工作或静态陪伴期间暂停点播。")
      : null,
  );
}
