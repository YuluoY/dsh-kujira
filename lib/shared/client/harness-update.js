import { t, date } from "../i18n.js";

const MESSAGES = {
  "check-failed": "暂时无法检查更新，请稍后重试。",
  "versions-failed": "暂时无法读取版本列表，请重试。",
  "detect-failed": "暂时无法识别 DSH 安装。",
  "save-failed": "更新设置保存失败，请重试。",
  "install-failed": "安装失败，请检查网络和安装目录权限后重试。",
  "verify-failed": "未能确认新版本已安装，请重新检查安装状态。",
  "dependency-check-failed": "无法检查 DSH 组件，请检查安装状态后重试。",
  "dependency-release-unavailable": "目标版本缺少配套组件，未执行安装。请稍后重试或选择其他版本。",
  "dependency-verify-failed": "DSH 组件版本仍不一致，请修复当前版本后重启。",
  "update-timeout": "更新超时，请检查网络后重试。",
  "command-unavailable": "安装工具不可用，请检查 npm 或 pnpm。",
  "registry-invalid": "版本信息校验失败，未执行安装。",
  "update-locked": "另一个 DSH 服务正在更新，请稍后检查。",
  "installation-changed": "安装位置已变化，请重启 DSH 后重新检查。",
  "tasks-running": "有任务正在运行，请结束任务后更新。",
  "update-not-ready": "更新条件已变化，请重新检查版本和运行中的任务。",
  "update-busy": "正在检查或安装更新，请稍候。",
  "local-only": "请在运行 DSH 的电脑上打开本地页面后更新。",
  "service-unavailable": "更新服务尚未加载，请在任务结束后重启 DSH。",
};

/**
 * @description Observe update status while visible and keep mutation results newer than polling.
 * @param {object} React Host React hooks.
 * @returns {object} Current update status and explicit actions.
 */
