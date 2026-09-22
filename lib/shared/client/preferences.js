import { cleanNickname } from "./utilities.js";
import { configureCurrency, EXCHANGE_CURRENCIES } from "../exchange.js";

export const PREFERENCE_NUMBERS = Object.freeze({
  size: {min:120,max:360,step:1,integer:true},
  opacity: {min:35,max:100,step:1,integer:true},
  menuRadius: {min:0,max:50,step:1,integer:true},
  menuSize: {min:28,max:56,step:1,integer:true},
  menuLimit: {min:3,max:8,step:1,integer:true},
  taskPeekSeconds: {min:1,max:60,step:1,integer:true},
  usageDecimals: {min:0,max:6,step:1,integer:true},
  budget: {min:0,max:1000000,step:0.01},
});
/**
 * @description Validate persisted and updated appearance values using the same constraints as the fields.
 */
export function normalizePreferences(value, defaults) {
  const next={...defaults,...value};
  for(const [key,rule] of Object.entries(PREFERENCE_NUMBERS)) {
    const n=value?.[key];
    next[key]=typeof n==='number' && Number.isFinite(n)
      ? Math.min(rule.max,Math.max(rule.min,rule.integer?Math.round(n):Math.round(n*100)/100)) : defaults[key];
  }
  for(const [key,initial] of Object.entries(defaults))
    if(typeof initial==='boolean')next[key]=typeof value?.[key]==='boolean'?value[key]:initial;
  for(const [key,allowed] of Object.entries({locale:['system','zh-CN','en-US','ko-KR','ru-RU'],displayCurrency:['original',...EXCHANGE_CURRENCIES],weatherRegion:['auto','cn','global'],theme:['system','light','dark'],motion:['system','full','reduced'],menuSizing:['fixed','auto']}))
    if(!allowed.includes(next[key]))next[key]=defaults[key];
  next.nickname=cleanNickname(next.nickname);
  return next;
}

// Read the resolved palette published by DSH's ThemePresenter.
export function readHostTheme() {
  if (typeof document === "undefined") return "light";
  return document.body?.hasAttribute("data-ds-dark-theme") ? "dark" : "light";
}

// Observe only the host palette attribute, never the plugin's own theme.
export function observeHostTheme(onChange) {
  if (
    typeof document === "undefined" ||
    !document.body ||
    typeof MutationObserver === "undefined"
  )
    return () => {};
  const observer = new MutationObserver(() => onChange(readHostTheme()));
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ["data-ds-dark-theme"],
  });
  onChange(readHostTheme());
  return () => observer.disconnect();
}

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
    displayCurrency: "original",
    weatherRegion: "auto",
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
    hoverProgress: true,
    showGitHub: true,
    showTask: true,
    nickname: "",
    contextualReactions: true,
    menuLimit: 6,
    menuRadius: 50,
    menuSizing: "fixed",
    menuSize: 36,
  };
  function readPrefs() {
    return normalizePreferences((readStore(SET_KEY) || {}).appearance, PREF_DEFAULTS);
  }

  function usePreferences() {
    const [prefs, setPrefs] = useState(readPrefs);
    configureCurrency(prefs.displayCurrency);
    const [systemLanguage, setSystemLanguage] = useState(() =>
      navigator.languages.join(","),
    );
    const targetLocale =
      I18N?.resolveLocale?.(prefs.locale, systemLanguage.split(",")) ||
      I18N?.configure(prefs.locale, systemLanguage.split(",")) ||
      navigator.language;
    const [loadedLocale, setLoadedLocale] = useState(targetLocale);
    const locale = I18N?.configure(loadedLocale) || loadedLocale;
    useEffect(() => {
      let active = true;
      Promise.resolve(I18N?.loadLocale?.(targetLocale))
        .then(() => {
          if (active) setLoadedLocale(targetLocale);
        })
        .catch(() => {});
      return () => {
        active = false;
      };
    }, [targetLocale]);
    const [desktopSaver, setDesktopSaver] = useState(false);
    useEffect(() => globalThis.kujiraDesktop?.onPower(setDesktopSaver) || (() => {}), []);
    const [hostTheme, setHostTheme] = useState(readHostTheme);
    const [reduced, setReduced] = useState(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
    useEffect(() => {
      const stopTheme = observeHostTheme(setHostTheme);
      const motion = matchMedia("(prefers-reduced-motion: reduce)");
      const syncMotion = () => setReduced(motion.matches);
      const sync = () => setPrefs(readPrefs());
      const syncLanguage = () =>
        setSystemLanguage(navigator.languages.join(","));
      window.addEventListener("languagechange", syncLanguage);
      motion.addEventListener("change", syncMotion);
      window.addEventListener("kujira:preferences", sync);
      window.addEventListener("storage", sync);
      return () => {
        window.removeEventListener("languagechange", syncLanguage);
        stopTheme();
        motion.removeEventListener("change", syncMotion);
        window.removeEventListener("kujira:preferences", sync);
        window.removeEventListener("storage", sync);
      };
    }, []);
    const update = (patch) => {
      const current = readPrefs();
      const normalized = normalizePreferences({...current,...patch}, PREF_DEFAULTS);
      patch = Object.fromEntries(Object.keys(patch).filter(key=>key in PREF_DEFAULTS).map(key=>[key,normalized[key]]));
      if (
        Object.entries(patch).every(([key, value]) =>
          Object.is(current[key], value),
        )
      )
        return;
      const next = Object.assign({}, current, patch);
      next.nickname = cleanNickname(next.nickname);
      const stored = readStore(SET_KEY) || {};
      writeStore(SET_KEY, { ...stored, appearance: next });
      setPrefs(next);
      window.dispatchEvent(new Event("kujira:preferences"));
    };
    return {
      prefs,
      locale,
      update,
      // Keep the persisted "system" key compatible; it now means host appearance.
      theme: ["light", "dark"].includes(prefs.theme) ? prefs.theme : hostTheme,
      reduced:
        desktopSaver || prefs.motion === "reduced" || (prefs.motion === "system" && reduced),
    };
  }
  return { PREF_DEFAULTS, readPrefs, usePreferences };
}
