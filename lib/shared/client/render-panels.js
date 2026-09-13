import { renderActivityPanel } from "./panel-activity.js";
import { renderBalancePanel } from "./panel-balance.js";
import { renderWeatherPanel } from "./panel-weather.js";
import { renderGrowthPanel } from "./panel-growth.js";
import { renderSettingsPanel } from "./panel-settings.js";
/**
 * @description Select the active feature panel with shared frame controls.
 * @param {object} dependencies Panel data and callbacks.
 * @returns {object|null} Rendered panel.
 */
export function renderPanels({
  animationControls,
  panel,
  h,
  taskRuntime,
  taskView,
  setPanel,
  rootRef,
  panelShell,
  balanceView,
  panelHead,
  ICONS,
  t,
  loadBalance,
  controls,
  fieldLabel,
  prefs,
  I18N,
  updatedAt,
  weatherView,
  loadWeather,
  weatherIcon,
  metric,
  LocalClock,
  disclosure,
  cityForm,
  growthView,
  loadGrowth,
  refreshInventory,
  inventory,
  inventoryBusy,
  feed,
  stockCount,
  interact,
  icon,
  PanelSelect,
  updatePrefs,
  FEATURE_REGISTRY,
  setFreeInteractions,
  SchedulerSettings,
  RealtimeSettings,
  RewardSettings,
  POS_KEY,
  applyVisual,
  PREF_DEFAULTS,
}) {
  let panelEl = null;
  if (panel === "activity")
    panelEl = renderActivityPanel({
      h,
      taskRuntime,
      taskView,
      setPanel,
      rootRef,
      panelShell,
    });
  else if (panel === "balance")
    panelEl = renderBalancePanel({
      balanceView,
      h,
      panelShell,
      panelHead,
      ICONS,
      t,
      loadBalance,
      controls,
      fieldLabel,
      prefs,
      I18N,
      updatedAt,
    });
  else if (panel === "weather")
    panelEl = renderWeatherPanel({
      weatherView,
      h,
      panelShell,
      panelHead,
      ICONS,
      loadWeather,
      I18N,
      weatherIcon,
      t,
      metric,
      updatedAt,
      controls,
      LocalClock,
      disclosure,
      cityForm,
    });
  else if (panel === "growth")
    panelEl = renderGrowthPanel({
      animationControls,
      growthView,
      h,
      panelShell,
      panelHead,
      ICONS,
      loadGrowth,
      refreshInventory,
      controls,
      t,
      I18N,
      metric,
      inventory,
      inventoryBusy,
      feed,
      stockCount,
      interact,
      icon,
      disclosure,
    });
  else if (panel === "settings")
    panelEl = renderSettingsPanel({
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
    });

  return panelEl;
}
