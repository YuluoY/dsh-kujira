/**
 * @description Normalize optional task collections and determine the one primary operation.
 * @param {object|null} activity Public host snapshot.
 * @returns {object|null} Bounded panel model.
 */
export function taskPresentation(activity) {
  if (!activity || typeof activity !== "object") return null;
  const list = (value, max) =>
    Array.isArray(value)
      ? value.filter((item) => item && typeof item === "object").slice(0, max)
      : [];
  const todos = list(activity.todos, 50);
  const allOperations = list(activity.operations, 200);
  const recent = new Set(
    allOperations
      .map((op, index) => (op.status === "running" ? null : index))
      .filter((index) => index !== null)
      .slice(-40),
  );
  const operations = allOperations.filter(
    (op, index) => op.status === "running" || recent.has(index),
  );
  const knownTodos = todos.filter((item) =>
    ["pending", "in_progress", "completed", "cancelled"].includes(item.status),
  );
  const total = knownTodos.length
    ? knownTodos.filter((item) => item.status !== "cancelled").length
    : Number(activity.tasks?.total);
  const completed = knownTodos.length
    ? knownTodos.filter((item) => item.status === "completed").length
    : Number(activity.tasks?.completed);
  const tasks =
    Number.isFinite(total) && total > 0
      ? {
          total: Math.floor(total),
          completed: Math.min(
            Math.floor(total),
            Math.max(0, Number.isFinite(completed) ? Math.floor(completed) : 0),
          ),
        }
      : null;
  const current =
    activity.current?.status === "running" &&
    activity.current.stage === activity.stage &&
    !activity.endedAt &&
    !["waiting", "paused", "error", "done", "stopped"].includes(activity.stage)
      ? activity.current
      : null;
  return {
    ...activity,
    stage: activity.stage || "unknown",
    title: typeof activity.title === "string" ? activity.title : "",
    current,
    tasks,
    todos,
    children: list(activity.children, 200).sort((a, b) => {
      const rank = (stage) =>
        ["waiting", "error"].includes(stage)
          ? 0
          : ["done", "stopped"].includes(stage)
            ? 2
            : 1;
      return rank(a.stage) - rank(b.stage);
    }),
    records: operations
      .map((op) =>
        activity.stage === "paused" && op.status === "running"
          ? { ...op, status: "paused" }
          : op,
      )
      .reverse(),
    operations: operations.filter(
      (operation) => !current || operation.id !== current.id,
    ),
    artifacts: list(activity.artifacts, 20),
  };
}
