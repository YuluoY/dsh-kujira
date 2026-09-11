/**
 * @description Render task progress with focus restoration on close.
 * @param {object} dependencies Explicit runtime and state dependencies.
 * @returns {object} Public values for the composing component.
 */
export function renderActivityPanel({
  h,
  taskRuntime,
  taskView,
  setPanel,
  rootRef,
  panelShell,
}) {
  return h(taskRuntime.Panel, {
    state: taskView,
    onClose: () => {
      setPanel(null);
      requestAnimationFrame(() =>
        rootRef.current?.querySelector(".kj-task-bubble")?.focus(),
      );
    },
    shell: panelShell,
  });
}
