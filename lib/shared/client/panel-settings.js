import { PREFERENCE_NUMBERS } from "./preferences.js";
import { exchangeNote, money, t } from "../i18n.js";
/**
 * @description Organize preferences into four lazy categories with shared aligned controls.
 * @param {object} dependencies Shared components and preference operations.
 * @returns {object} Settings panel.
 */
export function renderSettingsPanel({
  h,
  fieldLabel,
  PanelSelect,
  prefs,
  updatePrefs,
  controls,
  panelShell,
  panelHead,
  FEATURE_REGISTRY,
  inventory,
  inventoryBusy,
  setFreeInteractions,
  SchedulerSettings,
  RealtimeSettings,
  RewardSettings,
  DesktopSettings,
  POS_KEY,
  rootRef,
  applyVisual,
  PREF_DEFAULTS,
}) {
  const section = (title, ...children) =>
    h(controls.SettingsSection, { title }, ...children);
  const row = (label, control, help) =>
    h("div", { className: "kj-setting" }, fieldLabel(label, help), control);
  const choice = (label, key, options, help) =>
    row(
      label,
      h(PanelSelect, {
        label,
        value: prefs[key],
        options,
        onChange: (value) => updatePrefs({ [key]: value }),
      }),
      help,
    );
  const toggle = (label, key, help) =>
    row(
      label,
      h("input", {
        type: "checkbox",
        role: "switch",
        "aria-label": label,
        checked: !!prefs[key],
        onChange: (e) => updatePrefs({ [key]: e.target.checked }),
      }),
      help,
    );
  const number = (label, key, options, help) =>
    row(
      label,
      h(controls.NumberField, {
        label,
        value: prefs[key],
        onChange: (value) => updatePrefs({ [key]: value }),
        ...options,
        ...PREFERENCE_NUMBERS[key],
      }),
      help,
    );
  const range = (label, key, min, max, unit, help) =>
    h(controls.Range, {
      label,
      labelNode: fieldLabel(label, help),
      min: PREFERENCE_NUMBERS[key]?.min ?? min,
      max: PREFERENCE_NUMBERS[key]?.max ?? max,
      unit,
      value: prefs[key],
      onChange: (value) => updatePrefs({ [key]: value }),
    });
  const categories = [
    {
      id: "appearance",
      label: "外观",
      render: () =>
        h(
          "div",
          null,
          section(
            "人物外观",
            choice(
              "国家／地区",
              "locale",
              [
                ["system", "跟随系统"],
                ["zh-CN", "中国"],
                ["en-US", "United States"],
                ["ko-KR", "대한민국"],
                ["ru-RU", "Россия"],
              ],
              "国家联动语言、日期、天气和显示币种；按最新参考汇率换算，实际结算保持原币种。",
            ),
            choice("主题", "theme", [
              ["system", "自动"],
              ["light", "浅色"],
              ["dark", "深色"],
            ]),
            range("大小", "size", 120, 360, "px", "调整人物的显示尺寸。"),
            range(
              "不透明度",
              "opacity",
              35,
              100,
              "%",
              "100% 完全不透明，数值越小人物越透明。",
            ),
            row(
              "称呼",
              h(controls.Nickname, {
                value: prefs.nickname,
                onChange: (value) => updatePrefs({ nickname: value }),
              }),
              "优先使用自定义称呼；留空使用系统用户名，不可用时使用亲切称呼。",
            ),
            toggle("锁定位置", "lock", "锁定后不能拖动人物。"),
          ),
          section(
            "功能菜单",
            range(
              "按钮圆角",
              "menuRadius",
              0,
              50,
              "%",
              "0% 为正方形，50% 为圆形。",
            ),
            number(
              "每页按钮",
              "menuLimit",
              { min: 3, max: 8, step: 1 },
              "包含“更多”按钮；超出数量的功能收纳到下一页。",
            ),
            toggle("任务入口", "showTask", "在功能菜单中直接打开任务进展。"),
            toggle(
              "GitHub 入口",
              "showGitHub",
              "在人物功能菜单中显示项目仓库入口。",
            ),
          ),
          exchangeNote()
            ? h(
                "p",
                { className: "kj-caption", role: "status" },
                exchangeNote(),
              )
            : null,
        ),
    },
    {
      id: "interaction",
      label: "互动",
      render: () =>
        h(
          "div",
          null,
          section(
            "陪伴与动效",
            choice("动画", "motion", [
              ["system", "跟随系统"],
              ["full", "完整动画"],
              ["reduced", "静态陪伴"],
            ]),
            toggle(
              "专注",
              "focus",
              "暂停人物动画与主动说话，保留工作状态标签。",
            ),
            toggle(
              "情境回应",
              "contextualReactions",
              "根据作息、养成、天气、节日和工作状态回应，也会回应鼠标停留；不增加模型请求。",
            ),
            toggle("提醒", "care", "回来时问候，久坐时提醒休息。"),
            toggle("互动回应", "playful", "使用亲切的互动回应。"),
          ),
          section(
            "进展气泡",
            toggle(
              "悬停显示进展",
              "hoverProgress",
              "鼠标停留在人物上时显示任务进展；关闭不影响键盘访问和任务状态提醒。",
            ),
            number(
              "气泡停留",
              "taskPeekSeconds",
              { unit: "秒", min: 1, max: 60, step: 1 },
              "状态更新后显示的秒数；收起后悬浮人物可再次查看。",
            ),
          ),
          section(
            "补给与互动",
            row(
              "无限互动",
              h("input", {
                type: "checkbox",
                role: "switch",
                "aria-label": "无限互动",
                checked: !!inventory?.free,
                disabled: !inventory?.ok || inventoryBusy,
                onChange: (e) => setFreeInteractions(e.target.checked),
              }),
              "两种模式都会按 DeepSeek 用量获得补给。开启后互动不扣库存；关闭后显示并消耗真实数量。同一 DSH 服务共享。",
            ),
            h(RewardSettings),
          ),
        ),
    },
    { id: "desktop", label: "桌面", render: () => h(DesktopSettings) },
    {
      id: "services",
      label: "服务",
      render: () =>
        h(
          "div",
          null,
          section(
            "用量与隐私",
            toggle("费用栏", "usage", "在输入区显示当前会话的预估费用。"),
            toggle("隐藏余额", "hideBalance", "隐藏账户余额的具体金额。"),
            number(
              "金额小数位",
              "usageDecimals",
              { integer: true, min: 0, max: 6, step: 1 },
              "仅调整会话费用的显示精度，不改变实际计算。",
            ),
            number(
              "预算",
              "budget",
              { unit: "CNY", prefix: true, min: 0, step: 0.1 },
              "单位：元，范围 0–1,000,000，最多两位小数。0 表示不提醒；接近预算时提示，不中断任务。",
            ),
            h(
              "p",
              { className: "kj-caption" },
              t("按人民币设置，当前约合 {amount}", {
                amount: money(prefs.budget),
              }),
            ),
          ),
          section(
            "全局会话调度",
            h(SchedulerSettings, {
              labelNode: fieldLabel(
                "紧急避险",
                "控制同一 DSH 服务进程内的会话、Goal 续轮和子代理。峰价在安全边界等待，谷价续跑。关闭开关即使仍在峰价也会立即放行；已取消的任务和手动暂停的 Goal 不会重新启动。",
              ),
            }),
          ),
          section("实时信息同步", h(RealtimeSettings)),
        ),
    },
  ];
  return h(
    "div",
    { className: "dsh-kujira-panel", "data-panel": "settings" },
    panelShell,
    panelHead(
      FEATURE_REGISTRY.find((f) => f.key === "settings").icon,
      "设置",
      "修改自动保存",
    ),
    h(controls.SettingsTabs, { items: categories }),
    h(
      "div",
      { className: "kj-footer" },
      h(
        "button",
        {
          type: "button",
          className: "kj-action",
          onClick: () => {
            if (globalThis.kujiraDesktop) {
              globalThis.kujiraDesktop.resetPosition();
              return;
            }
            localStorage.removeItem(POS_KEY);
            const el = rootRef.current;
            Object.assign(el.style, {
              left: "",
              top: "",
              right: "",
              bottom: "",
            });
            applyVisual();
          },
        },
        "人物归位",
      ),
      h(
        "button",
        {
          type: "button",
          className: "kj-action",
          onClick: () => updatePrefs(PREF_DEFAULTS),
        },
        "恢复人物设置",
      ),
    ),
  );
}
