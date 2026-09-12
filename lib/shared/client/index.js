import * as I18N from "../i18n.js";
import { createControls, bubbleOutline } from "../panel-controls.js";
import { createActivityRuntime } from "../activity-ui.js";
import { injectCss } from "./styles.js";
import { createPet } from "./pet.js";
import { createNavigation } from "./navigation.js";
import { createFieldLabel } from "./field-label.js";
import { createUtilities } from "./utilities.js";
import { createConfig } from "./config.js";
import { createIcons } from "./icons.js";
import { createFeatures } from "./features.js";
import { createPreferences } from "./preferences.js";
import { createSettingsControls } from "./settings-controls.js";
import { createUsageMount } from "./usage-mount.js";
/**
 * @description Build the browser runtime using the host React instance.
 * @param {object} React Host React instance.
 * @returns {object} Public values for the composing component.
 */
export function createClient(React) {
  const { useEffect, useLayoutEffect, useRef, useState, useCallback } = React;
  const h = (type, props, ...children) =>
    I18N.element(React, type, props, ...children);
  const t = I18N.t;
  const controls = createControls(React);
  const PanelSelect = controls.Select;
  const taskRuntime = createActivityRuntime(React);
  const navigationHistory = [];
  const ensureTaskRuntime = () => Promise.resolve(taskRuntime);
  const { fieldLabel } = createFieldLabel({ h, controls });
  const {
    liveViewport,
    layoutFor,
    pick,
    clamp,
    readStore,
    writeStore,
    localHour,
    greetingFor,
  } = createUtilities();
  const {
    ASSET_BASE,
    POS_KEY,
    SET_KEY,
    GROW_KEY,
    HINT_KEY,
    DRAG_THRESHOLD,
    IDLE,
    DEFAULTS,
    LABEL_GAP,
    normalizeConfig,
  } = createConfig({ clamp });
  const { icon, ICONS, weatherIcon } = createIcons({ h });
  const { FEATURE_REGISTRY } = createFeatures({ ICONS, icon, h });
  const { PREF_DEFAULTS, usePreferences } = createPreferences({
    readStore,
    SET_KEY,
    useState,
    I18N,
    useEffect,
    writeStore,
  });
  const { RealtimeSettings, SchedulerSettings, LocalClock } =
    createSettingsControls({
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
    });
  const { UsageMount } = createUsageMount({
    useState,
    useEffect,
    injectCss,
    ensureTaskRuntime,
    ASSET_BASE,
    React,
    usePreferences,
    h,
  });
  const Pet = createPet({
    usePreferences,
    useRef,
    useEffect,
    DEFAULTS,
    IDLE,
    useState,
    FEATURE_REGISTRY,
    React,
    ensureTaskRuntime,
    clamp,
    useLayoutEffect,
    liveViewport,
    bubbleOutline,
    useCallback,
    readStore,
    POS_KEY,
    writeStore,
    ASSET_BASE,
    pick,
    taskRuntime,
    injectCss,
    SET_KEY,
    I18N,
    normalizeConfig,
    greetingFor,
    GROW_KEY,
    localHour,
    controls,
    layoutFor,
    LABEL_GAP,
    HINT_KEY,
    DRAG_THRESHOLD,
    t,
    ICONS,
    h,
    fieldLabel,
    weatherIcon,
    LocalClock,
    icon,
    PanelSelect,
    SchedulerSettings,
    RealtimeSettings,
    PREF_DEFAULTS,
  });
  return {
    Pet,
    UsageMount,
    navigate: (ctx) =>
      createNavigation({ ctx, taskRuntime, history: navigationHistory })
        .navigateTask,
  };
}
