import { getFeatures, subscribeFeatures } from "../feature-registry.js";
/**
 * @description Subscribe to external feature registration and apply menu preferences.
 * @param {object} dependencies React, built-ins and icon renderer.
 * @returns {Array} Visible feature definitions.
 */
export function useFeatureRegistry({
  React,
  builtins,
  showGitHub,
  showTask = true,
  icon,
  h,
}) {
  const [extensions, setExtensions] = React.useState(getFeatures);
  React.useEffect(() => subscribeFeatures(setExtensions), []);
  return React.useMemo(
    () => [
      ...builtins.filter(
        (feature) =>
          (feature.key !== "github" || showGitHub) &&
          (feature.key !== "activity" || showTask),
      ),
      ...extensions.map((feature) => ({
        ...feature,
        icon: icon([h("path", { key: feature.id, d: feature.iconPath })]),
      })),
    ],
    [showGitHub, showTask, extensions, builtins, icon, h],
  );
}
