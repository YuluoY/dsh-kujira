import { createVideoPlayer } from "./video-player.js";
import { createAnimationDirector } from "./animation-director.js";
import { NO_MIRROR } from "./animation-catalog.js";
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
  sceneContextRef,
  dragRef,
  ready,
}) {
  const sequence = useRef(null),
    workSince = useRef(0),
    lastBreak = useRef(0);
  const moment = useRef(null),
    pendingMoment = useRef(null),
    finishRef = useRef(() => {});
  const director = useRef(null),
    resume = useRef(() => {});
  if (!director.current) director.current = createAnimationDirector();
  const player = useRef(null);
  if (!player.current)
    player.current = createVideoPlayer({
      videos: () => [aRef.current, bRef.current],
      frontRef,
      tokenRef,
      base: ASSET_BASE,
      revision: () => cfgRef.current.animationRevision || "",
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
    return player.current.play(name, {
      ...opts,
      noMirror: NO_MIRROR.has(name),
    });
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
      if (!document.hidden && !quietRef.current) resume.current();
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
      if (
        !animation ||
        quietRef.current ||
        document.hidden ||
        dragRef?.current?.moved ||
        ["waiting", "error"].includes(stateRef.current) ||
        (options.guard && !options.guard())
      )
        return false;
      const request = { animation, expiresAt: Date.now() + 15000, ...options };
      if (moment.current && !options.interrupt) {
        if (
          options.ambient &&
          pendingMoment.current &&
          !pendingMoment.current.ambient
        )
          return false;
        if (moment.current.animation !== animation || options.repeat)
          pendingMoment.current = request;
        return true;
      }
      clearTimeout(timerRef.current);
      pendingMoment.current = null;
      moment.current = request;
      if (!play(animation, { loop: false, moment: true, restart: !!options.repeat })) {
        moment.current = null;
        return false;
      }
      return true;
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
      const chosen = director.current.next({
        config: cfgRef.current,
        prefs: prefsRef.current,
        ...sceneContextRef?.current?.(),
      });
      const clips = [...chosen.clips];
      sequence.current = clips.length > 1 ? { state: IDLE, clips } : null;
      play(clips.shift(), { loop: false, sequence: true });
    }, gap);
  }, [play]);
  useEffect(() => {
    if (!ready || !cfgRef.current.state.enabled) {
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
        if (prev === IDLE || ["waiting", "error", "success"].includes(prev)) {
          workSince.current = Date.now();
          lastBreak.current = Date.now();
        }
      }
      if (dragRef?.current?.moved) return;
      if (moment.current && !["waiting", "error"].includes(next)) return;
      if (
        !changed &&
        next === "working" &&
        prefsRef.current.playful &&
        prefsRef.current.contextualReactions !== false &&
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
        if (document.hidden) return;
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
  }, [play, scheduleNext, ready]);
  resume.current = () => {
    if (
      ready &&
      !busyRef.current &&
      !moment.current &&
      !sequence.current &&
      !dragRef?.current?.moved
    )
      scheduleNext();
  };
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
      if (
        pending.expiresAt > Date.now() &&
        playMoment(pending.animation, pending)
      )
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
  const playScene = useCallback(
    (key, options) =>
      playMoment(director.current.scene(cfgRef.current, key), options),
    [playMoment],
  );
  return { play, playMoment, playScene, cancelHover, speak, scheduleNext };
}
