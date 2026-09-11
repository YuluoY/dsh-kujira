/**
 * @description Render local conditions, data attribution and city controls.
 * @param {object} dependencies Explicit runtime and state dependencies.
 * @returns {object} Public values for the composing component.
 */
export function renderWeatherPanel({
  weatherView,
  h,
  panelShell,
  panelHead,
  ICONS,
  loadWeather,
  I18N,
  weatherIcon,
  t,
  metric,
  updatedAt,
  controls,
  LocalClock,
  disclosure,
  cityForm,
}) {
  const w = weatherView;
  return h(
    "div",
    { className: "dsh-kujira-panel", "data-panel": "weather" },
    panelShell,
    panelHead(
      ICONS.weather,
      "天气与此刻",
      w?.ok ? w.displayLocation || w.city : "身边的小天气",
      { label: "刷新天气", onClick: () => loadWeather(true) },
    ),
    h(
      "div",
      { className: "kj-body" },
      w?.ok
        ? h(
            "div",
            { className: "kj-weather-content" },
            h(
              "div",
              { className: "kj-primary" },
              h(
                "div",
                { className: "kj-primary-line" },
                h(
                  "div",
                  { className: "big kj-weather-temperature" },
                  I18N.temperature(w.now.temp),
                ),
                h(
                  "span",
                  {
                    className: "kj-weather-symbol",
                    "data-tooltip": w.now.text,
                  },
                  weatherIcon(w.now.shape, 30),
                ),
              ),
              h(
                "div",
                { className: "kj-primary-note" },
                t(w.now.text),
                w.now.feelsLike != null
                  ? " · " +
                      t("体感 {value}", {
                        value: I18N.temperature(w.now.feelsLike),
                      })
                  : "",
              ),
            ),
            h(
              "div",
              { className: "kj-metrics" },
              metric(
                "湿度",
                w.now.humidity == null
                  ? "—"
                  : I18N.number(w.now.humidity / 100, { style: "percent" }),
              ),
              metric("风向风力", I18N.wind(w.now)),
            ),
            /雨|雪/.test(w.now.text)
              ? h("p", { className: "hint" }, "出门记得带伞。")
              : null,
            h(
              "p",
              { className: "hint", role: "status" },
              w.loading
                ? "正在更新…"
                : w.stale
                  ? "暂未更新 · 显示上次天气"
                  : updatedAt(w.fetchedAt),
            ),
            ...(w.alerts || []).map((a, i) =>
              h("p", { key: i, className: "hint" }, a.title, " ", a.text),
            ),
          )
        : !w || w.loading
          ? h(controls.Skeleton, { kind: "weather", label: "正在读取天气" })
          : h(
              "p",
              { className: "hint", role: "status" },
              w.message || "请设置城市",
            ),
      h(LocalClock),
      disclosure(
        "位置与数据",
        h(
          "div",
          null,
          cityForm(),
          h(
            "p",
            { className: "hint" },
            h(
              "a",
              {
                href: w?.sourceUrl || "https://open-meteo.com/",
                target: "_blank",
                rel: "noreferrer",
              },
              w?.source || t("天气"),
            ),
            " · ",
            w?.fallback ? t("数据来自备用服务") + " · " : "",
            w?.automatic
              ? "位置由服务所在网络 IP 推测，可手动修改城市。"
              : "使用你设置的城市。",
            " ",
            "不请求浏览器精确定位。",
          ),
        ),
      ),
    ),
  );
}
