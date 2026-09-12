import { createLocalClock } from "./utilities.js";
import { publishInventory, subscribeInventory } from "./reward-queue.js";
/**
 * @description Create live-sync, global scheduler and local-clock controls.
 * @param {object} dependencies Explicit runtime and state dependencies.
 * @returns {object} Public values for the composing component.
 */
export function createSettingsControls({
  useState,
  useEffect,
  ASSET_BASE,
  h,
  fieldLabel,
  React,
  PanelSelect,
  t,
  I18N,
  controls,
  useRef,
}) {
  function RealtimeSettings() {
    const [data, setData] = useState(null),
      [busy, setBusy] = useState(false),
      [error, setError] = useState("");
    useEffect(() => {
      if (busy) return;
      let live = true,
        timer;
      const abort = new AbortController();
      const read = async () => {
        try {
          if (!document.hidden) {
            const response = await fetch(ASSET_BASE + "/realtime", {
              signal: abort.signal,
            });
            if (!response.ok) throw Error();
            const value = await response.json();
            if (live) setData(value);
          }
        } catch {
          if (live) setError("暂时无法读取同步设置");
        } finally {
          if (live) timer = setTimeout(read, 10000);
        }
      };
      read();
      return () => {
        live = false;
        clearTimeout(timer);
        abort.abort();
      };
    }, [busy]);
    const update = async (value) => {
      setBusy(true);
      setError("");
      try {
        const response = await fetch(ASSET_BASE + "/realtime", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Kujira-Settings": "1",
          },
          body: JSON.stringify(value),
        });
        if (!response.ok) throw new Error();
        const result = await response.json();
        setData(result);
        if (!result.ok) setError(result.message || "保存失败");
      } catch {
        setError("同步失败，请稍后重试");
      } finally {
        setBusy(false);
      }
    };
    const toggle = (label, key, help) =>
      h(
        "div",
        { className: "kj-setting" },
        fieldLabel(label, help),
        h("input", {
          type: "checkbox",
          role: "switch",
          "aria-label": label,
          disabled: busy,
          checked: !!data.settings[key],
          onChange: (e) => update({ [key]: e.target.checked }),
        }),
      );
    return h(
      "div",
      null,
      data?.settings
        ? h(
            React.Fragment,
            null,
            toggle(
              "自动同步",
              "automatic",
              "定期检查官网公开价目页面，不调用模型。",
            ),
            h(
              "div",
              { className: "kj-setting" },
              h("span", null, "检查间隔"),
              h(PanelSelect, {
                label: "检查间隔",
                value: data.settings.intervalHours,
                disabled: busy,
                onChange: (value) => update({ intervalHours: value }),
                options: [6, 12, 24, 72].map((v) => [
                  v,
                  t("{value} 小时", { value: I18N.number(v) }),
                ]),
              }),
            ),
            h(
              "p",
              { className: "hint" },
              "以下选项默认关闭。启用后，仅在官网解析失败时调用模型，每 24 小时最多一次，会消耗 API 额度；摘要不直接用于计费。",
            ),
            toggle(
              "模型辅助（付费）",
              "modelAssist",
              "仅在官网解析失败时调用模型，每 24 小时最多一次，会消耗 API 额度。",
            ),
            data.settings.modelAssist
              ? h(
                  "label",
                  { className: "kj-setting" },
                  h("span", null, "辅助模型 ID"),
                  h("input", {
                    type: "text",
                    defaultValue: data.settings.model || "deepseek-flash",
                    disabled: busy,
                    maxLength: 79,
                    onBlur: (e) => {
                      const model = e.target.value.trim();
                      if (/^deepseek-[a-z0-9-]{1,70}$/.test(model))
                        update({ model });
                      else setError("请输入有效的 DeepSeek 模型 ID");
                    },
                  }),
                )
              : null,
            h(
              "p",
              { className: "hint" },
              data.summary || "尚未同步，使用内置已核对价格。",
            ),
            h(
              "p",
              { className: "hint" },
              data.checkedAt
                ? t("上次核对：{time}", {
                    time: I18N.date(data.checkedAt, {
                      dateStyle: "short",
                      timeStyle: "short",
                    }),
                  })
                : "关闭自动检查后，仅手动同步。",
            ),
            h(
              "button",
              {
                type: "button",
                className: "kj-action",
                disabled: busy,
                onClick: () => update({ action: "refresh" }),
              },
              busy ? "正在同步…" : "立即同步官网",
            ),
            h(
              "p",
              { className: "hint" },
              "此设置保存在 DSH 服务，重启后继续生效；所有浏览器共用。同步最短间隔 1 分钟。天气仍可单独设置城市。",
            ),
          )
        : h(controls.Skeleton, { kind: "settings", label: "正在读取同步设置" }),
      error ? h("p", { className: "err", role: "status" }, error) : null,
    );
  }
  function SchedulerSettings({ labelNode }) {
    const [data, setData] = useState(null),
      [busy, setBusy] = useState(false),
      [error, setError] = useState("");
    const editing = useRef(false);
    useEffect(() => {
      let active = true,
        timer;
      const load = async () => {
        try {
          const response = await fetch(ASSET_BASE + "/scheduler", {
            cache: "no-store",
            signal: AbortSignal.timeout(10000),
          });
          if (!response.ok) throw Error();
          const value = await response.json();
          if (active && !editing.current) {
            setData(value);
            setError("");
          }
        } catch {
          if (active) setError("调度服务暂不可用");
        } finally {
          if (active) timer = setTimeout(load, 5000);
        }
      };
      load();
      return () => {
        active = false;
        clearTimeout(timer);
      };
    }, []);
    const change = async (enabled) => {
      editing.current = true;
      setBusy(true);
      setError("");
      try {
        const response = await fetch(ASSET_BASE + "/scheduler", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Kujira-Settings": "1",
          },
          body: JSON.stringify({ enabled }),
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw Error();
        const value = await response.json();
        if (!value.ok) throw Error();
        setData(value);
      } catch {
        setError("调度设置保存失败，未改变当前开关");
      } finally {
        editing.current = false;
        setBusy(false);
      }
    };
    return h(
      "div",
      null,
      data
        ? h(
            React.Fragment,
            null,
            h(
              "div",
              { className: "kj-setting" },
              labelNode,
              h("input", {
                type: "checkbox",
                role: "switch",
                "aria-label": "紧急避险",
                checked: !!data.enabled,
                disabled: busy || !data.available,
                onChange: (e) => change(e.target.checked),
              }),
            ),
            h(
              "p",
              { className: "hint" },
              !data.available
                ? "当前宿主不支持步骤暂停"
                : data.enabled
                  ? t("已暂停 {count} · 等待安全暂停 {pending}", {
                      count: I18N.number(data.paused),
                      pending: I18N.number(data.pausing || 0),
                    })
                  : "调度已关闭",
            ),
            data.enabled
              ? h(
                  "p",
                  { className: "hint" },
                  data.rate === "peak"
                    ? "峰价：当前步骤结束后暂停"
                    : "谷价：会话正常执行",
                  data.nextAt
                    ? " · " +
                        t("下次切换 {time}", {
                          time: I18N.date(data.nextAt, {
                            weekday: "short",
                            hour: "numeric",
                            minute: "2-digit",
                          }),
                        })
                    : "",
                )
              : null,
            data.preview
              ? h(
                  "p",
                  { className: "hint" },
                  "本地预览：正式安装后控制全部会话及子代理",
                )
              : null,
            data.error ? h("p", { className: "err" }, data.error) : null,
          )
        : h(controls.Skeleton, { kind: "settings", label: "正在读取调度设置" }),
      error ? h("p", { className: "err", role: "status" }, error) : null,
    );
  }
  function RewardSettings() {
    const [data, setData] = useState(null),
      [draft, setDraft] = useState(null),
      [busy, setBusy] = useState(false),
      [error, setError] = useState("");
    const saving = useRef(false),
      dirty = useRef(false);
    dirty.current =
      !!draft && JSON.stringify(draft) !== JSON.stringify(data?.rules);
    useEffect(
      () =>
        subscribeInventory((value) => {
          if (value?.rules && !dirty.current && !saving.current) {
            setData(value);
            setDraft(value.rules);
          }
        }),
      [],
    );
    useEffect(() => {
      let active = true;
      const controller = new AbortController();
      fetch(ASSET_BASE + "/inventory", { signal: controller.signal })
        .then((r) => {
          if (!r.ok) throw Error();
          return r.json();
        })
        .then((v) => {
          if (active) {
            setData(v);
            setDraft(v.rules || null);
          }
        })
        .catch(() => {
          if (active) setError("读取掉落规则失败，请重新展开设置");
        });
      return () => {
        active = false;
        controller.abort();
      };
    }, []);
    const edit = (key, value) => {setError("");setDraft((old) => ({ ...old, [key]: value }));};
    const save = async () => {
      if (saving.current) return;
      if (draft.min > draft.max) {
        setError("最少件数不能大于最多件数");
        return;
      }
      saving.current = true;
      setBusy(true);
      setError("");
      try {
        const response = await fetch(ASSET_BASE + "/inventory", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Kujira-Inventory": "1",
          },
          body: JSON.stringify({
            action: "rules",
            rules: draft,
            revision: data.rulesRevision,
          }),
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw Error();
        const value = await response.json();
        if (value.ok) {
          publishInventory(value);
          setData(value);
          setDraft(value.rules);
        } else {
          if (value.inventory) {
            setData(value.inventory);
            setDraft(value.inventory.rules);
          }
          setError(
            value.reason === "rules-conflict"
              ? "规则已在其他窗口修改，已载入最新设置"
              : "规则无效，请检查范围",
          );
        }
      } catch {
        setError("保存失败，请重试");
      } finally {
        saving.current = false;
        setBusy(false);
      }
    };
    if (!data)
      return h(
        "p",
        { className: "hint", role: "status" },
        error || "正在读取掉落规则",
      );
    if (!draft)
      return h(
        "p",
        { className: "hint", role: "status" },
        "掉落规则将在重启 DSH 后可用",
      );
    const definitions = [
      [
        "判定额度",
        "amount",
        0.01,
        100,
        0.01,
        "按人民币计，达到额度进行一次判定，不保证获得物品。",
      ],
      [
        "掉落概率",
        "chance",
        0,
        100,
        1,
        "每次判定独立计算；0% 不掉落，100% 必定掉落。",
      ],
      ["最少件数", "min", 1, 20, 1, "成功掉落时的最少数量。"],
      ["最多件数", "max", 1, 20, 1, "成功后在数量范围内随机，数量越多越少见。"],
      [
        "小鱼干占比",
        "fishWeight",
        0,
        100,
        1,
        "每件物品独立抽取，其余概率由摸头、陪玩、舒展均分。",
      ],
    ];
    return h(
      "div",
      { className: "kj-reward-settings" },
      ...definitions.map(([label, key, min, max, step, help]) =>
        h(
          "div",
          { className: "kj-setting", key },
          fieldLabel(label, help),
          h(
            "div",
            { className: "kj-duration" },
            h(controls.NumberField, {
              label,
              value: draft[key],
              min,
              max,
              step,
              integer: key !== "amount",
              disabled: busy,
              onChange: (value) =>
                edit(
                  key,
                  key === "amount" ? Math.round(value * 100) / 100 : value,
                ),
            }),
            h(
              "span",
              null,
              key === "amount"
                ? "¥"
                : key === "chance" || key === "fishWeight"
                  ? "%"
                  : "",
            ),
          ),
        ),
      ),
      h(
        "div",
        { className: "kj-setting" },
        fieldLabel("峰价加成", "开启后，峰价消费按双倍进度积累判定次数。"),
        h("input", {
          type: "checkbox",
          role: "switch",
          "aria-label": "峰价加成",
          checked: draft.peakBonus,
          disabled: busy,
          onChange: (e) => edit("peakBonus", e.target.checked),
        }),
      ),
      h(
        "p",
        { className: "hint" },
        "新规则只影响后续消费，保留现有进度和库存，不重抽历史消费。",
      ),
      error ? h("p", { className: "err", role: "status" }, error) : null,
      h(
        "button",
        {
          type: "button",
          className: "kj-action",
          disabled:
            busy || JSON.stringify(draft) === JSON.stringify(data.rules),
          onClick: save,
        },
        busy ? "正在保存…" : "应用掉落规则",
      ),
    );
  }
  const LocalClock = createLocalClock({ h, useState, useEffect, I18N });
  return { RealtimeSettings, SchedulerSettings, RewardSettings, LocalClock };
}
