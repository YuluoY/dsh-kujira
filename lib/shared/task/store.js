import { animationState } from "../activity-state.js";
/**
 * @description Own session-scoped progress polling and external-store subscriptions.
 * @param {object} React Host React instance.
 * @returns {object} Bridge, subscription and snapshot APIs.
 */
export function createActivityStore(React) {
  const { useState, useEffect } = React;
  let view = { sessionId: null, data: null, loading: false, error: "" },
    owner = null,
    refresh = () => {};
  const listeners = new Set();
  const publish = (next) => {
    view = next;
    for (const listener of listeners) listener(view);
  };
  function Bridge({ sessionId, navigate }) {
    useEffect(() => {
      if (!sessionId) return;
      const token = {};
      owner = token;
      let active = true,
        timer,
        abort,
        generation = 0,
        lastSignature = "",
        etag = "";
      publish({ sessionId, data: null, loading: true, error: "", navigate });
      const poll = async () => {
        if (!active || owner !== token) return;
        if (document.hidden) {
          timer = setTimeout(poll, 1500);
          return;
        }
        const version = ++generation;
        const controller = new AbortController();
        abort = controller;
        const deadline = setTimeout(() => controller.abort(), 10000);
        try {
          const response = await fetch(
            "/dsh-kujira/activity?sessionId=" + encodeURIComponent(sessionId),
            {
              cache: "no-store",
              signal: controller.signal,
              headers: etag ? { "If-None-Match": etag } : {},
            },
          );
          if (!active || owner !== token || version !== generation) return;
          if (response.status === 304) {
            if (active && owner === token && view.error)
              publish({ ...view, error: "" });
            return;
          }
          if (!response.ok) throw Error();
          const value = await response.json();
          if (!active || owner !== token || version !== generation) return;
          if (!value.ok || value.sessionId !== sessionId) throw Error();
          etag = response.headers?.get?.("etag") || "";
          const signature =
            value.epoch && value.revision != null
              ? `${value.epoch}:${value.revision}:${etag}`
              : JSON.stringify(value.activity);
          if (signature !== lastSignature || view.error || view.loading)
            publish({
              ...view,
              data: value.activity,
              preview: !!value.preview,
              loading: false,
              error: "",
              navigate,
            });
          lastSignature = signature;
        } catch {
          if (active && owner === token && version === generation)
            publish({
              ...view,
              loading: false,
              error: "任务连接暂不可用，显示上次进展",
            });
        } finally {
          clearTimeout(deadline);
          if (active && owner === token && version === generation) timer = setTimeout(poll, 1500);
        }
      };
      refresh = () => {
        generation++;
        clearTimeout(timer);
        abort?.abort();
        etag = "";
        return poll();
      };
      poll();
      return () => {
        active = false;
        clearTimeout(timer);
        abort?.abort();
        if (owner === token) {
          owner = null;
          refresh = () => {};
          publish({ sessionId: null, data: null, loading: false, error: "" });
        }
      };
    }, [sessionId, navigate]);
    return null;
  }
  function useActivity() {
    const [state, set] = useState(view);
    useEffect(() => {
      listeners.add(set);
      set(view);
      return () => listeners.delete(set);
    }, []);
    return state;
  }
  return {
    Bridge,
    useActivity,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot: () => view,
    refresh: () => refresh(),
    animationState: () => (view.error ? "idle" : animationState(view.data)),
  };
}
