import { supplyIcon } from "./supply-icon.js";
const presses = new WeakMap();
/**
 * @description Keep a press on a moving button and cancel intentional drags away.
 */
export function orbPressHandlers(activate, enabled) {
  const contains = (r, e) =>
    e.clientX >= r.left - 5 &&
    e.clientX <= r.right + 5 &&
    e.clientY >= r.top - 5 &&
    e.clientY <= r.bottom + 5;
  return {
    onPointerDown(e) {
      if (!enabled || e.button !== 0) return;
      presses.set(e.currentTarget, {
        id: e.pointerId,
        rect: e.currentTarget.getBoundingClientRect(),
        accepted: true,
      });
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {}
    },
    onPointerUp(e) {
      const press = presses.get(e.currentTarget);
      if (press?.id === e.pointerId)
        press.accepted =
          contains(press.rect, e) ||
          contains(e.currentTarget.getBoundingClientRect(), e);
    },
    onPointerCancel(e) {
      presses.set(e.currentTarget, { accepted: false });
    },
    onClick(e) {
      const press = presses.get(e.currentTarget);
      if (!enabled || (e.detail !== 0 && press?.accepted === false)) return;
      if (press) press.accepted = false;
      activate();
    },
  };
}
/**
 * @description Render responsive radial actions and inventory counts.
 * @param {object} dependencies Explicit runtime and state dependencies.
 * @returns {object} Public values for the composing component.
 */
export function renderOrbs({
  hoverFeature,
  leaveFeature,
  cfg,
  orbGeomRef,
  inventory,
  I18N,
  FEATURE_REGISTRY,
  lastPanelRef,
  togglePanel,
  feed,
  ARCRef,
  page,
  t,
  ICONS,
  cyclePage,
  visibleCountRef,
  h,
  orbOpen,
  closeOrb,
  speak,
}) {
  const arcCfg = cfg.ui.arc;
  const side = cfg.ui.buttonSide === "right" ? -1 : 1;
  const geom = orbGeomRef.current;
  const at = (arr, i) => arr[i] || { x: 0, y: 0 };
  const stockCount = (kind, compact = false) =>
    inventory?.ok
      ? inventory.free
        ? "∞"
        : (I18N?.number(
            inventory.stock[kind],
            compact ? { notation: "compact", maximumFractionDigits: 1 } : {},
          ) ?? String(inventory.stock[kind]))
      : "—";
  const allDefs = FEATURE_REGISTRY.map((f) => ({
    key: f.key,
    label: f.label,
    icon: f.icon,
    on: f.kind === "panel" && lastPanelRef.current === f.key,
    act:
      f.kind === "panel"
        ? () => togglePanel(f.key)
        : f.key === "feed"
          ? feed
          : () => {
              closeOrb();
              if (f.href) {
                window.open(f.href, "_blank", "noopener,noreferrer");
                return;
              }
              try {
                Promise.resolve(
                  f.onActivate?.({
                    openPanel: togglePanel,
                    closeMenu: closeOrb,
                  }),
                ).catch(() => speak("功能打开失败，请重试"));
              } catch {
                speak("功能打开失败，请重试");
              }
            },
  }));
  const pageSize =
    Number(arcCfg.pageSize) > 1 ? Math.floor(Number(arcCfg.pageSize)) : 5;
  const pg = ARCRef.current
    ? ARCRef.current.sliceArcPage({ total: allDefs.length, page, pageSize })
    : { pageCount: 1, page: 0, start: 0, end: allDefs.length, hasMore: false };
  const pageDefs = allDefs.slice(pg.start, pg.end);
  if (pg.hasMore) {
    pageDefs.push({
      key: "__more",
      label: t("更多（{page}/{total}）", {
        page: pg.page + 1,
        total: pg.pageCount,
      }),
      icon: ICONS.more,
      on: false,
      act: cyclePage,
    });
  }
  visibleCountRef.current = pageDefs.length;
  const orbs = cfg.ui.buttons
    ? h(
        "div",
        { className: "dsh-kujira-orbs" },
        pageDefs.map((o, i) => {
          const slot = at(geom.slots, i);
          const lab = at(geom.labels, i);
          return h(
            "button",
            {
              key: o.key,
              type: "button",
              className: "dsh-kujira-orb",
              tabIndex: orbOpen ? 0 : -1,
              "aria-label":
                o.key === "feed"
                  ? t("小鱼干 {count}", { count: stockCount("fish") })
                  : o.label,
              "data-tooltip":
                o.key === "feed"
                  ? t("小鱼干 {count}", { count: stockCount("fish") })
                  : o.label,
              "data-feature": o.key,
              "data-on": o.on ? "1" : "0",
              style: {
                "--kj-dx": slot.x * side + "px",
                "--kj-dy": slot.y + "px",
                "--kj-lx": lab.x * side + "px",
                "--kj-ly": lab.y + "px",
                "--kj-in-delay": (geom.inDelays[i] || 0) + "ms",
                "--kj-out-delay": (geom.outDelays[i] || 0) + "ms",
              },
              onPointerEnter: () => hoverFeature?.(o.key),
              onPointerLeave: leaveFeature,
              onFocus: () => hoverFeature?.(o.key),
              onBlur: leaveFeature,
              ...orbPressHandlers(o.act, orbOpen),
            },
            o.key === "feed" ? supplyIcon(h, "fish") : o.icon,
            o.key === "feed"
              ? h(
                  "span",
                  { className: "kj-stock-badge", "aria-hidden": true },
                  stockCount("fish", true),
                )
              : null,
          );
        }),
      )
    : null;
  return { arcCfg, side, geom, stockCount, orbs };
}
