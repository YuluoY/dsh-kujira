/**
 * @description Poll once at a time with visibility control and failure backoff.
 * @param {(signal:AbortSignal) => Promise<unknown>} read Fetch and publish using the supplied signal.
 * @param {{interval?:number,timeout?:number,maxDelay?:number,document?:Pick<Document,"hidden"|"addEventListener"|"removeEventListener">}} options Interval, deadline and visibility surface.
 * @returns {{refresh:() => Promise<void>,dispose:() => void}} Refresh and disposal operations.
 */
export function createPoller(
  read,
  {
    interval = 1500,
    timeout = 10000,
    maxDelay = 30000,
    document: surface = globalThis.document,
  } = {},
) {
  let stopped = false,
    failures = 0;
  /**
   * @type {{controller:AbortController,promise:Promise<void>}|null}
   */
  let active = null;
  /**
   * @type {ReturnType<typeof setTimeout>|undefined}
   */
  let timer;
  /**
   * @returns {Promise<void>} Refresh completion.
   */
  const refresh = () => {
    if (stopped || surface?.hidden) return Promise.resolve();
    if (active) return active.promise;
    clearTimeout(timer);
    const current = {
      controller: new AbortController(),
      promise: Promise.resolve(),
    };
    active = current;
    const deadline = setTimeout(
      () => current.controller.abort(Error("poll-timeout")),
      timeout,
    );
    current.promise = Promise.resolve()
      .then(() => read(current.controller.signal))
      .then(() => {
        failures = 0;
      })
      .catch(() => {
        failures++;
      })
      .finally(() => {
        clearTimeout(deadline);
        if (active !== current) return;
        active = null;
        if (!stopped && !surface?.hidden)
          timer = setTimeout(
            refresh,
            Math.min(maxDelay, interval * 2 ** Math.min(failures, 5)),
          );
      });
    return current.promise;
  };
  const visible = () => {
    clearTimeout(timer);
    if (surface?.hidden) active?.controller.abort(Error("page-hidden"));
    else refresh();
  };
  surface?.addEventListener?.("visibilitychange", visible);
  refresh();
  return {
    refresh,
    dispose() {
      stopped = true;
      clearTimeout(timer);
      active?.controller.abort(Error("poll-disposed"));
      surface?.removeEventListener?.("visibilitychange", visible);
    },
  };
}
