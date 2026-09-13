/**
 * @description Map public task status to a lightweight animation state.
 * @param {object} activity Task progress.
 * @param {number} now Current timestamp.
 * @returns {string} Animation state.
 */
export function animationState(activity, now = Date.now()) {
  if (!activity) return "idle";
  if (activity.endedAt && activity.stage === "done")
    return now - activity.endedAt < 10000 ? "success" : "idle";
  return (
    {
      thinking: "thinking",
      reading: "thinking",
      searching: "thinking",
      working: "working",
      editing: "working",
      testing: "working",
      delegating: "working",
      summarizing: "result",
      retrying: "result",
      paused: "idle",
      waiting: "waiting",
      error: "error",
      stopped: "idle",
    }[activity.stage] || "idle"
  );
}
