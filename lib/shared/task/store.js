import { animationState } from "../activity.js";
/**
 * @description Own session-scoped progress polling and external-store subscriptions.
 * @param {object} React Host React instance.
 * @returns {object} Bridge, subscription and snapshot APIs.
 */
export function createActivityStore(React) {
  const { useState, useEffect } = React;
  let view = { sessionId: null, data: null, loading: false, error: "" },
    owner = null;
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
        lastSignature = "",
        etag = "";
      publish({ sessionId, data: null, loading: true, error: "", navigate });
      const poll = async () => {
        if (!active || owner !== token) return;
        if (document.hidden) {
          timer = setTimeout(poll, 1500);
          return;
        }
        abort = new AbortController();
        const deadline = setTimeout(() => abort.abort(), 10000);
        try {
          const response = await fetch(
            "/dsh-kujira/activity?sessionId=" + encodeURIComponent(sessionId),
            {
              cache: "no-store",
              signal: abort.signal,
              headers: etag ? { "If-None-Match": etag } : {},
            },
          );
          if (response.status === 304) {
            if (active && owner === token && view.error)
              publish({ ...view, error: "" });
            return;
          }
          if (!response.ok) throw Error();
          const value = await response.json();
          if (!active || owner !== token) return;
          if (!value.ok || value.sessionId !== sessionId) throw Error();
          etag = response.headers?.get?.("etag") || "";
          const signature = JSON.stringify(value.activity);
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
          if (active && owner === token)
            publish({
              ...view,
              loading: false,
              error: "任务连接暂不可用，显示上次进展",
            });
        } finally {
          clearTimeout(deadline);
          if (active && owner === token) timer = setTimeout(poll, 1500);
        }
      };
      poll();
      return () => {
        active = false;
        clearTimeout(timer);
        abort?.abort();
        if (owner === token) {
          owner = null;
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
    animationState: () => (view.error ? "idle" : animationState(view.data)),
  };
}
