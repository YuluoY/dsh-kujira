/**
 * @description Play buffered clips with cancellable loading and a live crossfade.
 * @param {object} options Video refs, playback state and lifecycle callbacks.
 * @returns {object} Playback and cleanup operations.
 */
export function createVideoPlayer({
  videos,
  frontRef,
  tokenRef,
  base,
  quiet,
  revision = () => "",
  onStart,
  onFinish,
  later = setTimeout,
  cancel = clearTimeout,
}) {
  let cleanup = () => {},
    fadeTimer;
  const play = (name, options = {}) => {
    const [a, b] = videos();
    if (!name || !a || !b) return false;
    const front = frontRef.current || a;
    if (front.dataset.name === name && !front.ended && !front.paused) {
      front.loop = !!options.loop;
      return false;
    }
    cleanup();
    cancel(fadeTimer);
    const next = front === a ? b : a;
    const token = ++tokenRef.current;
    let finished = false,
      loadTimer,
      endTimer;
    const finish = (failed = false) => {
      if (finished || token !== tokenRef.current) return;
      finished = true;
      cancel(loadTimer);
      cancel(endTimer);
      if (!next.loop || failed) onFinish(failed);
    };
    const ended = () => finish(false);
    const error = () => finish(true);
    const ready = () => {
      if (token !== tokenRef.current || finished) return;
      next.removeEventListener("canplay", ready);
      cancel(loadTimer);
      front.loop = false;
      frontRef.current = next;
      next.classList.add("is-front");
      front.classList.remove("is-front");
      onStart(name);
      if (quiet()) {
        next.pause();
        next.currentTime = Math.min(0.1, next.duration || 0.1);
      } else {
        next.play().catch(error);
      }
      // The outgoing clip stays live throughout its opacity transition.
      fadeTimer = later(() => {
        if (frontRef.current !== front) front.pause();
      }, 340);
      if (!next.loop && !quiet()) {
        const duration = Number.isFinite(next.duration) ? next.duration : 20;
        let lastTime = next.currentTime || 0;
        const checkProgress = () => {
          if (quiet() || next.currentTime > lastTime) {
            lastTime = next.currentTime || 0;
            endTimer = later(checkProgress, 5000);
          } else finish(true);
        };
        endTimer = later(
          checkProgress,
          Math.min(120000, duration * 1000 + 5000),
        );
      }
    };
    cleanup = () => {
      cancel(loadTimer);
      cancel(endTimer);
      next.removeEventListener("canplay", ready);
      next.removeEventListener("ended", ended);
      next.removeEventListener("error", error);
    };
    next.pause();
    next.dataset.name = name;
    next.dataset.noMirror = options.noMirror ? "true" : "false";
    next.classList.remove("is-front");
    next.muted = true;
    next.loop = !!options.loop;
    const version = revision();
    next.src =
      base +
      "/anim/" +
      encodeURIComponent(name) +
      ".webm" +
      (version ? "?v=" + encodeURIComponent(version) : "");
    next.addEventListener("canplay", ready);
    next.addEventListener("ended", ended);
    next.addEventListener("error", error);
    loadTimer = later(error, 10000);
    next.load();
    return true;
  };
  return {
    play,
    dispose() {
      ++tokenRef.current;
      cleanup();
      cancel(fadeTimer);
      for (const video of videos()) video?.pause();
    },
  };
}
