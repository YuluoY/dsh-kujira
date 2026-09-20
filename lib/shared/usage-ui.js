import { exchangeAmount } from "./exchange.js";
import { createSupplyRing } from "./client/reward-scatter.js";
import { inventoryFeed, getInventorySnapshot } from "./client/reward-queue.js";
import {
  amountDecimals,
  amountParts,
  createRollingAmount,
} from "./client/rolling-amount.js";
import { isDeepSeekProvider } from "./session-cost.js";
import { createControls } from "./panel-controls.js";
import { element, t, date, money, number, exchangeNote } from "./i18n.js";

export function createUsageComponent(React, usePreferences) {
  const h = (type, props, ...children) =>
    element(React, type, props, ...children);
  const SupplyRing = createSupplyRing(React, { t, money, number });
  const RollingAmount = createRollingAmount(React);
  const { TooltipHost, Skeleton } = createControls(React);
  const smallIcon = (d) =>
    h(
      "svg",
      { viewBox: "0 0 16 16", width: 12, height: 12, "aria-hidden": true },
      h("path", { d, fill: "none", stroke: "currentColor", strokeWidth: 1.4 }),
    );
  const { useState, useEffect, useRef, useLayoutEffect } = React;
  return function SessionUsage({ sessionId, useProjection }) {
    const { prefs, locale, theme, reduced } = usePreferences();
    const [result, setResult] = useState(null),
      [error, setError] = useState("");
    const [open, setOpen] = useState(false);
    const [inventory, setInventory] = useState(getInventorySnapshot);
    useEffect(() => {
      return inventoryFeed.acquire(setInventory).dispose;
    }, []);
    const root = useRef(null),
      trigger = useRef(null),
      popover = useRef(null);
    // Host projection is an update signal; prices always use timestamped durable records.
    const projection =
      typeof useProjection === "function"
        ? useProjection("tokenUsage")
        : undefined;
    const signal = projection
      ? `${projection.uncachedInputTokens}:${projection.outputTokens}:${projection.cacheReadTokens}:${projection.cacheWriteTokens}`
      : "";
    useEffect(() => {
      setResult(null);
      setError("");
      setOpen(false);
    }, [sessionId]);
    useEffect(() => {
      if (!sessionId || !prefs.usage) return;
      let stopped = false,
        timer,
        abort;
      const poll = async () => {
        if (document.hidden) {
          timer = setTimeout(poll, 5000);
          return;
        }
        abort = new AbortController();
        const deadline = setTimeout(() => abort.abort(), 10000);
        try {
          const response = await fetch(
            "/dsh-kujira/usage?sessionId=" + encodeURIComponent(sessionId),
            { cache: "no-store", signal: abort.signal },
          );
          if (!response.ok) throw new Error("用量服务暂不可用");
          const value = await response.json();
          if (!stopped) {
            if (value.ok && value.sessionId === sessionId) {
              setResult(value);
              setError("");
            } else setError(value.message || "会话用量暂不可用");
          }
        } catch (e) {
          if (!stopped) setError("连接中断，显示上次结果");
        } finally {
          clearTimeout(deadline);
          if (!stopped) timer = setTimeout(poll, 5000);
        }
      };
      poll();
      return () => {
        stopped = true;
        clearTimeout(timer);
        abort?.abort();
      };
    }, [sessionId, prefs.usage, signal]);
    const data = result?.sessionId === sessionId ? result : null;
    const close = () => {
      setOpen(false);
      trigger.current?.focus();
    };
    useEffect(() => {
      if (!open) return;
      const outside = (e) => {
        if (!root.current?.contains(e.target)) setOpen(false);
      };
      const key = (e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      };
      document.addEventListener("pointerdown", outside);
      document.addEventListener("keydown", key);
      popover.current?.querySelector("button")?.focus();
      return () => {
        document.removeEventListener("pointerdown", outside);
        document.removeEventListener("keydown", key);
      };
    }, [open]);
    useLayoutEffect(() => {
      if (!open || !popover.current || !trigger.current) return;
      const p = popover.current;
      p.showPopover();
      const fit = () => {
        const anchor = trigger.current.getBoundingClientRect();
        const left = Math.max(
          12,
          Math.min(
            anchor.right - p.offsetWidth,
            innerWidth - p.offsetWidth - 12,
          ),
        );
        const above = anchor.top - p.offsetHeight - 10;
        const top =
          above >= 12
            ? above
            : Math.max(
                12,
                Math.min(anchor.bottom + 10, innerHeight - p.offsetHeight - 12),
              );
        p.style.left = left + "px";
        p.style.top = top + "px";
      };
      fit();
      const scroll = (event) => {
        if (!p.contains(event.target)) fit();
      };
      const observer = new ResizeObserver(fit);
      observer.observe(trigger.current);
      observer.observe(p);
      window.addEventListener("resize", fit);
      window.addEventListener("scroll", scroll, true);
      return () => {
        observer.disconnect();
        if (p.matches(":popover-open")) p.hidePopover();
        window.removeEventListener("resize", fit);
        window.removeEventListener("scroll", scroll, true);
      };
    }, [open]);
    if (!prefs.usage || !sessionId) return null;
    const total = data?.totals;
    const decimals = amountDecimals(prefs.usageDecimals);
    const sourceCurrency = data?.pricing?.currency || "CNY";
    const display = exchangeAmount(total?.total || 0, sourceCurrency, prefs.displayCurrency);
    const currency = display.currency;
    const money = (value) => {
      const converted = exchangeAmount(value, sourceCurrency, prefs.displayCurrency);
      return (
        (converted.converted
          ? "≈ "
          : converted.unavailable
            ? sourceCurrency + " "
            : "") +
        amountParts(converted.value, locale, converted.currency, decimals).text
      );
    };
    const title = !data
      ? error
        ? "用量暂不可用"
        : "正在读取用量"
      : !data.hasUsage
        ? "等待用量上报"
        : data.complete
          ? money(total.total)
          : data.skipped.length === data.requests
            ? "—"
            : t("部分 {amount}", { amount: money(total.total) });
    const priced = data && data.requests > data.skipped.length;
    const missingReason = data?.skipped.length
      ? [
          ...new Set(
            data.skipped.map((row) =>
              t(
                {
                  "no-price": "缺少用量发生时的历史价格",
                  "unknown-model": "此模型尚未配置价格",
                  "unsupported-provider": "此提供方不适用 DeepSeek 官方价格",
                  "missing-time": "用量记录缺少时间",
                  "invalid-usage": "用量记录不完整",
                }[row.reason] || "缺少可核对的价格或用量",
              ),
            ),
          ),
        ].join(t("；"))
      : "";
    const pricingNote = data?.children?.unavailable
      ? t("部分子代理用量暂不可用，合计尚不完整")
      : missingReason
        ? t(priced ? "部分记录未计入：{reason}" : "暂无法估算：{reason}", {
            reason: missingReason,
          })
        : "";
    const hasSchedule =
      data?.pricing && (!data.provider || isDeepSeekProvider(data.provider));
    const rate = hasSchedule
      ? data.rate === "peak"
        ? "峰价"
        : "谷价"
      : "价格待确认";
    const nextTime =
      data?.next?.ms != null
        ? (data.previewTime || data.updatedAt) + data.next.ms
        : null;
    const nextLabel = nextTime
      ? t("下次切换 {time}", {
          time: date(nextTime, {
            weekday: "short",
            hour: "numeric",
            minute: "2-digit",
          }),
        })
      : "";
    return h(
      "div",
      {
        ref: root,
        className: "kj-usage-root",
        lang: locale,
        "data-theme": theme,
        "data-motion": reduced || prefs.focus ? "reduced" : "full",
      },
      h(TooltipHost, {
        key: open ? "detail-tips" : "trigger-tips",
        rootRef: root,
      }),
      h(
        "button",
        {
          ref: trigger,
          type: "button",
          className: "kj-usage-trigger",
          "aria-expanded": open,
          "aria-haspopup": "dialog",
          "data-tooltip": error
            ? t(error)
            : pricingNote ||
              (!data?.hasUsage ? t(title) : nextLabel || t(rate)),
          onClick: () => setOpen((value) => !value),
        },
        h(
          "span",
          {
            className: "kj-rate",
            "data-rate": hasSchedule ? data.rate : "unknown",
            "aria-label": t(rate),
          },
          hasSchedule ? (data.rate === "peak" ? "峰" : "谷") : "?",
        ),
        h(
          "strong",
          { "aria-label": t("本会话预估") + ": " + t(title) },
          priced
            ? h(
                React.Fragment,
                null,
                !data.complete
                  ? h("span", { className: "kj-usage-partial" }, t("部分"))
                  : null,
                display.converted || display.unavailable
                  ? h(
                      "span",
                      null,
                      display.converted ? "≈ " : sourceCurrency + " ",
                    )
                  : null,
                h(RollingAmount, {
                  key:
                    sessionId + ":" + locale + ":" + currency + ":" + decimals,
                  value: display.value,
                  locale,
                  currency,
                  decimals,
                  reduced: reduced || prefs.focus,
                }),
              )
            : data?.hasUsage
              ? title
              : "—",
        ),
      ),
      h(SupplyRing, { inventory, reduced: reduced || prefs.focus }),
      open
        ? h(
            "section",
            {
              ref: popover,
              popover: "manual",
              className: "kj-usage-popover",
              role: "dialog",
              "aria-label": "当前会话用量与计价说明",
              "data-preview": data?.preview ? "true" : undefined,
            },
            h(
              "header",
              null,
              h("div", null, h("strong", null, "会话费用")),
              h(
                "button",
                {
                  type: "button",
                  onClick: close,
                  "aria-label": "关闭用量详情",
                  "data-tooltip": "关闭用量详情",
                },
                smallIcon("m4 4 8 8M12 4l-8 8"),
              ),
            ),
            h(
              "div",
              { className: "kj-usage-body" },
              !data && !error
                ? h(Skeleton, { kind: "usage", label: "正在读取用量" })
                : !data
                  ? h(
                      "p",
                      { className: "kj-usage-note", role: "status" },
                      error,
                    )
                  : h(
                      React.Fragment,
                      null,
                      exchangeNote(sourceCurrency, locale)
                        ? h(
                            "p",
                            { className: "kj-usage-note", role: "status" },
                            exchangeNote(sourceCurrency, locale),
                          )
                        : null,
                      h(
                        "dl",
                        { className: "kj-fee-lines" },
                        h(
                          "div",
                          { className: "kj-fee-sum" },
                          h("dt", null, "合计"),
                          h("dd", null, data.hasUsage ? title : "—"),
                        ),
                        data.children &&
                          (data.children.count || data.children.unavailable)
                          ? h(
                              "div",
                              { className: "kj-fee-children" },
                              h("dt", null, "其中子代理"),
                              h(
                                "dd",
                                null,
                                data.children.requests
                                  ? data.children.pricedRequests === 0
                                    ? "—"
                                    : data.children.complete === false
                                      ? t("部分 {amount}", {
                                          amount: money(data.children.total),
                                        })
                                      : money(data.children.total)
                                  : data.children.unavailable
                                    ? "—"
                                    : money(0),
                              ),
                            )
                          : null,
                        h(
                          "div",
                          null,
                          h("dt", null, "谷价费用"),
                          h(
                            "dd",
                            null,
                            priced ? money(data.byRate.offpeak) : "—",
                          ),
                        ),
                        h(
                          "div",
                          null,
                          h("dt", null, "峰价费用"),
                          h("dd", null, priced ? money(data.byRate.peak) : "—"),
                        ),
                      ),
                      error
                        ? h(
                            "p",
                            { className: "kj-usage-note", role: "status" },
                            error,
                          )
                        : pricingNote
                          ? h(
                              "p",
                              { className: "kj-usage-note", role: "status" },
                              pricingNote,
                            )
                          : null,
                    ),
            ),
          )
        : null,
    );
  };
}
