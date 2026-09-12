import { supplyIcon } from "./supply-icon.js";
/**
 * @description Generate a bounded spread of fish with staggered landings inside the mascot surface.
 * @param {number} count Earned fish count.
 * @returns {Array} Decorative particle positions.
 */
export function fishParticles(count) {
  const length = Math.min(12, Math.max(0, Math.floor(count)));
  return Array.from({ length }, (_, i) => ({
    x: 9 + ((i * 37) % 82),
    delay: i * 65,
    tilt: ((i * 53) % 100) - 50,
    lift: 24 + ((i * 7) % 17),
    floor: 5 + ((i * 3) % 8),
  }));
}
/**
 * @description Render non-interactive SVG fish that arc down, settle and fade as one bounded burst.
 * @param {Function} h React element factory.
 * @param {object|null} burst Active reward burst.
 * @param {boolean} reduced Whether motion is suppressed.
 * @returns {object|null} Decorative reward layer.
 */
export function rewardScatter(h, burst, reduced) {
  if (!burst || reduced) return null;
  return h(
    "div",
    {
      key: "scatter:" + burst.id,
      className: "kj-fish-scatter",
      "aria-hidden": true,
    },
    ...fishParticles(burst.count).map((particle, index) =>
      h(
        "span",
        {
          key: index,
          className: "kj-falling-fish",
          style: {
            left: particle.x + "%",
            bottom: particle.floor + "%",
            "--kj-fish-delay": particle.delay + "ms",
            "--kj-fish-tilt": particle.tilt + "deg",
            "--kj-fish-lift": -particle.lift + "px",
            "--kj-fish-drift": (50 - particle.x) * 1.8 + "px",
          },
        },
        supplyIcon(h, "fish"),
      ),
    ),
  );
}

/**
 * @description Animate increasing supply energy, coalescing bursts and completing one ring before wrap.
 * @param {Function} paint Render callback.
 * @param {object} options Injectable scheduling for deterministic tests.
 * @returns {object} Update and dispose methods.
 */
export function createSupplyProgress(
  paint,
  { schedule = setTimeout, cancel = clearTimeout } = {},
) {
  let previous = null,
    target = 0,
    tone = 0,
    busy = false,
    timers = [];
  const clear = () => {
    timers.forEach(cancel);
    timers = [];
    busy = false;
  };
  const draw = (value, animate = true) => paint({ value, animate, tone });
  return {
    update(energy, reduced = false) {
      if (!Number.isFinite(energy) || energy < 0) return;
      target = energy;
      if (previous === null || reduced || energy < previous) {
        clear();
        previous = energy;
        draw(energy % 1, false);
        return;
      }
      if (energy === previous) return;
      tone = (tone + 1) % 3;
      const wrap = Math.floor(energy) > Math.floor(previous);
      previous = energy;
      if (busy) return;
      if (!wrap) {
        draw(energy % 1);
        return;
      }
      busy = true;
      draw(1);
      timers.push(
        schedule(() => {
          draw(0, false);
          timers.push(
            schedule(() => {
              busy = false;
              draw(target % 1);
            }, 32),
          );
        }, 450),
      );
    },
    dispose: clear,
  };
}
/**
 * @description Create a compact footer energy ring driven by shared settled inventory.
 * @param {object} React Host React instance.
 * @param {object} i18n Existing translator and formatters.
 * @returns {Function} Ring component.
 */
export function createSupplyRing(React, { t, money, number }) {
  const h = React.createElement;
  return function SupplyRing({ inventory, reduced }) {
    const [visual, setVisual] = React.useState({
      value: 0,
      animate: false,
      tone: 0,
    });
    const animator = React.useRef(null);
    const latestEnergy = React.useRef(0);
    latestEnergy.current =
      (inventory?.attempts ?? inventory?.drops ?? 0) +
      (inventory?.progress || 0);
    if (!animator.current) animator.current = createSupplyProgress(setVisual);
    React.useEffect(() => {
      if (inventory?.ok)
        animator.current.update(
          (inventory.attempts ?? inventory.drops ?? 0) +
            (inventory.progress || 0),
          reduced || document.hidden,
        );
    }, [inventory, reduced]);
    React.useEffect(() => {
      const sync = () => animator.current.update(latestEnergy.current, true);
      document.addEventListener("visibilitychange", sync);
      return () => {
        document.removeEventListener("visibilitychange", sync);
        animator.current.dispose();
      };
    }, []);
    const known = inventory?.ok && !inventory.stale;
    const tooltip = known
      ? t("全局补给") +
        " · " +
        t("再使用 {amount} 进行一次掉落判定", {
          amount: money(inventory.remaining, "CNY"),
        }) +
        (inventory.rewardMultiplier === 2 ? " · " + t("峰价双倍判定") : "") +
        (inventory.rules
          ? " · " +
            t("{chance} 概率 · {min}–{max} 件", {
              chance: number(inventory.rules.chance / 100, {
                style: "percent",
              }),
              min: inventory.rules.min,
              max: inventory.rules.max,
            })
          : "") +
        " · " +
        t("已获得 {count} 件物品", { count: number(inventory.drops) })
      : t("正在读取补给进度");
    return h(
      "button",
      {
        type: "button",
        className: "kj-footer-supply",
        "data-tone": visual.tone,
        "data-known": known ? "true" : "false",
        "data-tooltip": tooltip,
        "aria-label": t("补给进度") + ": " + tooltip,
      },
      h(
        "svg",
        { viewBox: "0 0 24 24", "aria-hidden": true },
        h("circle", { className: "kj-ring-track", cx: 12, cy: 12, r: 8 }),
        h("circle", {
          className: "kj-ring-value",
          cx: 12,
          cy: 12,
          r: 8,
          pathLength: 100,
          strokeDasharray: "100 100",
          strokeDashoffset: 100 - visual.value * 100,
          transform: "rotate(-90 12 12)",
          style: { transition: visual.animate ? undefined : "none" },
        }),
      ),
      inventory?.free ? h("span", { "aria-hidden": true }, "∞") : null,
    );
  };
}
