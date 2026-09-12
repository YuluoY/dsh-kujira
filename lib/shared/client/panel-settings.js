/**
 * @description Render saved preferences with a fixed action footer.
 * @param {object} dependencies Explicit runtime and state dependencies.
 * @returns {object} Public values for the composing component.
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
  disclosure,
  inventory,
  inventoryBusy,
  setFreeInteractions,
  SchedulerSettings,
  RealtimeSettings,
  RewardSettings,
  POS_KEY,
  rootRef,
  applyVisual,
  PREF_DEFAULTS,
}) {
  const choice = (label, key, options, help) =>
    h(
      "div",
      { className: "kj-setting" },
      fieldLabel(label, help),
      h(PanelSelect, {
        label,
        value: prefs[key],
        options,
        onChange: (value) => updatePrefs({ [key]: value }),
      }),
    );
  const toggle = (label, key, help) =>
    h(
      "div",
      { className: "kj-setting" },
      fieldLabel(label, help),
      h("input", {
        type: "checkbox",
        role: "switch",
        "aria-label": label,
        checked: Boolean(prefs[key]),
        onChange: (e) => updatePrefs({ [key]: e.target.checked }),
      }),
    );
  const range = (label, key, min, max, unit, help) =>
    controls
      ? h(controls.Range, {
          label,
          labelNode: fieldLabel(label, help),
          min,
          max,
          unit,
          value: prefs[key],
          onChange: (value) => updatePrefs({ [key]: value }),
        })
      : null;
  return h(
    "div",
    { className: "dsh-kujira-panel", "data-panel": "settings" },
    panelShell,
    panelHead(
      FEATURE_REGISTRY.find((f) => f.key === "settings").icon,
      "设置",
      "修改自动保存",
    ),
    h(
      "div",
      { className: "kj-body" },
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
        "国家联动语言、日期格式和天气服务。余额的币种与金额直接使用接口返回值，不做汇率换算。",
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
      disclosure(
        "功能菜单",
        h(
          "div",
          null,
          range(
            "按钮圆角",
            "menuRadius",
            0,
            50,
            "%",
            "0% 为正方形，50% 为圆形。",
          ),
          toggle("任务入口", "showTask", "在功能菜单中直接打开任务进展。"),
          toggle(
            "GitHub 入口",
            "showGitHub",
            "在人物功能菜单中显示项目仓库入口。",
          ),
          h(
            "div",
            { className: "kj-setting" },
            fieldLabel(
              "每页按钮",
              "包含“更多”按钮；超出数量的功能收纳到下一页。",
            ),
            h(controls.NumberField, {
              label: "每页按钮",
              min: 3,
              max: 8,
              step: 1,
              value: prefs.menuLimit,
              onChange: (value) => updatePrefs({ menuLimit: value }),
            }),
          ),
        ),
      ),
      disclosure(
        "陪伴与动效",
        h(
          "div",
          null,
          h(
            "div",
            { className: "kj-setting" },
            fieldLabel(
              "气泡停留",
              "状态更新后显示的秒数；收起后悬浮人物可再次查看。",
            ),
            h(controls.NumberField, {
              label: "气泡停留秒数",
              unit: "秒",
              value: prefs.taskPeekSeconds,
              min: 1,
              max: 60,
              step: 1,
              onChange: (value) => updatePrefs({ taskPeekSeconds: value }),
            }),
          ),
          h(
            "div",
            { className: "kj-setting" },
            fieldLabel(
              "无限互动",
              "两种模式都会按 DeepSeek 用量获得补给。开启后互动不扣库存；关闭后显示并消耗真实数量。同一 DSH 服务共享。",
            ),
            h("input", {
              type: "checkbox",
              role: "switch",
              "aria-label": "无限互动",
              checked: !!inventory?.free,
              disabled: !inventory?.ok || inventoryBusy,
              onChange: (e) => setFreeInteractions(e.target.checked),
            }),
          ),
          toggle("专注", "focus", "暂停人物动画与主动说话，保留工作状态标签。"),
          choice("动画", "motion", [
            ["system", "跟随系统"],
            ["full", "完整动画"],
            ["reduced", "静态陪伴"],
          ]),
          h(
            "div",
            { className: "kj-setting" },
            fieldLabel(
              "称呼",
              "优先使用自定义称呼；留空使用系统用户名，不可用时使用亲切称呼。",
            ),
            h(controls.Nickname, {
              value: prefs.nickname,
              onChange: (value) => updatePrefs({ nickname: value }),
            }),
          ),
          toggle(
            "情境回应",
            "contextualReactions",
            "根据余额和任务时长播放低频动作；不增加模型请求。",
          ),
          toggle("提醒", "care", "回来时问候，久坐时提醒休息。"),
          toggle("互动回应", "playful", "使用亲切的互动回应。"),
          toggle("锁定位置", "lock", "锁定后不能拖动人物。"),
        ),
      ),
      disclosure(
        "全局会话调度",
        h(SchedulerSettings, {
          labelNode: fieldLabel(
            "紧急避险",
            "控制同一 DSH 服务的所有会话和子代理。峰价在步骤边界暂停，谷价自动续跑；关闭开关会立即放行等待中的步骤，不会重新提交任务。",
          ),
        }),
      ),
      disclosure("随机掉落", h(RewardSettings)),
      disclosure("实时信息同步", h(RealtimeSettings)),
      disclosure(
        "用量与隐私",
        h(
          "div",
          null,
          toggle("费用栏", "usage", "在输入区显示当前会话的预估费用。"),
          h(
            "div",
            { className: "kj-setting" },
            fieldLabel(
              "金额小数位",
              "仅调整会话费用的显示精度，不改变实际计算。",
            ),
            h(controls.NumberField, {
              label: "金额小数位",
              integer: true,
              min: 0,
              max: 6,
              step: 1,
              value: prefs.usageDecimals,
              onChange: (value) => updatePrefs({ usageDecimals: value }),
            }),
          ),
          toggle("隐藏余额", "hideBalance", "隐藏账户余额的具体金额。"),
          h(
            "div",
            { className: "kj-setting" },
            fieldLabel(
              "预算",
              "单位：元。0 表示不提醒；接近预算时提示，不中断任务。",
            ),
            controls
              ? h(controls.NumberField, {
                  label: "预算（元）",
                  unit: "¥",
                  prefix: true,
                  min: 0,
                  step: 0.1,
                  value: prefs.budget,
                  onChange: (value) => updatePrefs({ budget: value }),
                })
              : null,
          ),
          null,
        ),
      ),
    ),
    h(
      "div",
      { className: "kj-footer" },
      h(
        "button",
        {
          type: "button",
          className: "kj-action",
          onClick: () => {
            localStorage.removeItem(POS_KEY);
            const el = rootRef.current;
            el.style.left = "";
            el.style.top = "";
            el.style.right = "";
            el.style.bottom = "";
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
        "恢复默认设置",
      ),
    ),
  );
}
