import { scenePool } from "./animation-catalog.js";
import { writeLocalState } from "./utilities.js";
const CARE_LINES = {
  fish: [
    "收到小鱼干！今天也要元气满满",
    "咔嚓咔嚓，好香呀",
    "这一口幸福，收下啦",
    "小鱼干补充完毕，继续陪你",
  ],
  pat: [
    "我在呢，慢慢来就好",
    "再摸一下也可以哦",
    "嗯，安心多了",
    "收到你的温柔啦",
  ],
  play: [
    "陪我玩一小会儿吧",
    "这次换我出招啦",
    "嘿嘿，再来一局",
    "和你一起玩，时间过得好快",
  ],
  stretch: [
    "伸个懒腰，放松一下",
    "肩膀放松，呼——",
    "一起活动一下吧",
    "休息一小会儿，精神回来啦",
  ],
};
/**
 * @description Select a local care response without an immediate repeat.
 */
export function careLine(kind, previous, random = Math.random) {
  const lines = (CARE_LINES[kind] || CARE_LINES.pat).filter(
    (line) => line !== previous,
  );
  return lines[Math.min(lines.length - 1, Math.floor(random() * lines.length))];
}
/**
 * @description Consume interaction inventory and apply care outcomes with request receipts.
 * @param {object} dependencies Explicit runtime and state dependencies.
 * @returns {object} Public values for the composing component.
 */
export function useCareActions({
  useCallback,
  useRef,
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
  const work = useRef({
    lines: {},
    queue: [],
    running: false,
    alive: true,
    recovered: false,
  });
  const performOne = useCallback(
    async (kind) => {
      if (inventoryBusyRef.current) return;
      const G = GROWRef.current,
        cfg = cfgRef.current;
      if (!G || !cfg.growth.enabled) {
        speak("互动暂不可用");
        return;
      }
      if (pendingResource.current && pendingResource.current.kind !== kind) {
        speak("请先重试上次互动");
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
                ? "重启 DSH 后即可连续使用物品"
                : result.reason === "busy"
                  ? "我正在忙，完成后再陪你"
                  : "互动暂不可用",
          );
          return;
        }
        acceptInventory(result);
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
          if (!writeLocalState(GROW_KEY, grown)) throw Error("growth-save-failed");
        }
        pendingResource.current = null;
        try {
          sessionStorage.removeItem("dsh-kujira:care-pending");
        } catch {}
        const action = {
          fish: {
            anim: "吃小鱼干",
          },
          pat: { anim: pick(cfg.pools.click) },
          play: {
            anim: pick(scenePool(cfg, "play")) || "原地专心玩魔方",
          },
          stretch: { anim: "超大伸懒腰" },
        }[kind];
        play(action.anim, { loop: false, repeat: true });
        loadGrowth();
        const line = careLine(kind, work.current.lines[kind]);
        work.current.lines[kind] = line;
        speak(prefsRef.current.playful ? line : t("完成"));
        return true;
      } catch {
        speak("库存连接失败，请重试");
      } finally {
        inventoryBusyRef.current = false;
        setInventoryBusy(false);
      }
    },
    [acceptInventory, loadGrowth, play, speak],
  );
  const performCare = useCallback(
    (kind, options = {}) => {
      const state = work.current;
      if (!state.alive) return Promise.resolve(false);
      if (state.queue.length >= 20) {
        speak("操作正在处理中，请稍后再点");
        return Promise.resolve(false);
      }
      if (!options.keepOpen) closeOrb();
      return new Promise((resolve) => {
        state.queue.push({ kind, resolve });
        if (state.running) return;
        state.running = true;
        (async () => {
          try {
            while (state.queue.length && state.alive) {
              const item = state.queue.shift();
              let ok = false;
              try {
                ok = await performOne(item.kind);
              } catch {
                speak("互动暂不可用");
              }
              item.resolve(!!ok);
              if (!ok) break;
            }
          } finally {
            state.queue.splice(0).forEach((item) => item.resolve(false));
            state.running = false;
          }
        })();
      });
    },
    [performOne, speak, closeOrb],
  );
  useEffect(() => {
    work.current.alive = true;
    return () => {
      work.current.alive = false;
      work.current.queue.splice(0).forEach((item) => item.resolve(false));
    };
  }, []);
  useEffect(() => {
    if (!ready || work.current.recovered) return;
    work.current.recovered = true;
    if (pendingResource.current)
      performCare(pendingResource.current.kind, { keepOpen: true });
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
