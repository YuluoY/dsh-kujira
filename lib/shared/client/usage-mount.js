/**
 * @description Mount the session activity bridge and session cost surface.
 * @param {object} dependencies Explicit runtime and state dependencies.
 * @returns {object} Public values for the composing component.
 */
export function createUsageMount({
  useState,
  useEffect,
  injectCss,
  ensureTaskRuntime,
  ASSET_BASE,
  React,
  usePreferences,
  h,
}) {
  function UsageMount(props) {
    const [Component, setComponent] = useState(null);
    const [TaskBridge, setTaskBridge] = useState(null);
    useEffect(() => {
      injectCss();
      let active = true;
      ensureTaskRuntime()
        .then((runtime) => {
          if (active) setTaskBridge(() => runtime.Bridge);
        })
        .catch(() => {});
      import(ASSET_BASE + "/shared/usage-ui.js")
        .then((module) => {
          if (active)
            setComponent(() =>
              module.createUsageComponent(React, usePreferences),
            );
        })
        .catch(() => {});
      return () => {
        active = false;
      };
    }, []);
    return h(
      React.Fragment,
      null,
      TaskBridge ? h(TaskBridge, props) : null,
      Component ? h(Component, props) : null,
    );
  }
  return { UsageMount };
}
