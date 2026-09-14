import { AnimationMenu } from "./animation-menu.js";
import { usePointerReaction } from "./use-pointer-reaction.js";

/**
 * @description Read companion needs without adding writes, network requests or polling.
 * @param {object} state Current mascot state and refs.
 * @param {Function} readStore Local storage reader.
 * @param {string} growthKey Growth storage key.
 * @returns {object} Current growth and already loaded weather facts.
 */
export function readSceneContext(state, readStore, growthKey) {
  const G = state.GROWRef.current,
    config = state.cfgRef.current,
    now = Date.now();
  const growth =
    G && config.growth.enabled
      ? G.tick(
          G.migrate(readStore(growthKey), now),
          now,
          { workingMs: 0 },
          config.growth.rates,
        ).state
      : null;
  return { growth, weather: state.weatherView };
}

/**
 * @description Compose pointer greetings and the optional manual animation player.
 * @param {object} props React, mascot facts and playback controls.
 * @returns {object|null} Manual player when its panel is open.
 */
export function useSceneInteractions({
  React,
  h,
  state,
  prefs,
  reduced,
  SearchSelect,
  playMoment,
  playScene,
}) {
  const [selection, rememberSelection] = React.useState("");
  usePointerReaction({ ...state, React, prefs, reduced, playScene });
  return state.panel === "growth"
    ? h(AnimationMenu, {
        React,
        h,
        config: state.cfgRef.current,
        value: selection,
        onValueChange: rememberSelection,
        SearchSelect,
        playMoment,
        blocked: state.busyRef.current || prefs.focus || reduced,
      })
    : null;
}
