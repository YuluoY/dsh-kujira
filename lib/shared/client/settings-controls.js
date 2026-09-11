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
      let live = true;
      const abort = new AbortController();
      fetch(ASSET_BASE + "/realtime", { signal: abort.signal })
        .then((r) => r.json())
        .then((v) => {
          if (live) setData(v);
        })
        .catch(() => {
          if (live) setError("暂时无法读取同步设置");
        });
      return () => {
        live = false;
        abort.abort();
      };
    }, []);
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
  function LocalClock() {
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
  }
  return { RealtimeSettings, SchedulerSettings, LocalClock };
}
