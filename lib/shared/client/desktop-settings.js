import { requestDesktopMode } from "./desktop-mode.js";
import { t } from "../i18n.js";

const DESKTOP_HELP = {
  alwaysOnTop: "保持在普通应用窗口上方，不会覆盖锁屏和系统安全界面。",
  clickThrough: "鼠标可穿过人物周围的透明区域，人物和控件仍可点击。",
  login: "登录系统后只启动桌宠，不会自动启动 DSH。",
  allWorkspaces: "在 macOS 的各个桌面显示人物；关闭后仅留在当前桌面。",
  display: "决定启动时人物出现在哪个显示器；断开显示器后会移回可见区域。",
  power: "平衡模式保留动画；省电模式使用静态陪伴，不影响 DSH 任务。",
  startDsh: "点击“打开 DSH”时决定是否启动服务；仅连接模式不会创建进程。",
  closeAction: "退出会结束桌宠进程；隐藏保留托盘入口。两种方式都不会停止 DSH。",
  linuxBackend:
    "自动优先使用 X11/XWayland；原生 Wayland 使用普通窗口。修改后需重启桌宠。",
  dshUrl:
    "填写本机 DSH Web 地址，只接受 HTTP 本机地址，不含额外路径或登录信息。",
  profile: "对应 DSH 的配置名称，通常为 web；不确定时保持默认。",
  executable: "留空时自动查找 DSH；找不到时，使用右侧按钮选择已安装的程序。",
};

/**
 * @description Render shared desktop settings using existing compact form controls.
 */
