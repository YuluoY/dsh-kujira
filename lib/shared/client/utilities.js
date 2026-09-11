/**
 * @description Provide storage, viewport geometry and time-based greeting helpers.
 * @returns {object} Public values for the composing component.
 */
export function createUtilities() {
  const ORB_FALLBACK_R = 180;
  function liveViewport() {
    if (typeof window === "undefined") {
      return { w: 1024, h: 768 };
    }

    return { w: window.innerWidth, h: window.innerHeight };
  }
  function layoutFor(cfg, viewport, ARC) {
    const explicit = Number(cfg.ui.arc.radius);
    const wanted =
      Number.isFinite(explicit) && explicit > 0
        ? explicit
        : ARC
          ? ARC.orbRadius(cfg.size)
          : ORB_FALLBACK_R;

    return ARC ? ARC.fitRadius(wanted, viewport) : wanted;
  }
  const pick = (list) =>
    list && list.length ? list[Math.floor(Math.random() * list.length)] : "";
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function readStore(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }
  function writeStore(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {}
  }
  function localHour(ts) {
    return new Date(ts).getHours();
  }
  function greetingFor(ts) {
    const hr = localHour(ts);
    if (hr >= 23 || hr < 6) {
      return null;
    }
    if (hr < 9) {
      return "早上好，今天从哪儿开始？";
    }
    if (hr < 12) {
      return "上午好";
    }
    if (hr < 14) {
      return "中午了，吃了吗？";
    }
    if (hr < 18) {
      return "下午好";
    }
    return "傍晚了，今天还顺利吗";
  }
  return {
    ORB_FALLBACK_R,
    liveViewport,
    layoutFor,
    pick,
    clamp,
    readStore,
    writeStore,
    localHour,
    greetingFor,
  };
}
