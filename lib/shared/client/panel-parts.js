/**
 * @description Provide shared panel frames, actions, disclosures and metrics.
 * @param {object} dependencies Explicit runtime and state dependencies.
 * @returns {object} Public values for the composing component.
 */
export function createPanelParts({
  h,
  ICONS,
  controls,
  accordionName,
  t,
  I18N,
  fieldLabel,
  city,
  saveCity,
  backToMenu,
}) {
  const panelAction = (label, onClick, emphasis) =>
    h(
      "button",
      {
        type: "button",
        className: "kj-action" + (emphasis ? " is-emphasis" : ""),
        "data-tooltip": label,
        onPointerDown: (e) => e.preventDefault(),
        onClick,
      },
      ICONS.refresh,
      h("span", null, label),
    );
  const disclosure = (label, children) =>
    controls
      ? h(controls.Disclosure, { label, name: accordionName }, children)
      : null;
  const metric = (label, value, extra) =>
    h(
      "div",
      { className: "kj-metric" },
      h("span", { className: "kj-metric-label" }, label),
      h("span", { className: "kj-metric-value" }, value),
      extra || null,
    );
  const updatedAt = (value) =>
    value ? t("{time} 更新", { time: I18N.time(value) }) : t("刚刚更新");
  const cityForm = () =>
    h(
      "div",
      { className: "kj-city-form" },
      h(
        "div",
        { className: "kj-field-label" },
        fieldLabel(
          "城市",
          "输入城市使用自定义位置；清空后自动按服务所在网络 IP 定位。",
        ),
      ),
      h(
        "div",
        { className: "fieldrow" },
        h("input", {
          id: "dsh-kujira-city",
          "aria-label": "城市",
          type: "text",
          placeholder: "留空自动定位",
          defaultValue: city,
          onBlur: (e) => {
            const value = e.currentTarget.value.trim();
            if (value !== city) saveCity(value);
          },
          onKeyDown: (e) => {
            if (e.key === "Enter") {
              saveCity(e.currentTarget.value.trim());
            }
          },
        }),
        panelAction(
          "查询",
          (e) => {
            const input = e.currentTarget.parentNode.querySelector("input");
            saveCity(input && input.value ? input.value.trim() : "");
          },
          true,
        ),
      ),
    );
  const panelHead = (iconEl, title, sub, action) =>
    h(
      "div",
      { className: "kj-head" },
      h("span", { className: "kj-ico", "data-tooltip": title }, iconEl),
      h(
        "span",
        { className: "kj-titles" },
        h("span", { className: "kj-title" }, title),
        sub ? h("span", { className: "kj-sub" }, sub) : null,
      ),
      action
        ? h(
            "button",
            {
              type: "button",
              className: "kj-head-action",
              "aria-label": action.label,
              "data-tooltip": action.label,
              disabled: !!action.busy,
              "aria-busy": !!action.busy,
              onClick: action.onClick,
            },
            ICONS.refresh,
            h("span", null, action.label),
          )
        : null,
      h(
        "button",
        {
          type: "button",
          className: "kj-back",
          "aria-label": "返回功能菜单",
          "data-tooltip": "返回功能菜单",
          onClick: backToMenu,
        },
        ICONS.back,
      ),
    );
  const panelShell = h(
    "svg",
    { className: "kj-shell", "aria-hidden": "true", focusable: "false" },
    h("path", { className: "kj-outline" }),
  );
  return { disclosure, metric, updatedAt, cityForm, panelHead, panelShell };
}
