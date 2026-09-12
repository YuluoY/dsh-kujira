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

/**
 * @description Normalize a short display name without controls or broken graphemes.
 * @param {unknown} value User or system name.
 * @returns {string} Display-safe name, at most 24 graphemes.
 */
export function cleanNickname(value) {
  if (typeof value !== "string") return "";
  const text = value
    .normalize("NFC")
    .replace(/\p{Cc}|[\u202a-\u202e\u2066-\u2069]/gu, "")
    .trim();
  const parts =
    typeof Intl.Segmenter === "function"
      ? [
          ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
            text,
          ),
        ].map((x) => x.segment)
      : Array.from(text);
  return parts.slice(0, 24).join("");
}
/**
 * @description Resolve a local account name without consulting repository authors.
 * @param {Function} readName Local operating-system lookup.
 * @returns {string} A personal account name or an empty fallback.
 */
export function systemNickname(readName) {
  try {
    const name = cleanNickname(readName());
    return /^(root|admin|administrator|system|unknown|runner)$/i.test(name)
      ? ""
      : name;
  } catch {
    return "";
  }
}
/**
 * @description Apply explicit name, local account and localized friendly fallback in order.
 * @param {string|null} greeting Greeting source copy.
 * @param {string} custom Explicit preference.
 * @param {string} system Local account name.
 * @param {Function} t Translator.
 * @returns {string|null} Localized greeting.
 */
export function personalGreeting(greeting, custom, system, t) {
  if (!greeting) return null;
  const name = cleanNickname(custom) || cleanNickname(system) || t("小可爱");
  return t("{name}，{greeting}", { name, greeting: t(greeting) });
}
