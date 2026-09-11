import { createVideoPlayer } from "./video-player.js";
/**
 * @description Coordinate buffered animation playback with live task state.
 * @param {object} dependencies Explicit runtime and state dependencies.
 * @returns {object} Public values for the composing component.
 */
export function usePetMotion({
  useCallback,
  useRef,
  aRef,
  bRef,
  frontRef,
  tokenRef,
  ASSET_BASE,
  quietRef,
  currentRef,
  cfgRef,
  setLabel,
  useEffect,
  applyVisual,
  timerRef,
  setBubble,
  prefs,
  reduced,
  prefsRef,
  bubbleTimerRef,
  busyRef,
  pick,
  IDLE,
  stateRef,
  taskRuntime,
}) {
  const sequence = useRef(null),
    workSince = useRef(0),
    lastBreak = useRef(0);
  const moment = useRef(null),
    pendingMoment = useRef(null),
    finishRef = useRef(() => {});
  const player = useRef(null);
  if (!player.current)
    player.current = createVideoPlayer({
      videos: () => [aRef.current, bRef.current],
      frontRef,
      tokenRef,
      base: ASSET_BASE,
      quiet: () => quietRef.current || document.hidden,
      onStart: (name) => {
        currentRef.current = name;
        const c = cfgRef.current;
        if (c.debug.showLabel || c.ui.showLabel) setLabel(name);
      },
      onFinish: (failed) => finishRef.current(failed),
    });
  const play = useCallback((name, opts = {}) => {
    if (!opts.sequence) sequence.current = null;
    if (!opts.moment) {
      moment.current = null;
      pendingMoment.current = null;
    }
    return player.current.play(name, opts);
  }, []);
  useEffect(() => () => player.current.dispose(), []);
  useEffect(() => {
    const refresh = () => {
      applyVisual();
      if (!document.hidden && !quietRef.current && frontRef.current?.ended)
        finishRef.current(false);
      for (const video of [aRef.current, bRef.current]) {
        if (!video) continue;
        if (document.hidden || quietRef.current || video !== frontRef.current)
          video.pause();
        else video.play().catch(() => {});
      }
      if (quietRef.current) {
        clearTimeout(timerRef.current);
        setBubble("");
      }
    };
    refresh();
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [prefs.size, prefs.focus, reduced, applyVisual]);
  const playMoment = useCallback(
    (animation, options = {}) => {
      if (!animation || quietRef.current || document.hidden) return;
      const request = { animation, ...options };
      if (moment.current) {
        if (moment.current.animation !== animation)
          pendingMoment.current = request;
        return;
      }
      clearTimeout(timerRef.current);
      moment.current = request;
      if (!play(animation, { loop: false, moment: true }))
        moment.current = null;
    },
    [play],
  );
  const cancelHover = useCallback(() => {
    if (pendingMoment.current?.hover) pendingMoment.current = null;
  }, []);
  const speak = useCallback((text, ms) => {
    if (!cfgRef.current.ui.bubble || !text || prefsRef.current.focus) {
      return;
    }
    setBubble(text);
    clearTimeout(bubbleTimerRef.current);
    bubbleTimerRef.current = setTimeout(
      () => setBubble(""),
      ms || (Number(prefsRef.current.taskPeekSeconds) || 5) * 1000,
    );
  }, []);
  const scheduleNext = useCallback(() => {
    if (busyRef.current || quietRef.current || document.hidden) {
      return;
    }
    const cfg = cfgRef.current;
    const gap = cfg.gapMs[0] + Math.random() * (cfg.gapMs[1] - cfg.gapMs[0]);

    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (busyRef.current || quietRef.current || document.hidden) return;
      const hour = new Date().getHours();
      if (
        (hour >= 23 || hour < 6) &&
        cfg.pools.sleep?.length &&
        Math.random() < 0.2
      ) {
        const clips = [...cfg.pools.sleep];
        sequence.current = { state: IDLE, clips };
        play(clips.shift(), { loop: false, sequence: true });
        return;
      }
      const r = Math.random();
      const w = cfg.weights;
      let pool = cfg.pools.long;
      if (r < w.idle) {
        pool = cfg.pools.idle;
      } else if (r < w.idle + w.action) {
        pool = cfg.pools.action;
      }

      let animName = currentRef.current;
      for (let i = 0; i < 8 && animName === currentRef.current; i++) {
        animName = pick(pool);
      }
      play(animName, { loop: false });
    }, gap);
  }, [play]);
  useEffect(() => {
    if (!cfgRef.current.state.enabled) {
      return undefined;
    }

    let alive = true;
    let pollTimer = 0;

    const applyState = (snap) => {
      const c = cfgRef.current;
      const next = (snap && snap.state) || IDLE;
      if (next !== IDLE && !c.state.map[next]) return;
      const prev = stateRef.current;
      const changed = next !== prev;

      stateRef.current = next;
      busyRef.current = next !== IDLE;
      if (changed) {
        sequence.current = null;
        workSince.current = Date.now();
        lastBreak.current = Date.now();
      }
      if (moment.current && !["waiting", "error"].includes(next)) return;
      if (
        !changed &&
        next === "working" &&
        prefsRef.current.playful &&
        !quietRef.current &&
        !document.hidden &&
        !sequence.current &&
        !moment.current &&
        Date.now() - workSince.current > 180000 &&
        Date.now() - lastBreak.current > 180000 &&
        c.pools.workBreak?.length
      ) {
        lastBreak.current = Date.now();
        const clips = [...c.pools.workBreak];
        sequence.current = { state: next, clips };
        play(clips.shift(), { loop: false, sequence: true });
        return;
      }

      if (next === IDLE) {
        if (changed) {
          scheduleNext();
        }
        return;
      }

      const def = c.state.map[next];
      if (!def) {
        return;
      }

      if (changed) {
        if (next === "success") {
          clearTimeout(timerRef.current);
          play(pick(def.anim || []), { loop: false });
          return;
        }
        const enterAnim = pick(c.state.enter[next] || []);
        const loopAnim = pick(def.anim || []) || enterAnim;

        clearTimeout(timerRef.current);

        if (enterAnim) {
          play(enterAnim, { loop: false });
        } else {
          play(loopAnim, { loop: true });
        }
      }
    };

    const poll = async () => {
      try {
        if (taskRuntime) {
          applyState({ state: taskRuntime.animationState() });
          return;
        }
        const res = await fetch(ASSET_BASE + "/state", {
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) {
          throw new Error("HTTP " + res.status);
        }
        const snap = await res.json();
        if (alive) {
          applyState(snap);
        }
      } catch (error) {
        if (alive) applyState({ state: IDLE });
      } finally {
        if (alive) {
          pollTimer = setTimeout(poll, cfgRef.current.state.pollMs);
        }
      }
    };

    poll();
    return () => {
      alive = false;
      clearTimeout(pollTimer);
    };
  }, [play, scheduleNext]);
  finishRef.current = (failed) => {
    const wasMoment = moment.current;
    moment.current = null;
    if (
      wasMoment &&
      pendingMoment.current &&
      !quietRef.current &&
      !document.hidden
    ) {
      const pending = pendingMoment.current;
      pendingMoment.current = null;
      playMoment(pending.animation, pending);
      return;
    }
    const queued = sequence.current;
    if (
      !failed &&
      queued &&
      queued.state === stateRef.current &&
      !quietRef.current &&
      !document.hidden
    ) {
      const next = queued.clips.shift();
      if (next) {
        const loop = queued.clips.length === 0 && busyRef.current;
        play(next, { loop, sequence: true });
        if (loop) sequence.current = null;
        return;
      }
    }
    sequence.current = null;
    if (quietRef.current || document.hidden) return;
    if (failed) {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        play(cfgRef.current.startAnim, { loop: true });
      }, 1500);
      return;
    }
    if (busyRef.current) {
      play(pick(cfgRef.current.state.map[stateRef.current]?.anim || []), {
        loop: true,
      });
    } else {
      play(cfgRef.current.startAnim, { loop: true });
      scheduleNext();
    }
  };
  useEffect(() => () => clearTimeout(timerRef.current), []);
  return { play, playMoment, cancelHover, speak, scheduleNext };
}
