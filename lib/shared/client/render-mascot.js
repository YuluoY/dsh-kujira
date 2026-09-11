/**
 * @description Render the mascot surface, speech, active panel and shared tooltip host.
 * @param {object} dependencies Explicit runtime and state dependencies.
 * @returns {object} Public values for the composing component.
 */
export function renderMascot({
  overlay,
  cfgRef,
  pageTimerRef,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  taskView,
  taskRuntime,
  taskVisible,
  taskFocused,
  panel,
  orbOpen,
  bubble,
  h,
  setOrbOpen,
  setPanel,
  label,
  prefs,
  arcCfg,
  geom,
  rootRef,
  enterTask,
  leaveTask,
  setTaskFocused,
  locale,
  theme,
  reduced,
  side,
  toggleOrb,
  aRef,
  bRef,
  tip,
  orbs,
  panelEl,
  controls,
}) {
  const cfg = cfgRef.current;
  const videoProps = {
    className: "dsh-kujira-video",
    muted: true,
    playsInline: true,
    preload: "auto",
    disablePictureInPicture: true,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
  };
  const urgentTask = ["waiting", "error"].includes(taskView.data?.stage);
  const taskBubble =
    taskRuntime &&
    (taskVisible || taskFocused) &&
    !panel &&
    !orbOpen &&
    !pageTimerRef.current &&
    (!bubble || urgentTask)
      ? h(taskRuntime.Bubble, {
          state: taskView,
          onOpen: () => {
            setOrbOpen(false);
            setPanel("activity");
          },
          shell: h(
            "svg",
            { className: "kj-shell", "aria-hidden": true },
            h("path", { className: "kj-outline" }),
          ),
        })
      : null;
  const bubbleEl =
    bubble && !urgentTask && !panel && !orbOpen && !pageTimerRef.current
      ? h(
          "div",
          {
            className: "dsh-kujira-bubble",
            role: "status",
            "aria-live": "polite",
          },
          h("span", { className: "kj-speech-copy" }, bubble),
          h(
            "svg",
            { className: "kj-shell", "aria-hidden": true },
            h("path", { className: "kj-outline" }),
          ),
        )
      : null;
  const labelEl =
    (cfg.debug.showLabel || cfg.ui.showLabel) && label
      ? h(
          "div",
          {
            className: "dsh-kujira-tag",
            style: { top: "auto", bottom: "-4px", opacity: 0.75 },
          },
          label,
        )
      : null;
  const rootStyle = {
    "--kj-orb-radius":
      Math.max(0, Math.min(50, Number(prefs.menuRadius) || 0)) + "%",
    "--kj-pet-opacity": Math.max(
      0.35,
      Math.min(1, Number(prefs.opacity) / 100),
    ),
    "--kj-in-ms": Number(arcCfg.enterMs || 285) + "ms",
    "--kj-fade-ms": Number(arcCfg.fadeMs || 155) + "ms",
    "--kj-out-ms": Number(arcCfg.exitMs || 190) + "ms",

    "--kj-panel-w": (geom.placement ? geom.placement.width : 272) + "px",
    "--kj-panel-in": (geom.placement ? geom.placement.pull : 0) + "px",
  };
  return h(
    "div",
    {
      ref: rootRef,
      className: "dsh-kujira-root",
      onPointerEnter: enterTask,
      onPointerLeave: leaveTask,
      onFocusCapture: (e) =>
        setTaskFocused(
          e.target.matches(
            ".dsh-kujira-stage:focus-visible, .kj-task-bubble:focus-visible",
          ),
        ),
      onPointerDownCapture: () => setTaskFocused(false),
      onBlurCapture: (e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setTaskFocused(false);
      },
      style: rootStyle,
      lang: locale,
      "data-corner": cfg.corner,
      "data-facing": cfg.facing,
      "data-theme": theme,
      "data-motion": reduced ? "reduced" : "full",
      "data-focus": prefs.focus ? "1" : "0",

      "data-btns":
        (geom.placement ? geom.placement.side : side) > 0 ? "left" : "right",
      "data-orb": orbOpen ? "1" : "0",

      "data-orb-r": String(geom.orbR || 0),
      "data-task-stage": taskView.data?.stage || "idle",
    },
    h(
      "div",
      {
        className: "dsh-kujira-stage",
        role: "button",
        tabIndex: 0,
        "aria-label": "鲸鱼娘功能菜单",
        "aria-expanded": Boolean(orbOpen || panel),
        onKeyDown: (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleOrb();
          }
        },
      },
      h("video", Object.assign({ key: "a", ref: aRef }, videoProps)),
      h("video", Object.assign({ key: "b", ref: bRef }, videoProps)),
      labelEl,
      tip ? h("div", { className: "dsh-kujira-tip" }, tip) : null,
    ),
    bubbleEl,
    taskBubble,
    orbs,
    overlay,
    panelEl,
    controls ? h(controls.TooltipHost, { rootRef }) : null,
  );
}
