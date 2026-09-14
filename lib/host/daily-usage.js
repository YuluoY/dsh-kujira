/**
 * @description Backfill today's visible session costs on demand while the agent is idle.
 */
export function createDailyUsage({
  getController,
  access,
  inventory,
  isBusy,
  now = Date.now,
}) {
  let state = { status: "idle", scanned: 0 },
    pending,
    cachedAt = null,
    controller;
  const start = () => {
    if (pending || (cachedAt !== null && now() - cachedAt < 300000)) return;
    if (isBusy()) {
      state = { ...state, status: "partial" };
      return;
    }
    controller = new AbortController();
    const signal = controller.signal;
    const timeout = setTimeout(() => controller.abort(), 20000);
    state = { status: "loading", scanned: 0 };
    pending = (async () => {
      const service = getController();
      if (!service?.list) throw Error("history-unavailable");
      const today = new Date(now());
      today.setHours(0, 0, 0, 0);
      const result = await service.list({}, signal);
      const queue = (result.items || [])
        .filter((row) => row.updatedAt >= today.getTime())
        .map((row) => ({ id: row.sessionId }));
      const seen = new Set();
      let incomplete = false;
      while (queue.length && seen.size < 128 && !signal.aborted && !isBusy()) {
        const entry = queue.shift();
        if (!entry.id || seen.has(entry.id)) continue;
        seen.add(entry.id);
        const session = await access.prepare(entry.id, { signal });
        if (
          !session ||
          (entry.parent && session.header?.parentSession !== entry.parent)
        ) {
          incomplete = true;
          continue;
        }
        const children = await inventory.account(session);
        for (const id of children) queue.push({ id, parent: entry.id });
        state = { status: "loading", scanned: seen.size };
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (queue.length || signal.aborted || isBusy()) incomplete = true;
      state = {
        status: incomplete ? "partial" : "complete",
        scanned: seen.size,
      };
      if (!incomplete) cachedAt = now();
    })()
      .catch(() => {
        state = { ...state, status: "partial" };
      })
      .finally(() => {
        clearTimeout(timeout);
        pending = null;
      });
  };
  return { start, snapshot: () => state, dispose: () => controller?.abort() };
}
