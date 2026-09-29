import { createPoller } from "./polling.js";

/**
 * @description Share confirmed scheduler state across settings, main chats and sidebar composers.
 * @param {object} React Host hooks.
 * @param {string} base Plugin resource prefix.
 * @param {Function} onSettled Refresh dependent task views after a command settles.
 * @returns {object} Subscription, refresh and serialized scheduler commands.
 */
export function createSchedulerStore(React, base = "/dsh-kujira", onSettled = () => {}) {
  let view = { data: null, busy: false, error: "" }, poller, generation = 0;
  const listeners = new Set();
  const publish = (patch) => {
    view = { ...view, ...patch };
    for (const listener of listeners) listener(view);
  };
  const read = async (signal) => {
    const version = generation;
    try {
      const response = await fetch(base + "/scheduler", { cache: "no-store", signal });
      if (!response.ok) throw Error();
      const data = await response.json();
      if (!data.ok) throw Error();
      if (!signal.aborted && version === generation && !view.busy)
        publish({ data, error: "" });
    } catch (error) {
      if (!signal.aborted && version === generation && !view.busy)
        publish({ error: "调度服务暂不可用" });
      throw error;
    }
  };
  const subscribe = (listener) => {
    listeners.add(listener);
    listener(view);
    if (!poller) poller = createPoller(read);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) {
        generation++;
        poller?.dispose();
        poller = null;
        view = { ...view, data: null, error: "" };
      }
    };
  };
  const command = async (input) => {
    if (view.busy) return false;
    generation++;
    publish({ busy: true, error: "" });
    try {
      const response = await fetch(base + "/scheduler", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Kujira-Settings": "1" },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw Error();
      const data = await response.json();
      if (!data.ok) throw Error();
      publish({ data });
      return true;
    } catch {
      publish({ error: "未能确认调度设置，请等待重新同步" });
      return false;
    } finally {
      generation++;
      publish({ busy: false });
      poller?.refresh();
      onSettled();
    }
  };
  function useScheduler() {
    const [state, setState] = React.useState(view);
    React.useEffect(() => subscribe(setState), []);
    return state;
  }
  return {
    useScheduler,
    subscribe,
    snapshot: () => view,
    configure: (enabled) => command({ enabled }),
    resume: (sessionId, pauseId) => command({ action: "resume", sessionId, pauseId }),
  };
}
