import { createPoller } from "./polling.js";
import { publishInventory, getInventorySnapshot } from "./reward-queue.js";
/**
 * @description Refresh balance, weather and growth data and manage inventory synchronization.
 * @param {object} dependencies Explicit runtime and state dependencies.
 * @returns {object} Public values for the composing component.
 */
export function usePetData({
  useCallback,
  useRef,
  setInventory,
  ASSET_BASE,
  useEffect,
  inventoryBusyRef,
  setInventoryBusy,
  speak,
  GROWRef,
  cfgRef,
  readStore,
  GROW_KEY,
  workingSinceRef,
  busyRef,
  writeStore,
  ready,
  lastSeenRef,
  prefsRef,
  lastCareRef,
  greet,
  localHour,
  balanceRequest,
  setBalanceView,
  controls,
  city,
  weatherRequest,
  setWeatherView,
  locale,
  I18N,
  panel,
  setGrowthView,
  SET_KEY,
  setCity,
}) {
  const acceptInventory = useCallback((value) => {
    if (value?.ok) setInventory(publishInventory(value));
  }, []);
  const readInventory = useCallback(
    async (signal) => {
      try {
        const response = await fetch(ASSET_BASE + "/inventory", {
          cache: "no-store",
          signal,
        });
        if (!response.ok) throw Error();
        const value = await response.json();
        if (!signal.aborted) acceptInventory(value);
      } catch (error) {
        if (signal.aborted) throw error;
        setInventory(
          publishInventory({
            ...(getInventorySnapshot() || { ok: false }),
            stale: true,
          }),
        );
        throw error;
      }
    },
    [acceptInventory],
  );
  const pollerRef = useRef(null);
  useEffect(() => {
    const poller = createPoller(readInventory);
    pollerRef.current = poller;
    return () => {
      pollerRef.current = null;
      poller.dispose();
    };
  }, [readInventory]);
  const refreshInventory = useCallback(() => pollerRef.current?.refresh(), []);
  const setFreeInteractions = async (free) => {
    if (inventoryBusyRef.current) return;
    inventoryBusyRef.current = true;
    setInventoryBusy(true);
    try {
      const response = await fetch(ASSET_BASE + "/inventory", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Kujira-Inventory": "1",
        },
        body: JSON.stringify({ action: "mode", free }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw Error();
      const result = await response.json();
      if (!result.ok) throw Error();
      acceptInventory(result);
    } catch {
      speak("库存连接失败，请重试");
    } finally {
      inventoryBusyRef.current = false;
      setInventoryBusy(false);
    }
  };
  const tickGrowth = useCallback(() => {
    const G = GROWRef.current;
    const cfg = cfgRef.current;
    if (!G || !cfg.growth.enabled) {
      return null;
    }

    const now = Date.now();
    let n = G.migrate(readStore(GROW_KEY), now);

    const workingMs = workingSinceRef.current
      ? Math.max(0, now - workingSinceRef.current)
      : 0;
    workingSinceRef.current = busyRef.current ? now : 0;

    const r = G.tick(n, now, { workingMs }, cfg.growth.rates);
    n = r.state;
    writeStore(GROW_KEY, n);
    return n;
  }, []);
  useEffect(() => {
    if (!ready) {
      return undefined;
    }
    tickGrowth();
    const t = setInterval(tickGrowth, 60000);
    return () => clearInterval(t);
  }, [ready, tickGrowth]);
  useEffect(() => {
    if (!ready) {
      return undefined;
    }

    const onVisible = () => {
      const cfg = cfgRef.current;

      if (document.hidden) {
        lastSeenRef.current = Date.now();
        return;
      }

      const away = Date.now() - lastSeenRef.current;
      lastSeenRef.current = Date.now();

      if (
        !prefsRef.current.care ||
        !cfg.care.greetBack ||
        away < cfg.care.backAfterMs
      ) {
        return;
      }
      if (
        busyRef.current ||
        Date.now() - lastCareRef.current < cfg.care.minGapMs
      ) {
        return;
      }
      lastCareRef.current = Date.now();

      const hr = localHour(Date.now());
      (greet || speak)(hr >= 23 || hr < 6 ? "还在呀…早点休息" : "回来啦");
    };

    document.addEventListener("visibilitychange", onVisible);

    const care = setInterval(() => {
      const cfg = cfgRef.current;
      if (!prefsRef.current.care || !cfg.care.longSit || busyRef.current) {
        return;
      }
      if (Date.now() - lastCareRef.current < cfg.care.minGapMs) {
        return;
      }
      const stats = (readStore(GROW_KEY) || {}).stats || {};
      if ((Number(stats.workingMs) || 0) >= cfg.care.longSitMs) {
        lastCareRef.current = Date.now();
        speak("陪你挺久了，站起来走两步？");
      }
    }, 60000);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(care);
    };
  }, [ready, speak]);
  const loadBalance = useCallback(async (force) => {
    balanceRequest.current.controller?.abort();
    const controller = new AbortController();
    const id = balanceRequest.current.id + 1;
    balanceRequest.current = { id, controller };
    setBalanceView((old) => controls.beginRefresh(old));
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(
        ASSET_BASE + "/balance" + (force ? "?force=1" : ""),
        { cache: "no-store", signal: controller.signal },
      );
      if (!response.ok) throw new Error("余额服务暂不可用");
      const out = await response.json();
      if (id === balanceRequest.current.id)
        setBalanceView((old) => controls.finishRefresh(old, out));
      return out;
    } catch {
      const out = {
        ok: false,
        message: "更新失败，保留上次数据，请稍后重试。",
      };
      if (id === balanceRequest.current.id)
        setBalanceView((old) => controls.finishRefresh(old, out));
      return out;
    } finally {
      clearTimeout(timeout);
    }
  }, []);
  const loadWeather = useCallback(
    async (force, cityOverride) => {
      const c = String(cityOverride !== undefined ? cityOverride : city).trim();
      const id = ++weatherRequest.current;
      setWeatherView((old) =>
        old?.ok && old.query === c
          ? { ...old, refreshing: true }
          : { loading: true },
      );
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 22000);
      try {
        const response = await fetch(
          ASSET_BASE +
            "/weather?city=" +
            encodeURIComponent(c) +
            "&auto=" +
            (c ? "0" : "1") +
            "&locale=" +
            encodeURIComponent(locale) +
            "&region=" +
            I18N.country(locale).region +
            (force ? "&force=1" : ""),
          { cache: "no-store", signal: controller.signal },
        );
        if (!response.ok) throw new Error("weather");
        const out = { ...(await response.json()), query: c };
        if (id === weatherRequest.current) setWeatherView(out);
        return out;
      } catch {
        if (id === weatherRequest.current)
          setWeatherView((old) =>
            old?.ok
              ? { ...old, loading: false, refreshing: false, stale: true }
              : {
                  ok: false,
                  message: "暂时连接不上天气服务，请稍后刷新或手动设置城市。",
                },
          );
      } finally {
        clearTimeout(timeout);
      }
    },
    [city, locale],
  );
  useEffect(() => {
    if (panel === "weather") loadWeather(false);
  }, [locale]);
  const loadGrowth = useCallback(() => {
    const G = GROWRef.current;
    const cfg = cfgRef.current;
    if (!G || !cfg.growth.enabled) {
      setGrowthView({ ok: false, message: "养成功能已在配置里关闭" });
      return;
    }
    const now = Date.now();
    const t = G.tick(
      G.migrate(readStore(GROW_KEY), now),
      now,
      { workingMs: 0 },
      cfg.growth.rates,
    );
    const n = t.state;
    writeStore(GROW_KEY, n);

    const lv = G.levelOf(n.bond, cfg.growth);
    setGrowthView({
      ok: true,
      mood: n.mood,
      satiety: n.satiety,
      energy: n.energy,
      bond: n.bond,
      level: lv,
      levelName: G.levelName(lv),
      toNext: G.toNextLevel(n.bond, cfg.growth),
      stats: n.stats,
      unlocked: Object.keys(n.unlocked || {}).length,
    });
  }, []);
  useEffect(() => {
    if (!panel || panel === "activity") return;
    let active = true,
      timer;
    const refresh = async () => {
      if (!active) return;
      if (!document.hidden) {
        if (panel === "growth") loadGrowth();
        else if (panel === "balance") await loadBalance(false);
        else if (panel === "weather") await loadWeather(false);
      }
      if (active)
        timer = setTimeout(refresh, panel === "growth" ? 1000 : 30000);
    };
    timer = setTimeout(refresh, panel === "growth" ? 1000 : 30000);
    const visible = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        refresh();
      }
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [panel, loadGrowth, loadBalance, loadWeather]);
  const saveCity = useCallback(
    (value) => {
      const st = readStore(SET_KEY) || {};
      st.city = value;
      writeStore(SET_KEY, st);
      setCity(value);
      loadWeather(true, value);
    },
    [loadWeather],
  );
  return {
    acceptInventory,
    refreshInventory,
    setFreeInteractions,
    loadBalance,
    loadWeather,
    loadGrowth,
    saveCity,
  };
}
