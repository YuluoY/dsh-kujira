/**
 * @description Subscribe to task progress and manage timed, hover and keyboard visibility.
 * @param {object} dependencies Explicit runtime and state dependencies.
 * @returns {object} Public values for the composing component.
 */
export function useTaskPresence({
  useEffect,
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
  useEffect(() => {
    setTaskVisible(true);
    const timer = setTimeout(
      () => setTaskVisible(false),
      clamp(Number(prefs.taskPeekSeconds) || 8, 1, 60) * 1000,
    );
    return () => clearTimeout(timer);
  }, [taskKey, prefs.taskPeekSeconds]);
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  const enterTask = () => {
    clearTimeout(hoverTimer.current);
    setTaskHovered(true);
  };
  const leaveTask = () => {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setTaskHovered(false), 220);
  };
  return { enterTask, leaveTask };
}
