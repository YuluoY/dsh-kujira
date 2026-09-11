/**
 * @description Load behavior modules and configuration before starting mascot playback.
 * @param {object} dependencies Explicit runtime and state dependencies.
 * @returns {object} Public values for the composing component.
 */
export function usePetConfig({
  useEffect,
  injectCss,
  readStore,
  SET_KEY,
  setCity,
  ASSET_BASE,
  SMRef,
  GROWRef,
  ARCRef,
  I18N,
  prefsRef,
  cfgRef,
  normalizeConfig,
  applyVisual,
  frontRef,
  aRef,
  setReady,
  play,
  setMeta,
  greetingFor,
  speak,
  setTip,
  timerRef,
  bubbleTimerRef,
}) {
  useEffect(() => {
    injectCss();
    let alive = true;

    const st = readStore(SET_KEY) || {};
    if (st.city) {
      setCity(st.city);
    }

    (async () => {
      try {
        const mods = await Promise.all([
          import(ASSET_BASE + "/shared/state-machine.js"),
          import(ASSET_BASE + "/shared/growth.js"),
          import(ASSET_BASE + "/shared/arc.js"),
          import(ASSET_BASE + "/shared/panel-controls.js"),
          import(ASSET_BASE + "/shared/i18n.js"),
        ]);
        SMRef.current = mods[0];
        GROWRef.current = mods[1];
        ARCRef.current = mods[2];

        I18N.configure(prefsRef.current.locale);
      } catch (error) {
        SMRef.current = null;
        GROWRef.current = null;
        ARCRef.current = null;
      }

      try {
        const res = await fetch(ASSET_BASE + "/config.json", {
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error("HTTP " + res.status);
        }
        const raw = await res.json();
        if (!alive) {
          return;
        }
        cfgRef.current = normalizeConfig(raw);
        applyVisual();
        frontRef.current = aRef.current;
        setReady(true);
        play(cfgRef.current.startAnim, { loop: false });

        try {
          const m = await fetch(ASSET_BASE + "/meta", {
            cache: "no-store",
          }).then((r) => r.json());
          if (alive) {
            setMeta(m);
          }
        } catch (error) {}

        const g = greetingFor(Date.now());
        if (g) {
          setTimeout(() => alive && speak(g), 900);
        }
      } catch (error) {
        if (alive) {
          setTip("无法读取配置，请刷新重试。");
        }
      }
    })();

    return () => {
      alive = false;
      clearTimeout(timerRef.current);
      clearTimeout(bubbleTimerRef.current);
    };
  }, [applyVisual, play, speak]);
  return {};
}
