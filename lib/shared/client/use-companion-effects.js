import { personalGreeting } from "./utilities.js";
import { createContextReactions } from "./presence-clock.js";
import { isActiveStage } from "../task/status.js";
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

/**
 * @description Schedule low-frequency context reactions while preserving foreground user actions.
 * @param {object} props Public facts, preferences and existing playback controls.
 * @returns {void} React lifecycle integration.
 */
export function useContextReactions(props) {
  const { React } = props;
  const latest = React.useRef(props);
  latest.current = props;
  const observe = React.useRef(null);
  if (!observe.current) observe.current = createContextReactions();
  const run = () => {
    const p = latest.current;
    if (!p.ready) return;
    const event = observe.current({
      activity: p.taskView?.data,
      sessionId: p.taskView?.sessionId,
      balance: p.balanceView,
      panel: p.panel,
      enabled: p.prefs.contextualReactions !== false,
      quiet: p.reduced || p.prefs.focus,
      hidden: document.hidden,
      hideBalance: p.prefs.hideBalance,
    });
    if (!event) return;
    const guard = () => {
      const next = latest.current,
        a = next.taskView?.data;
      if (
        next.prefs.contextualReactions === false ||
        next.prefs.focus ||
        next.reduced ||
        document.hidden ||
        ["waiting", "error", "paused"].includes(a?.stage)
      )
        return false;
      if (event.kind === "balance")
        return (
          next.panel === "balance" &&
          !next.prefs.hideBalance &&
          !isActiveStage(a?.stage)
        );
      if (
        event.key &&
        event.key !== next.taskView?.sessionId + ":" + a?.startedAt
      )
        return false;
      return event.kind === "work"
        ? isActiveStage(a?.stage)
        : event.kind === "done"
          ? a?.stage === "done"
          : !isActiveStage(a?.stage);
    };
    const accepted = p.playMoment(event.animation, { ambient: true, guard });
    if (accepted && event.text && p.prefs.care && !p.bubble)
      p.speak(event.text);
  };
  const runRef = React.useRef(run);
  runRef.current = run;
  React.useEffect(() => {
    runRef.current();
  }, [
    props.taskView,
    props.balanceView,
    props.panel,
    props.ready,
    props.prefs,
  ]);
  React.useEffect(() => {
    const timer = setInterval(() => runRef.current(), 30000);
    return () => clearInterval(timer);
  }, []);
}

/**
 * @description Share live name resolution between startup, return greetings and context reactions.
 * @param {object} props React, current persona and companion feedback inputs.
 * @returns {object} Stable speech helpers.
 */
export function useCompanionPersonality(props) {
  const { React, meta, prefsRef, t, baseGreeting, speak } = props;
  const metaRef = React.useRef(meta);
  metaRef.current = meta;
  const greet = React.useCallback(
    (text) =>
      speak(
        personalGreeting(
          text,
          prefsRef.current.nickname,
          metaRef.current?.systemName,
          t,
        ),
      ),
    [speak],
  );
  useContextReactions({ ...props, speak: greet });
  const greeting = (ts, systemName) =>
    personalGreeting(
      baseGreeting(ts),
      prefsRef.current.nickname,
      systemName || metaRef.current?.systemName,
      t,
    );
  return { greet, greeting };
}
