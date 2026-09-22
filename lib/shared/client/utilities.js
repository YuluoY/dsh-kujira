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
    readStore: readLocalState,
    writeStore: writeLocalState,
    localHour,
    greetingFor,
  };
}

const STATE_KEYS = {
  settings: "dsh-kujira:settings", growth: "dsh-kujira:growth",
  position: "dsh-kujira:position", hint: "dsh-kujira:hint",
};
const STATE_STAMP = "dsh-kujira:state-updated";
const localStateStorage = () => {
  try { return globalThis.localStorage; }
  catch { return null; }
};
const emitStorage = (key) => {
  if (typeof window !== "undefined")
    window.dispatchEvent(Object.assign(new Event("kujira:storage"), { detail: { key } }));
};

/**
 * @description Read a persisted value, recovering its previous valid copy when JSON is damaged.
 * @param {string} key Storage key.
 * @param {object} storage Local storage adapter.
 * @returns {any} Persisted value or null.
 */
export function readLocalState(key, storage = localStateStorage()) {
  for (const name of [key, key + ":backup"]) {
    try {
      const raw = storage?.getItem(name);
      if (raw != null) return JSON.parse(raw);
    } catch {
      // Try the previous valid value.
    }
  }
  return null;
}

/**
 * @description Persist a confirmed edit before notifying backup subscribers.
 * @param {string} key Storage key.
 * @param {any} value JSON value; null removes the value and its backup.
 * @param {object} storage Local storage adapter.
 * @returns {boolean} Whether local persistence completed.
 */
export function writeLocalState(key, value, storage = localStateStorage()) {
  try {
    if (!storage) throw Error("storage-unavailable");
    const body = JSON.stringify(value);
    if (value !== null && storage.getItem(key) === body) return true;
    if (value === null) {
      storage.removeItem(key + ":backup");
      storage.removeItem(key);
    } else {
      const previous = readLocalState(key, storage);
      if (previous !== null) {
        try { storage.setItem(key + ":backup", JSON.stringify(previous)); }
        catch { /* Saving the current value still takes priority. */ }
      }
      storage.setItem(key, body);
    }
    if (Object.values(STATE_KEYS).includes(key)) {
      storage.setItem(STATE_STAMP, JSON.stringify(Math.max(Date.now(), Number(readLocalState(STATE_STAMP, storage)) || 0) + 1));
      emitStorage(key);
    }
    return true;
  } catch {
    console.warn("[kujira] Local preference persistence failed");
    return false;
  }
}

/**
 * @description Capture settings and companion data with a monotonic local save timestamp.
 * @param {object} storage Local storage adapter.
 * @returns {object|null} Existing preferences; an untouched installation produces no defaults snapshot.
 */
export function captureLocalState(storage = localStateStorage()) {
  const settings = readLocalState(STATE_KEYS.settings, storage);
  const growth = readLocalState(STATE_KEYS.growth, storage);
  const position = readLocalState(STATE_KEYS.position, storage);
  const hint = readLocalState(STATE_KEYS.hint, storage);
  if (!settings && !growth && !position && hint === null) return null;
  return { ...(settings && typeof settings === "object" ? settings : {}),
    __growth: growth, __position: position, __hint: hint,
    __updatedAt: Number(readLocalState(STATE_STAMP, storage)) || 0 };
}

/**
 * @description Restore a snapshot while keeping browser and native-window coordinates separate.
 * @param {object} value Persisted or explicitly handed-off snapshot.
 * @param {object} options Storage adapter and position preservation.
 * @returns {boolean} Whether restoration completed.
 */
export function restoreLocalState(value, { storage = localStateStorage(), preservePosition = false } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const { __growth, __position, __hint, __updatedAt, ...settings } = value;
  try {
    const write = (key, item) => {
      if (item === undefined) return;
      if (item === null) { storage.removeItem(key + ":backup"); storage.removeItem(key); }
      else storage.setItem(key, JSON.stringify(item));
    };
    const previous = readLocalState(STATE_KEYS.settings, storage) || {};
    write(STATE_KEYS.settings, { ...previous, ...settings,
      ...(settings.appearance ? { appearance: { ...previous.appearance, ...settings.appearance } } : {}) });
    if (__growth) write(STATE_KEYS.growth, __growth);
    if (!preservePosition) write(STATE_KEYS.position, __position);
    write(STATE_KEYS.hint, __hint);
    write(STATE_STAMP, Number(__updatedAt) || Math.max(Date.now(), Number(readLocalState(STATE_STAMP, storage)) || 0) + 1);
    if (typeof window !== "undefined") window.dispatchEvent(new Event("kujira:preferences"));
    return true;
  } catch {
    console.warn("[kujira] Preference restoration failed");
    return false;
  }
}

/**
 * @description Resolve independently sized or proportional radial buttons.
 * @param {object} prefs Appearance preferences.
 * @param {number} size Mascot size in CSS pixels.
 * @returns {number} Bounded button diameter.
 */
export function menuButtonSize(prefs, size) {
  const requested =
    prefs.menuSizing === "auto" ? (size * 34) / 260 : prefs.menuSize;
  return Math.round(
    Math.max(
      28,
      Math.min(prefs.menuSizing === "auto" ? 48 : 56, Number(requested) || 36),
    ),
  );
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

/**
 * @description Create the localized device-clock surface without extra model or network work.
 * @param {object} deps Existing React and formatting dependencies.
 * @returns {Function} Clock component.
 */
export function createLocalClock({ h, useState, useEffect, I18N }) {
  return function LocalClock() {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
      const timer = setInterval(() => {
        if (!document.hidden) setNow(new Date());
      }, 1000);
      return () => clearInterval(timer);
    }, []);
    return h(
      "div",
      { className: "kj-clock", "aria-live": "off", "data-tooltip": "设备时间" },
      h(
        "time",
        { dateTime: now.toISOString() },
        I18N.time(now, {
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
        }),
      ),
      h(
        "span",
        null,
        I18N.date(now, { month: "short", day: "numeric", weekday: "short" }),
      ),
    );
  };
}
