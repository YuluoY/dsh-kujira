import { cleanNickname } from "./utilities.js";
/**
 * @description Manage persisted appearance preferences and system language and motion changes.
 * @param {object} dependencies Explicit runtime and state dependencies.
 * @returns {object} Public values for the composing component.
 */
export function createPreferences({
  readStore,
  SET_KEY,
  useState,
  I18N,
  useEffect,
  writeStore,
}) {
  const PREF_DEFAULTS = {
    locale: "system",
    theme: "system",
    size: 260,
    opacity: 100,
    motion: "system",
    focus: false,
    care: true,
    playful: true,
    lock: false,
    hideBalance: false,
    usage: true,
    usageDecimals: 4,
    execution: true,
    weatherAuto: true,
    budget: 0,
    taskPeekSeconds: 5,
    showGitHub: true,
    showTask: true,
    nickname: "",
    contextualReactions: true,
    menuLimit: 6,
    menuRadius: 50,
  };
  let pendingPatch = {},
    flushTimer;
  const flush = () => {
    clearTimeout(flushTimer);
    if (!Object.keys(pendingPatch).length) return;
    const stored = readStore(SET_KEY) || {};
    stored.appearance = {
      ...PREF_DEFAULTS,
      ...stored.appearance,
      ...pendingPatch,
    };
    pendingPatch = {};
    writeStore(SET_KEY, stored);
  };
  function readPrefs() {
    return Object.assign(
      {},
      PREF_DEFAULTS,
      (readStore(SET_KEY) || {}).appearance || {},
      pendingPatch,
    );
  }
  function usePreferences() {
    const [prefs, setPrefs] = useState(readPrefs);
    const [systemLanguage, setSystemLanguage] = useState(() =>
      navigator.languages.join(","),
    );
    const locale =
      I18N?.configure(prefs.locale, systemLanguage.split(",")) ||
      navigator.language;
    const [dark, setDark] = useState(
      () => matchMedia("(prefers-color-scheme: dark)").matches,
    );
    const [reduced, setReduced] = useState(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
    useEffect(() => {
      const theme = matchMedia("(prefers-color-scheme: dark)");
      const motion = matchMedia("(prefers-reduced-motion: reduce)");
      const syncTheme = () => setDark(theme.matches);
      const syncMotion = () => setReduced(motion.matches);
      const sync = () => setPrefs(readPrefs());
      const syncLanguage = () =>
        setSystemLanguage(navigator.languages.join(","));
      window.addEventListener("pagehide", flush);
      window.addEventListener("languagechange", syncLanguage);
      theme.addEventListener("change", syncTheme);
      motion.addEventListener("change", syncMotion);
      window.addEventListener("kujira:preferences", sync);
      window.addEventListener("storage", sync);
      return () => {
        flush();
        window.removeEventListener("pagehide", flush);
        window.removeEventListener("languagechange", syncLanguage);
        theme.removeEventListener("change", syncTheme);
        motion.removeEventListener("change", syncMotion);
        window.removeEventListener("kujira:preferences", sync);
        window.removeEventListener("storage", sync);
      };
    }, []);
    const update = (patch) => {
      const current = readPrefs();
      if (
        Object.entries(patch).every(([key, value]) =>
          Object.is(current[key], value),
        )
      )
        return;
      const next = Object.assign({}, current, patch);
      next.nickname = cleanNickname(next.nickname);
      pendingPatch = {
        ...pendingPatch,
        ...patch,
        ...("nickname" in patch ? { nickname: next.nickname } : {}),
      };
      clearTimeout(flushTimer);
      flushTimer = setTimeout(flush, 200);
      setPrefs(next);
      window.dispatchEvent(new Event("kujira:preferences"));
    };
    return {
      prefs,
      locale,
      update,
      theme: prefs.theme === "system" ? (dark ? "dark" : "light") : prefs.theme,
      reduced:
        prefs.motion === "reduced" || (prefs.motion === "system" && reduced),
    };
  }
  return { PREF_DEFAULTS, readPrefs, usePreferences };
}
