import { rewardScatter } from "./reward-scatter.js";
import { supplyIcon } from "./supply-icon.js";
import { inventoryGains, enqueueReward } from "./reward-queue.js";
import { t, number } from "../i18n.js";
/**
 * @description Sequence earned SVG rewards, session-start eating and deliberate feature hover reactions.
 * @param {object} options React, inventory, animation and visibility dependencies.
 * @returns {object} Overlay and menu interaction handlers.
 */
export function useCompanionEffects({
  React,
  inventory,
  playMoment,
  cancelHover,
  prefs,
  reduced,
  cfgRef,
  orbOpen,
  panel,
}) {
  const h = React.createElement;
  const readAt = React.useRef(Date.now());
  const previous = React.useRef(null),
    activity = React.useRef(null),
    queue = React.useRef([]),
    hover = React.useRef(null),
    lastHover = React.useRef({}),
    serial = React.useRef(0),
    celebrationAt = React.useRef(0);
  const [gain, setGain] = React.useState(null),
    [scatter, setScatter] = React.useState(null),
    [drooling, setDrooling] = React.useState(false);
  const prefsRef = React.useRef(prefs);
  prefsRef.current = prefs;
  React.useEffect(() => {
    if (!inventory?.ok) return;
    const gains = inventoryGains(previous.current, inventory);
    previous.current = inventory;
    const feed = inventory.activity,
      old = activity.current;
    if (feed) {
      for (const event of feed.events || []) {
        const fresh =
          old?.instance === feed.instance
            ? event.sequence > old.sequence
            : event.time > readAt.current;
        if (fresh && Date.now() - event.time < 30000)
          enqueueReward(queue.current, { kind: "start", count: 1 });
      }
      readAt.current = Date.now();
      activity.current = feed;
    }
    if (inventory.execution?.active === 0) {
      queue.current = [];
      setGain(null);
      setScatter(null);
      return;
    }
    for (const item of gains) enqueueReward(queue.current, item);
  }, [inventory]);
  React.useEffect(() => {
    let finish, scatterFinish;
    const tick = () => {
      if (document.hidden) {
        setGain(null);
        setScatter(null);
        queue.current = [];
        return;
      }
      const next = queue.current.shift();
      if (!next) return;
      if (next.kind === "start")
        playMoment(cfgRef.current.ui.featureAnimations?.session || "偷吃Token");
      else {
        setGain({ ...next, id: ++serial.current });
        if (next.peak) {
          if (Date.now() - celebrationAt.current > 8000) {
            celebrationAt.current = Date.now();
            playMoment(
              cfgRef.current.ui.featureAnimations?.reward ||
                "点击回应 - 开心跃动",
            );
          }
          if (next.kind === "fish") {
            setScatter({ count: next.count, id: serial.current });
            clearTimeout(scatterFinish);
            scatterFinish = setTimeout(() => setScatter(null), 5000);
          }
        }
        clearTimeout(finish);
        finish = setTimeout(() => setGain(null), 1350);
      }
    };
    const timer = setInterval(tick, 1500);
    return () => {
      clearInterval(timer);
      clearTimeout(finish);
      clearTimeout(scatterFinish);
      clearTimeout(hover.current);
    };
  }, [playMoment, cfgRef]);
  const leaveFeature = () => {
    clearTimeout(hover.current);
    cancelHover?.();
    setDrooling(false);
  };
  React.useEffect(() => {
    if (!orbOpen || panel) leaveFeature();
  }, [orbOpen, panel]);
  const hoverFeature = (key) => {
    leaveFeature();
    hover.current = setTimeout(() => {
      if (prefsRef.current.focus) return;
      setDrooling(key === "feed");
      const now = Date.now();
      if (now - (lastHover.current[key] || 0) < 5000) return;
      lastHover.current[key] = now;
      const animation = cfgRef.current.ui.featureAnimations?.[key];
      if (animation) playMoment(animation, { hover: true });
    }, 450);
  };
  const names = { fish: "小鱼干", pat: "摸头", play: "陪玩", stretch: "舒展" };
  const overlay = h(
    React.Fragment,
    null,
    rewardScatter(h, scatter, reduced || prefs.focus),
    gain
      ? h(
          "div",
          {
            key: "gain:" + gain.id,
            className: "kj-reward-rise",
            "data-reduced": reduced || prefs.focus ? "true" : undefined,
            "data-peak": gain.peak ? "true" : undefined,
            role: "status",
            "aria-label": t("获得 {count} 份{item}", {
              count: number(gain.count),
              item: t(names[gain.kind]),
            }),
          },
          h(
            "svg",
            {
              viewBox: "0 0 94 40",
              width: 94,
              height: 40,
              "aria-hidden": true,
            },
            supplyIcon(h, gain.kind, { x: 12, y: 9, width: 22, height: 22 }),
            h(
              "text",
              { x: 43, y: 26, className: "kj-reward-count" },
              "×" +
                number(gain.count, {
                  notation: "compact",
                  maximumFractionDigits: 1,
                }),
            ),
          ),
        )
      : null,
    (drooling || scatter) && !prefs.focus
      ? h(
          "svg",
          { viewBox: "0 0 30 32", className: "kj-drool", "aria-hidden": true },
          h("path", { d: "M10 2C10 9 4 11 4 17a6 6 0 0 0 12 0c0-6-6-8-6-15Z" }),
          h("path", { d: "M24 14c0 5-4 7-4 11a4 4 0 0 0 8 0c0-4-4-6-4-11Z" }),
        )
      : null,
  );
  return { overlay, hoverFeature, leaveFeature };
}
