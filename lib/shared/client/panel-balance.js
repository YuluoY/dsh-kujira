/**
 * @description Render converted balances while retaining original account identities and exchange provenance.
 * @param {object} dependencies Explicit runtime and state dependencies.
 * @returns {object} Public values for the composing component.
 */
export function renderBalancePanel({
  balanceView,
  inventory,
  h,
  panelShell,
  panelHead,
  ICONS,
  t,
  loadBalance,
  controls,
  fieldLabel,
  prefs,
  I18N,
  updatedAt,
}) {
  const b = balanceView;
  return h(
    "div",
    { className: "dsh-kujira-panel", "data-panel": "balance" },
    panelShell,
    panelHead(
      ICONS.balance,
      "余额",
      "DeepSeek API" +
        (b?.ok
          ? " · " +
            t(
              b.available === true
                ? "余额可用"
                : b.available === false
                  ? "余额不可用"
                  : "状态未知",
            )
          : ""),
      {
        label: "刷新余额",
        busy: b?.refreshing || b?.loading,
        onClick: () => loadBalance(true),
      },
    ),
    h(
      "div",
      { className: "kj-body" },
      !b || (b.loading && !b.ok)
        ? h(controls.Skeleton, { kind: "balance", label: "正在读取余额" })
        : b.ok
          ? h(
              "div",
              { className: "kj-balance-content" },
              h(
                "div",
                { className: "kj-balance-accounts" },
                (b.balances || [b]).map((account, index) => {
                  return h(
                    "section",
                    {
                      key: account.rawCurrency + index,
                      className: "kj-balance-account",
                      "aria-label": account.rawCurrency + " " + t("余额"),
                    },
                    h(
                      "div",
                      { className: "kj-balance-heading" },
                      h(
                        "span",
                        { className: "kj-caption" },
                        account.rawCurrency + " · ",
                      ),
                      fieldLabel(
                        "可用余额",
                        "当前可用的充值余额与未过期赠金之和。",
                      ),
                    ),
                    h(
                      "div",
                      { className: "big kj-balance-total" },
                      prefs.hideBalance
                        ? "••••"
                        : I18N.money(account.total, account.rawCurrency),
                    ),
                    I18N.exchangeNote(account.rawCurrency)
                      ? h(
                          "p",
                          { className: "kj-caption", role: "status" },
                          I18N.exchangeNote(account.rawCurrency),
                        )
                      : null,
                    h(
                      "dl",
                      { className: "kj-account-split" },
                      h(
                        "div",
                        null,
                        h(
                          "dt",
                          null,
                          fieldLabel(
                            "充值余额",
                            "充值后尚未使用的金额，不是历史累计充值。",
                          ),
                        ),
                        h(
                          "dd",
                          null,
                          prefs.hideBalance
                            ? "••••"
                            : I18N.money(account.toppedUp, account.rawCurrency),
                        ),
                      ),
                      h(
                        "div",
                        null,
                        h(
                          "dt",
                          null,
                          fieldLabel(
                            "赠金余额",
                            "尚未过期的赠金；接口未提供具体到期日。",
                          ),
                        ),
                        h(
                          "dd",
                          null,
                          prefs.hideBalance
                            ? "••••"
                            : I18N.money(account.granted, account.rawCurrency),
                        ),
                      ),
                    ),
                  );
                }),
              ),
              h(
                "div",
                { className: "kj-today-spend" },
                fieldLabel(
                  "今日花费",
                  "按本机时区统计本服务已读取的 DeepSeek 用量，包含子代理；属于预估费用，不包含其他应用或尚未读取的历史记录。",
                ),
                h(
                  "strong",
                  {
                    "data-tooltip":
                      !prefs.hideBalance && inventory?.today
                        ? I18N.money(
                            inventory.today.total,
                            inventory.today.currency,
                          )
                        : undefined,
                  },
                  prefs.hideBalance
                    ? "••••"
                    : inventory?.today
                      ? I18N.money(
                          inventory.today.total,
                          inventory.today.currency,
                          undefined,
                          2,
                        )
                      : "—",
                ),
                inventory?.todayCoverage?.status === "loading"
                  ? h(
                      "span",
                      { className: "kj-caption", role: "status" },
                      "正在补全今日统计…",
                    )
                  : inventory?.todayCoverage?.status === "partial"
                    ? h(
                        "span",
                        { className: "kj-caption", role: "status" },
                        "今日统计尚不完整",
                      )
                    : null,
                !inventory?.today
                  ? h(
                      "span",
                      { className: "kj-caption" },
                      "今日统计将在重启 DSH 后可用",
                    )
                  : null,
              ),
              h(
                "div",
                {
                  className: "kj-caption kj-refresh-status",
                  role: "status",
                  "data-tooltip": b.refreshError || undefined,
                },
                b.refreshing
                  ? "正在更新…"
                  : b.refreshError ||
                      updatedAt(b.fetchedAt) +
                        (b.cached ? " · " + t("缓存结果") : ""),
              ),
            )
          : h(
              "div",
              { className: "kj-empty" },
              h("div", { className: "kj-empty-title" }, "无法读取余额"),
              h(
                "div",
                { className: "err" },
                b.reason?.startsWith("http-") && b.reason !== "http-401"
                  ? t("余额接口返回 HTTP {status}", {
                      status: b.reason.slice(5),
                    })
                  : b.message || "请稍后再试。",
              ),
              h(
                "div",
                { className: "kj-empty-copy" },
                "检查凭据后，点击“刷新余额”再次查询。",
              ),
            ),
    ),
  );
}
