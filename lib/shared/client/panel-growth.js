/**
 * @description Render companion growth, inventory actions and supply history.
 * @param {object} dependencies Explicit runtime and state dependencies.
 * @returns {object} Public values for the composing component.
 */
export function renderGrowthPanel({
  growthView,
  h,
  panelShell,
  panelHead,
  ICONS,
  loadGrowth,
  refreshInventory,
  controls,
  t,
  I18N,
  metric,
  inventory,
  inventoryBusy,
  feed,
  stockCount,
  interact,
  icon,
  disclosure,
}) {
  const g = growthView;
  const bar = (v, color) =>
    h(
      "div",
      { className: "bar" },
      h("i", { style: { width: Math.round(v) + "%", background: color } }),
    );
  return h(
    "div",
    { className: "dsh-kujira-panel", "data-panel": "growth" },
    panelShell,
    panelHead(ICONS.growth, "养成", "", {
      label: "刷新养成",
      onClick: () => {
        loadGrowth();
        refreshInventory();
      },
    }),
    h(
      "div",
      { className: "kj-body" },
      !g || g.loading
        ? h(controls.Skeleton, { kind: "growth", label: "正在读取养成" })
        : !g.ok
          ? h(
              "div",
              { className: "kj-empty" },
              h("div", { className: "kj-empty-title" }, "养成暂不可用"),
              h("div", { className: "err" }, g.message),
            )
          : h(
              "div",
              null,
              h(
                "div",
                { className: "kj-primary" },
                h(
                  "div",
                  { className: "kj-primary-line" },
                  h(
                    "div",
                    { className: "kj-relationship" },
                    h("strong", null, g.levelName),
                    h("span", { className: "kj-level" }, "Lv." + g.level),
                  ),
                  h(
                    "span",
                    { className: "kj-badge" },
                    t("好感 {value}", {
                      value: I18N.number(Math.round(g.bond)),
                    }),
                  ),
                ),
                h(
                  "div",
                  { className: "kj-primary-note" },
                  g.toNext
                    ? t("距下一级还差 {value} 好感", {
                        value: I18N.number(Math.round(g.toNext.need)),
                      })
                    : t("已满级，好感 {value}", {
                        value: I18N.number(Math.round(g.bond)),
                      }),
                ),
              ),
              h(
                "div",
                { className: "kj-metrics" },
                metric(
                  "心情",
                  Math.round(g.mood),
                  bar(g.mood, "var(--kj-tone-mood)"),
                ),
                metric(
                  "饱食",
                  Math.round(g.satiety),
                  bar(g.satiety, "var(--kj-tone-satiety)"),
                ),
                metric(
                  "精力",
                  Math.round(g.energy),
                  bar(g.energy, "var(--kj-tone-energy)"),
                ),
              ),
              h(
                "div",
                { className: "kj-care" },
                h(
                  "div",
                  { className: "kj-care-summary" },
                  h(
                    "p",
                    { className: "kj-primary-note" },
                    g.satiety < 35
                      ? "有点饿了，想吃小鱼干"
                      : g.energy < 30
                        ? "有点困，让我休息一下"
                        : "今天也在好好陪着你",
                  ),
                  h(
                    "button",
                    {
                      type: "button",
                      className: "kj-supply-ring",
                      "aria-label": t("补给进度"),
                      "data-tooltip": inventory?.ok
                        ? inventory.free
                          ? t("无限免费互动已开启")
                          : t("再使用 {amount} 获得一次补给", {
                              amount: I18N.money(inventory.remaining, "CNY"),
                            }) +
                            " · " +
                            t("已累计 {amount} · 获得 {count} 份补给", {
                              amount: I18N.money(inventory.credited, "CNY"),
                              count: I18N.number(inventory.drops),
                            })
                        : t("库存暂不可用，请刷新"),
                    },
                    h(
                      "svg",
                      { viewBox: "0 0 24 24", "aria-hidden": true },
                      h("circle", {
                        className: "kj-ring-track",
                        cx: 12,
                        cy: 12,
                        r: 8,
                      }),
                      h("circle", {
                        className: "kj-ring-value",
                        cx: 12,
                        cy: 12,
                        r: 8,
                        pathLength: 100,
                        strokeDasharray:
                          (inventory?.free
                            ? 100
                            : Math.round((inventory?.progress || 0) * 100)) +
                          " 100",
                        transform: "rotate(-90 12 12)",
                      }),
                    ),
                    inventory?.free
                      ? h("span", { "aria-hidden": true }, "∞")
                      : null,
                  ),
                ),
                h(
                  "div",
                  { className: "kj-care-actions" },
                  h(
                    "button",
                    {
                      type: "button",
                      className: "kj-action",
                      "data-tooltip": "投喂小鱼干",
                      disabled: inventoryBusy,
                      onClick: feed,
                    },
                    ICONS.feed,
                    "喂食",
                    h(
                      "span",
                      { className: "kj-care-count" },
                      stockCount("fish", true),
                    ),
                  ),
                  h(
                    "button",
                    {
                      type: "button",
                      className: "kj-action",
                      "data-tooltip": "摸摸头",
                      disabled: inventoryBusy,
                      onClick: () => interact("pat"),
                    },
                    ICONS.growth,
                    "摸头",
                    h(
                      "span",
                      { className: "kj-care-count" },
                      stockCount("pat", true),
                    ),
                  ),
                  h(
                    "button",
                    {
                      type: "button",
                      className: "kj-action",
                      "data-tooltip": "陪她玩魔方",
                      disabled: inventoryBusy,
                      onClick: () => interact("play"),
                    },
                    icon([
                      h("path", {
                        key: "p",
                        d: "M7 8h10c3 0 5 10 2 11l-4-3H9l-4 3C2 18 4 8 7 8zM7 10v4M5 12h4M16 11v.1M18 13v.1",
                      }),
                    ]),
                    "陪玩",
                    h(
                      "span",
                      { className: "kj-care-count" },
                      stockCount("play", true),
                    ),
                  ),
                  h(
                    "button",
                    {
                      type: "button",
                      className: "kj-action",
                      "data-tooltip": "一起伸个懒腰",
                      disabled: inventoryBusy,
                      onClick: () => interact("stretch"),
                    },
                    icon([
                      h("circle", { key: "c", cx: 12, cy: 6, r: 2 }),
                      h("path", {
                        key: "p",
                        d: "m5 5 4 6h6l4-6M12 11v6m0 0-4 4m4-4 4 4",
                      }),
                    ]),
                    "舒展",
                    h(
                      "span",
                      { className: "kj-care-count" },
                      stockCount("stretch", true),
                    ),
                  ),
                ),
              ),
              disclosure(
                "补给规则与记录",
                h(
                  "div",
                  null,
                  h(
                    "p",
                    { className: "hint" },
                    "每消耗 ¥0.10 获得一次随机补给。每五次包含小鱼干×2，摸头、陪玩、舒展各×1，顺序随机，无每日上限。",
                  ),
                  h(
                    "p",
                    { className: "hint" },
                    "仅统计启用后可核对的 DeepSeek 用量预估费用，不是官方账单。无可核对价格的用量不计入；不需要为补给额外调用模型。",
                  ),
                  h(
                    "p",
                    { className: "hint" },
                    "每次互动消耗 1 份，所有互动共用 8 秒冷却。无限免费模式不扣库存，切回后库存保留。",
                  ),
                  inventory?.ok
                    ? h(
                        "p",
                        { className: "hint" },
                        t("已累计 {amount} · 获得 {count} 份补给", {
                          amount: I18N.money(inventory.credited, "CNY"),
                          count: I18N.number(inventory.drops),
                        }),
                      )
                    : null,
                  ...(inventory?.history || []).map((entry, index) =>
                    h(
                      "div",
                      { key: index, className: "kj-supply-log" },
                      h("time", null, I18N.time(entry.time)),
                      h(
                        "span",
                        null,
                        entry.type === "reward"
                          ? t("获得补给") +
                              ": " +
                              Object.entries(entry.items)
                                .filter(([, count]) => count > 0)
                                .map(
                                  ([kind, count]) =>
                                    t(
                                      {
                                        fish: "小鱼干",
                                        pat: "摸头",
                                        play: "陪玩",
                                        stretch: "舒展",
                                      }[kind],
                                    ) +
                                    " ×" +
                                    I18N.number(count),
                                )
                                .join(" · ")
                          : t(entry.free ? "免费互动" : "使用补给") +
                              " · " +
                              t(
                                {
                                  fish: "小鱼干",
                                  pat: "摸头",
                                  play: "陪玩",
                                  stretch: "舒展",
                                }[entry.kind],
                              ),
                      ),
                    ),
                  ),
                ),
              ),
              disclosure(
                "查看互动记录",
                h(
                  "div",
                  null,
                  h(
                    "div",
                    { className: "row" },
                    h("span", { className: "k" }, "累计工作"),
                    h(
                      "span",
                      { className: "v" },
                      I18N.number((g.stats.workingMs || 0) / 3600000, {
                        style: "unit",
                        unit: "hour",
                        unitDisplay: "short",
                        maximumFractionDigits: 1,
                      }),
                    ),
                  ),
                  h(
                    "div",
                    { className: "row" },
                    h("span", { className: "k" }, "被摸头"),
                    h("span", { className: "v" }, g.stats.pats || 0),
                  ),
                  h(
                    "div",
                    { className: "row" },
                    h("span", { className: "k" }, "被投喂"),
                    h("span", { className: "v" }, g.stats.feeds || 0),
                  ),
                  h(
                    "div",
                    { className: "row" },
                    h("span", { className: "k" }, "陪玩"),
                    h("span", { className: "v" }, g.stats.plays || 0),
                  ),
                  h(
                    "div",
                    { className: "row" },
                    h("span", { className: "k" }, "舒展"),
                    h("span", { className: "v" }, g.stats.stretches || 0),
                  ),
                  h(
                    "div",
                    { className: "row" },
                    h("span", { className: "k" }, "活跃天数"),
                    h(
                      "span",
                      { className: "v" },
                      (g.stats.activeDays || []).length,
                    ),
                  ),
                  h(
                    "p",
                    { className: "hint" },
                    "心情、饱食与精力会随时间变化，好感只增不减。",
                  ),
                ),
              ),
            ),
    ),
  );
}