export function useHarnessUpdate({ useState, useEffect, useRef }) {
  const [status, setStatus] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [selectedVersion, selectVersion] = useState("");
  const operation = useRef({ generation: 0, posting: false, alive: false });
  useEffect(() => {
    let timer, controller, polling = false;
    const state = operation.current;
    state.alive = true;
    const poll = async () => {
      clearTimeout(timer);
      if (document.hidden || polling) return;
      if (state.posting) {
        if (state.alive) timer = setTimeout(poll, 2000);
        return;
      }
      const generation = state.generation;
      polling = true;
      controller = new AbortController();
      let interval = 60000;
      try {
        const response = await fetch("/dsh-kujira/harness-update", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
        if (!response.ok) throw Error();
        const value = await response.json();
        if (!value.ok) throw Error();
        if (["installing", "checking"].includes(value.phase)) interval = 2000;
        if (state.alive && generation === state.generation) { setStatus(value); setError((old) => old === "service-unavailable" ? "" : old); }
      } catch {
        if (state.alive && generation === state.generation) setError("service-unavailable");
      } finally {
        polling = false;
        if (state.alive) timer = setTimeout(poll, generation === state.generation ? interval : 2000);
      }
    };
    document.addEventListener("visibilitychange", poll);
    state.refresh = poll;
    poll();
    return () => { state.alive = false; clearTimeout(timer); controller?.abort(); document.removeEventListener("visibilitychange", poll); };
  }, []);
  const act = async (action, values = {}) => {
    const state = operation.current;
    if (state.posting) return;
    state.posting = true; state.generation++;
    setBusy(true); setError("");
    try {
      const response = await fetch("/dsh-kujira/harness-update", {
        method: "POST", headers: { "Content-Type": "application/json", "X-Kujira-Update": "1" },
        body: JSON.stringify({ action, ...values }), signal: AbortSignal.timeout(30000),
      });
      const value = await response.json();
      if (!response.ok || !value.ok) throw Error(value.error || "service-unavailable");
      if (state.alive) setStatus(value);
    } catch (failure) {
      if (state.alive) setError(MESSAGES[failure.message] ? failure.message : "service-unavailable");
    } finally {
      state.posting = false;
      if (state.alive) { setBusy(false); state.refresh?.(); }
    }
  };
  const update = { status, busy, error, act, selectedVersion, selectVersion };
  return { ...update, render: (options) => renderHarnessUpdate({ ...options, update }) };
}

/**
 * @description Render version details, check preferences and the explicit installation action.
 * @param {object} options Shared controls and observed update state.
 * @returns {object} Settings section contents.
 */
export function renderHarnessUpdate({ h, controls, PanelSelect, fieldLabel, update }) {
  const { status, busy, error, act, selectedVersion, selectVersion } = update || {};
  if (!status) return error
    ? h("p", { className: "hint", role: "status" }, t(MESSAGES[error]))
    : h(controls.Skeleton, { kind: "settings", label: "正在读取更新状态" });
  const working = busy || ["checking", "installing"].includes(status.phase);
  const locked = working || status.disabled || status.preview;
  const versions = status.versions || [];
  const target = versions.includes(selectedVersion) ? selectedVersion : (status.previousVersions || []).find((version) => versions.includes(version)) || versions.find((version) => version !== status.installed) || "";
  const headline = status.phase === "installing" ? t("正在安装更新…")
    : status.needsRepair ? t("DSH 组件版本不一致，需要修复")
    : status.restartRequired ? t("已安装 {version}，重启 DSH 后生效", { version: status.installed })
    : status.available ? t("发现新版本 {version}", { version: status.latest })
    : status.phase === "checking" ? t("正在检查更新…")
    : status.checkedAt ? t("当前已是所选通道的最新版本") : t("尚未检查更新");
  const note = status.preview ? "预览模式，只检查版本，不更新系统。"
    : status.disabled ? "更新检查已由宿主配置关闭。"
    : !status.supported ? "此安装方式暂不支持一键更新，请按原安装方式更新 DSH。"
    : status.activeTasks === null ? "暂时无法确认任务状态，安装按钮暂不可用。"
    : status.activeTasks > 0 ? "有任务正在运行，请结束任务后更新。"
    : "点击安装后更新当前系统的 DSH；完成后重启生效，保留插件与会话数据。";
  return h("div", { className: "kj-harness-update", "aria-busy": working },
    h("p", { className: "kj-update-summary", role: "status" }, headline),
    h("p", { className: "hint" }, t("当前运行 {version}", { version: status.current || "—" })),
    h("div", { className: "kj-setting" }, fieldLabel("自动检查更新", "每天检查官方 npm 版本，有更新时提示；不会自动安装。"),
      h("input", { type: "checkbox", role: "switch", "aria-label": "自动检查更新", checked: status.settings.automatic,
        disabled: locked, onChange: (event) => act("configure", { settings: { automatic: event.target.checked } }) })),
    h("div", { className: "kj-setting" }, fieldLabel("更新通道", "跟随当前版本保留 alpha 通道；仅安装更高版本，不自动降级。"),
      h(PanelSelect, { label: "更新通道", value: status.settings.channel, disabled: locked,
        options: [["auto", "跟随当前版本"], ["latest", "官方推荐（latest）"], ["alpha", "预览版本（alpha）"]],
        onChange: (channel) => act("configure", { settings: { channel } }) })),
    h("p", { className: "hint" }, note),
    h("div", { className: "kj-update-actions" },
      h("button", { type: "button", className: "kj-action", disabled: working || status.disabled,
        onClick: () => act("check") }, status.phase === "checking" ? "正在检查…" : "检查更新"),
      status.available && !status.restartRequired ? h("button", { type: "button", className: "kj-action", disabled: working || !status.canInstall,
        onClick: () => act("install", { version: status.latest }) }, t("安装 {version}", { version: status.latest })) : null,
      status.needsRepair ? h("button", { type: "button", className: "kj-action", disabled: working || !status.canRepair,
        onClick: () => act("repair") }, t("修复当前版本")) : null),
    h("details", { className: "kj-disclosure", onToggle: (event) => {
      if (event.currentTarget.open && !versions.length && !busy && !status.disabled) act("versions");
    } }, h("summary", null, "历史版本与回退"),
      versions.length ? h("div", null,
        h("div", { className: "kj-setting" }, fieldLabel("目标版本"), h(PanelSelect, {
          label: "目标版本", value: target, disabled: working,
          options: versions.filter((version) => version !== status.installed).map((version) => [version,
            status.previousVersions?.[0] === version ? t("{version} · 上一个版本", { version }) : version]),
          onChange: selectVersion,
        })),
        h("p", { className: "hint" }, "回退只更换 DSH 程序，保留会话与配置；旧版可能不兼容新版配置。"),
        h("div", { className: "kj-update-actions" }, h("button", { type: "button", className: "kj-action",
          disabled: working || !status.canChangeVersion || !target,
          onClick: () => act("switch", { version: target }) }, t("切换到 {version}", { version: target || "—" }))))
        : h("div", { className: "kj-update-actions" }, h("button", { type: "button", className: "kj-action", disabled: working || status.disabled,
          onClick: () => act("versions") }, busy ? "正在读取版本…" : "读取版本列表"))),
    error || status.error ? h("p", { className: "err", role: "status" }, t(MESSAGES[error || status.error] || MESSAGES["install-failed"])) : null,
    status.checkedAt ? h("p", { className: "hint" }, t("上次检查：{time}", { time: date(status.checkedAt, { dateStyle: "short", timeStyle: "short" }) })) : null,
    h("a", { className: "kj-inline-link", href: "https://www.npmjs.com/package/@deepseek-ai/dsh?activeTab=versions", target: "_blank", rel: "noopener noreferrer" }, "查看官方版本记录"));
}
