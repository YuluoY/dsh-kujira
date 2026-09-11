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
  const play = useCallback((animName, opts) => {
    const vids = [aRef.current, bRef.current];
    if (!animName || !vids[0] || !vids[1]) {
      return;
    }

    const o = opts || {};
    if (!o.sequence) sequence.current = null;
    const front = frontRef.current || vids[0];
    const next = front === vids[0] ? vids[1] : vids[0];

    if (next.dataset.name === animName && !next.paused) {
      next.loop = Boolean(o.loop);
      return;
    }

    const token = ++tokenRef.current;

    next.dataset.name = animName;
    next.classList.remove("is-front");
    next.muted = true;
    next.loop = Boolean(o.loop);
    next.src = ASSET_BASE + "/anim/" + encodeURIComponent(animName) + ".webm";

    const onCanPlay = () => {
      next.removeEventListener("canplay", onCanPlay);
      if (token !== tokenRef.current) {
        return;
      }
      front.pause();
      if (quietRef.current || document.hidden) {
        next.pause();
        next.currentTime = 0.1;
      } else next.play().catch(() => {});
      next.classList.add("is-front");
      front.classList.remove("is-front");
      frontRef.current = next;
      currentRef.current = animName;
      const c = cfgRef.current;
      if (c.debug.showLabel || c.ui.showLabel) {
        setLabel(animName);
      }
    };

    next.addEventListener("canplay", onCanPlay);
    next.load();
  }, []);
  useEffect(() => {
    const refresh = () => {
      applyVisual();
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
  const momentTimer = useRef(null);
  const playMoment = useCallback(
    (animation, duration = 2200) => {
      clearTimeout(momentTimer.current);
      clearTimeout(timerRef.current);
      play(animation, { loop: false });
      const token = tokenRef.current;
      momentTimer.current = setTimeout(() => {
        if (tokenRef.current !== token) return;
        const state = stateRef.current;
        play(
          pick(cfgRef.current.state.map[state]?.anim || []) ||
            cfgRef.current.startAnim,
          { loop: true },
        );
      }, duration);
    },
    [play],
  );
  useEffect(() => () => clearTimeout(momentTimer.current), []);
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
      if (
        !changed &&
        next === "working" &&
        prefsRef.current.playful &&
        !quietRef.current &&
        !document.hidden &&
        !sequence.current &&
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
          const holdMs = Number(def.enterMs) || 10000;
          timerRef.current = setTimeout(() => {
            if (stateRef.current === next) {
              play(loopAnim, { loop: true });
            }
          }, holdMs);
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
  useEffect(() => {
    const onEnded = (e) => {
      if (e.currentTarget !== frontRef.current) {
        return;
      }
      const queued = sequence.current;
      if (
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
        sequence.current = null;
      }
      if (e.currentTarget.loop) return;
      if (busyRef.current) {
        play(pick(cfgRef.current.state.map[stateRef.current]?.anim || []), {
          loop: true,
        });
        return;
      }
      scheduleNext();
    };

    const a = aRef.current;
    const b = bRef.current;
    if (a) {
      a.addEventListener("ended", onEnded);
    }
    if (b) {
      b.addEventListener("ended", onEnded);
    }
    return () => {
      if (a) {
        a.removeEventListener("ended", onEnded);
      }
      if (b) {
        b.removeEventListener("ended", onEnded);
      }
      clearTimeout(timerRef.current);
    };
  }, [scheduleNext, play]);
  return { play, playMoment, speak, scheduleNext };
}