export function createDesktopSettings(
  React,
  { h, controls, PanelSelect, fieldLabel },
) {
  const draft = {},
    draftErrors = {};
  return function DesktopSettings() {
    const native = globalThis.kujiraDesktop;
    const [view, setView] = React.useState(null),
      [busy, setBusy] = React.useState(false),
      [error, setError] = React.useState(""),
      [launch, setLaunch] = React.useState(false);
    const [url, setUrl] = React.useState(""),
      [profile, setProfile] = React.useState("");
    const [saving, setSaving] = React.useState({});
    const [fieldErrors, setFieldErrors] = React.useState({ ...draftErrors });
    const saveQueue = React.useRef(Promise.resolve());
    React.useEffect(() => {
      if (!native) return;
      let active = true;
      let initialized = false;
      const accept = (value) => {
        if (active) {
          setView(value);
          if (!initialized) {
            setUrl(draft.dshUrl ?? value.settings.dshUrl);
            setProfile(draft.profile ?? value.settings.profile);
            initialized = true;
          }
        }
      };
      native
        .status()
        .then(accept)
        .catch(() => setError("桌面设置暂不可用"));
      const unsubscribe = native.onStatus(accept);
      return () => {
        active = false;
        unsubscribe();
      };
    }, [native]);
    const perform = async (action) => {
      setBusy(true);
      setError("");
      try {
        const result = await action();
        if (result?.settings) setView(result);
      } catch (e) {
        setError(
          t("操作未完成：{reason}", {
            reason: t((e.message || "请重试").split("Error: ").at(-1)),
          }),
        );
      } finally {
        setBusy(false);
      }
    };
    const button = (label, action) =>
      h(
        "button",
        {
          type: "button",
          className: "kj-action",
          disabled: busy,
          onClick: () => perform(action),
        },
        label,
      );
    if (!native)
      return h(
        "div",
        null,
        h(
          "p",
          { className: "hint" },
          "桌面模式需要安装独立桌宠应用，浏览器模式无需额外安装。",
        ),
        h(
          "div",
          { className: "kj-setting" },
          fieldLabel("桌面悬浮", "成功接管后才隐藏网页人物。"),
          h("input", {
            type: "checkbox",
            role: "switch",
            "aria-label": "桌面悬浮",
            checked: launch,
            disabled: busy,
            onChange: () =>
              perform(async () => {
                if (launch) {
                  await requestDesktopMode("browser");
                  setLaunch(false);
                  return;
                }
                await requestDesktopMode("desktop");
                setLaunch(true);
                location.href =
                  "dsh-kujira://show?source=" +
                  encodeURIComponent(location.origin);
              }),
          }),
        ),
        launch
          ? h(
              "a",
              {
                className: "kj-action",
                href:
                  "dsh-kujira://show?source=" +
                  encodeURIComponent(location.origin),
              },
              "启动桌宠应用",
            )
          : null,
        launch
          ? h(
              "p",
              { className: "hint", role: "status" },
              "请点击启动；如果应用没有打开，请先查看安装说明。网页人物会继续显示。",
            )
          : null,
        h(
          "details",
          null,
          h("summary", null, "桌面版安装说明"),
          h(
            "p",
            { className: "hint" },
            "桌面应用安装后可选择桌面模式；本轮尚未发布安装包，请使用本地验证版。",
          ),
        ),
        error ? h("p", { className: "err", role: "status" }, error) : null,
      );
    if (!view)
      return error
        ? h(
            "div",
            null,
            h("p", { className: "err", role: "status" }, error),
            button("重试", async () => {
              const next = await native.status();
              setUrl(draft.dshUrl ?? next.settings.dshUrl);
              setProfile(draft.profile ?? next.settings.profile);
              return next;
            }),
          )
        : h(controls.Skeleton, { kind: "settings", label: "正在读取桌面设置" });
    const update = (patch) => {
      const key = Object.keys(patch)[0];
      setSaving((old) => ({ ...old, [key]: true }));
      setError("");
      saveQueue.current = saveQueue.current
        .catch(() => {})
        .then(async () => {
          try {
            setView(await native.configure(patch));
          } catch (e) {
            setError(
              t("操作未完成：{reason}", {
                reason: t((e.message || "请重试").split("Error: ").at(-1)),
              }),
            );
          } finally {
            setSaving((old) => ({ ...old, [key]: false }));
          }
        });
    };
    const section = (title, ...children) =>
      h(controls.SettingsSection, { title }, ...children);
    const toggle = (label, key, available = true) =>
      h(
        "div",
        { className: "kj-setting" },
        fieldLabel(label, DESKTOP_HELP[key]),
        h("input", {
          type: "checkbox",
          role: "switch",
          "aria-label": label,
          checked: available && view.settings[key],
          disabled: !!saving[key] || !available,
          onChange: (e) => update({ [key]: e.target.checked }),
        }),
      );
    const choice = (label, key, options) =>
      h(
        "div",
        { className: "kj-setting" },
        fieldLabel(label, DESKTOP_HELP[key]),
        h(PanelSelect, {
          label,
          value: view.settings[key],
          options,
          disabled:
            !!saving[key] || (key === "display" && !view.capabilities.position),
          onChange: (value) => update({ [key]: value }),
        }),
      );
    const edit = (key, value) => {
      draft[key] = value;
      (key === "dshUrl" ? setUrl : setProfile)(value);
    };
    const commit = (key, value) => {
      const trimmed = value.trim();
      if (trimmed === view.settings[key]) {
        delete draft[key];
        delete draftErrors[key];
        setFieldErrors({ ...draftErrors });
        return;
      }
      saveQueue.current = saveQueue.current
        .catch(() => {})
        .then(async () => {
          try {
            const next = await native.configure({ [key]: trimmed });
            delete draft[key];
            delete draftErrors[key];
            setView(next);
          } catch (e) {
            const reason = (e.message || "请重试").split("Error: ").at(-1);
            draftErrors[key] = t(
              reason === "Invalid URL" ? "invalid-origin" : reason,
            );
          }
          setFieldErrors({ ...draftErrors });
        });
    };
    const folderIcon = h(
      "svg",
      { viewBox: "0 0 16 16", "aria-hidden": true },
      h("path", {
        d: "M2 4h5l1-2h5a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1Z",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.3,
      }),
    );
    return h(
      "div",
      null,
      section(
        "显示位置",
        h(
          "p",
          { className: "kj-desktop-status", role: "status" },
          h("span", {
            className: "kj-state-dot",
            "data-online": view.online,
            "aria-hidden": true,
          }),
          view.online
            ? "DSH 已连接"
            : view.needsRestart
              ? "DSH 插件需在任务结束后重启更新"
              : "DSH 未连接，人物仍可独立陪伴",
        ),
        h(
          "div",
          { className: "kj-settings-actions" },
          button("打开 DSH", () => native.openDsh()),
          button("回到浏览器", () => native.browser()),
        ),
        toggle("保持置顶", "alwaysOnTop", view.capabilities.alwaysOnTop),
        toggle("透明区域穿透", "clickThrough", view.capabilities.clickThrough),
        view.capabilities.allWorkspaces
          ? toggle("所有桌面显示", "allWorkspaces")
          : null,
        choice("初始显示器", "display", [
          ["remember", "记住上次位置"],
          ["primary", "主显示器"],
          ["cursor", "鼠标所在显示器"],
        ]),
      ),
      section(
        "启动与节能",
        toggle("登录后启动桌宠", "login", view.packaged),
        choice("DSH 启动方式", "startDsh", [
          ["on-click", "点击时按需启动"],
          ["never", "仅连接，不启动"],
        ]),
        choice("节能模式", "power", [
          ["balanced", "平衡"],
          ["saver", "省电（静态陪伴）"],
        ]),
        choice("关闭窗口时", "closeAction", [
          ["quit", "退出桌宠"],
          ["hide", "隐藏到托盘"],
        ]),
        view.capabilities.platform === "linux"
          ? choice("Linux 窗口兼容", "linuxBackend", [
              ["auto", "自动（优先 X11）"],
              ["x11", "X11 / XWayland"],
              ["wayland", "Wayland 窗口模式"],
            ])
          : null,
        view.capabilities.wayland
          ? h(
              "p",
              { className: "hint" },
              "Wayland 使用普通窗口；置顶、全局定位和透明穿透受系统限制。切换窗口兼容模式需重新启动桌宠。",
            )
          : null,
        !view.packaged
          ? h(
              "p",
              { className: "hint" },
              "开发预览不注册开机启动；安装桌面版后可设置。",
            )
          : null,
      ),
      section(
        "DSH 连接",
        h(controls.TextField, {
          label: "本机 DSH 地址",
          help: DESKTOP_HELP.dshUrl,
          type: "url",
          value: url,
          placeholder: "http://127.0.0.1:3080",
          error: fieldErrors.dshUrl,
          onChange: (value) => edit("dshUrl", value),
          onCommit: (value) => commit("dshUrl", value),
          maxLength: 200,
        }),
        h(controls.TextField, {
          label: "DSH 配置名称",
          help: DESKTOP_HELP.profile,
          value: profile,
          placeholder: "web",
          error: fieldErrors.profile,
          onChange: (value) => edit("profile", value),
          onCommit: (value) => commit("profile", value),
          maxLength: 64,
        }),
        h(controls.TextField, {
          label: "DSH 程序",
          help: DESKTOP_HELP.executable,
          value: view.settings.executable || "",
          readOnly: true,
          placeholder: t("自动查找已安装的 DSH"),
          action: {
            label: "选择 DSH 程序",
            icon: folderIcon,
            onClick: () => perform(() => native.chooseExecutable()),
          },
        }),
      ),
      section(
        "运行操作",
        h(
          "div",
          { className: "kj-settings-actions" },
          button("隐藏人物", () => native.hide()),
          button("退出桌宠", () => native.quit()),
        ),
        h(
          "p",
          { className: "hint" },
          "退出桌宠不会停止 DSH 或正在执行的任务。",
        ),
      ),
      error ? h("p", { className: "err", role: "status" }, error) : null,
    );
  };
}
