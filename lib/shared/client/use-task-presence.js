import { createPresenceClock } from "./presence-clock.js";
/**
 * @description Subscribe to task progress and manage timed, hover and keyboard visibility.
 * @param {object} dependencies Explicit runtime and state dependencies.
 * @returns {object} Public values for the composing component.
 */
export function useTaskPresence({
  useEffect,
  useRef,
  ensureTaskRuntime,
  setTaskView,
  taskView,
  setTaskVisible,
  clamp,
  prefs,
  hoverTimer,
  setTaskHovered,
}) {
  useEffect(() => {
    let active = true,
      dispose;
    ensureTaskRuntime()
      .then((runtime) => {
        if (active) {
          setTaskView(runtime.snapshot());
          dispose = runtime.subscribe(setTaskView);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
      dispose?.();
    };
  }, []);
  const taskKey = [
    taskView.sessionId,
    taskView.data?.startedAt,
    ["waiting", "error", "done", "stopped", "paused"].includes(
      taskView.data?.stage,
    )
      ? taskView.data.stage
      : "running",
  ].join("|");
  const clock = useRef(null),
    origin = useRef("auto");
  const duration = clamp(Number(prefs.taskPeekSeconds) || 5, 1, 60) * 1000;
  useEffect(() => {
    clock.current = createPresenceClock(setTaskVisible);
    origin.current = "auto";
    clock.current.show(duration);
    return () => clock.current.dispose();
  }, [taskKey, duration]);
  useEffect(() => {
    const sync = () => clock.current?.sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  useEffect(() => {
    if (prefs.hoverProgress === false && origin.current === "hover") {
      clock.current?.hide();
      setTaskHovered(false);
    }
  }, [prefs.hoverProgress]);
  const enterTask = () => {
    if (prefs.hoverProgress === false) return;
    origin.current = "hover";
    clearTimeout(hoverTimer.current);
    setTaskHovered(true);
    clock.current?.show(duration);
  };
  const leaveTask = () => {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setTaskHovered(false), 220);
  };
  return { enterTask, leaveTask };
}
