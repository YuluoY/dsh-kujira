/**
 * @description Consume interaction inventory and apply care outcomes with request receipts.
 * @param {object} dependencies Explicit runtime and state dependencies.
 * @returns {object} Public values for the composing component.
 */
export function useCareActions({
  useCallback,
  inventoryBusyRef,
  GROWRef,
  cfgRef,
  closeOrb,
  speak,
  pendingResource,
  readStore,
  GROW_KEY,
  busyRef,
  setInventoryBusy,
  ASSET_BASE,
  acceptInventory,
  pick,
  play,
  loadGrowth,
  prefsRef,
  t,
  useEffect,
  ready,
}) {
  const performCare = useCallback(
    async (kind, { keepOpen = false } = {}) => {
      if (inventoryBusyRef.current) return;
      const G = GROWRef.current,
        cfg = cfgRef.current;
      if (!keepOpen) closeOrb();
      if (!G || !cfg.growth.enabled) {
        speak("互动暂不可用");
        return;
      }
      if (pendingResource.current && pendingResource.current.kind !== kind) {
        speak("请先重试上次互动");
        return;
      }
      const n = G.tick(
        G.migrate(readStore(GROW_KEY), Date.now()),
        Date.now(),
        { workingMs: 0 },
        cfg.growth.rates,
      ).state;
      if (!pendingResource.current && kind === "fish" && n.satiety >= 95) {
        speak("已经吃饱啦，留一条等会儿吃");
        return;
      }
      if (
        !pendingResource.current &&
        busyRef.current &&
        kind !== "fish" &&
        kind !== "pat"
      ) {
        speak("我正在忙，完成后再陪你");
        return;
      }
      inventoryBusyRef.current = true;
      setInventoryBusy(true);
      const request = pendingResource.current || {
        kind,
        requestId: crypto.randomUUID(),
      };
      pendingResource.current = request;
      try {
        sessionStorage.setItem(
          "dsh-kujira:care-pending",
          JSON.stringify(request),
        );
      } catch {}
      try {
        const response = await fetch(ASSET_BASE + "/inventory", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Kujira-Inventory": "1",
          },
          body: JSON.stringify({ action: "consume", ...request }),
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw Error();
        const result = await response.json();
        if (!result.ok) {
          pendingResource.current = null;
          try {
            sessionStorage.removeItem("dsh-kujira:care-pending");
          } catch {}
          if (result.inventory) acceptInventory(result.inventory);
          speak(
            result.reason === "empty"
              ? "这项补给用完了，积累使用费用可获得更多"
              : result.reason === "cooldown"
                ? "慢慢来，等我一下"
                : result.reason === "busy"
                  ? "我正在忙，完成后再陪你"
                  : "互动暂不可用",
          );
          return;
        }
        acceptInventory({ ...result, cooldownMs: result.cooldownMs ?? 8000 });
        const latest = G.tick(
          G.migrate(readStore(GROW_KEY), Date.now()),
          Date.now(),
          { workingMs: 0 },
          cfg.growth.rates,
        ).state;
        if (!(latest.resourceReceipts || []).includes(result.receiptId)) {
          const grown = G.applyGain(
            latest,
            result.gain,
            Date.now(),
            cfg.growth,
          ).state;
          grown.resourceReceipts = [
            ...(latest.resourceReceipts || []),
            result.receiptId,
          ].slice(-512);
          localStorage.setItem(GROW_KEY, JSON.stringify(grown));
        }
        pendingResource.current = null;
        try {
          sessionStorage.removeItem("dsh-kujira:care-pending");
        } catch {}
        const action = {
          fish: { anim: "吃小鱼干", text: "收到小鱼干！今天也要元气满满" },
          pat: { anim: pick(cfg.pools.click), text: "我在呢，慢慢来就好" },
          play: { anim: "原地专心玩魔方", text: "陪我玩一小会儿吧" },
          stretch: { anim: "超大伸懒腰", text: "伸个懒腰，放松一下" },
        }[kind];
        play(action.anim, { loop: false });
        loadGrowth();
        speak(prefsRef.current.playful ? action.text : t("完成"));
      } catch {
        speak("库存连接失败，请重试");
      } finally {
        inventoryBusyRef.current = false;
        setInventoryBusy(false);
      }
    },
    [acceptInventory, closeOrb, loadGrowth, play, speak],
  );
  useEffect(() => {
    if (ready && pendingResource.current)
      performCare(pendingResource.current.kind);
  }, [ready, performCare]);
  const feed = useCallback(
    (options) => performCare("fish", options),
    [performCare],
  );
  const interact = useCallback(
    (kind, options) => performCare(kind, options),
    [performCare],
  );
  return { feed, interact };
}
