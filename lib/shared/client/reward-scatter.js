import { supplyIcon } from "./supply-icon.js";
/**
 * @description Generate a bounded spread of fish with staggered landings inside the mascot surface.
 * @param {number} count Earned fish count.
 * @returns {Array} Decorative particle positions.
 */
export function fishParticles(count) {
  const length = Math.min(12, Math.max(0, Math.floor(count)));
  return Array.from({ length }, (_, i) => ({
    x: 9 + ((i * 37) % 82),
    delay: i * 65,
    tilt: ((i * 53) % 100) - 50,
    lift: 24 + ((i * 7) % 17),
    floor: 5 + ((i * 3) % 8),
  }));
}
/**
 * @description Render non-interactive SVG fish that arc down, settle and fade as one bounded burst.
 * @param {Function} h React element factory.
 * @param {object|null} burst Active reward burst.
 * @param {boolean} reduced Whether motion is suppressed.
 * @returns {object|null} Decorative reward layer.
 */
export function rewardScatter(h, burst, reduced) {
  if (!burst || reduced) return null;
  return h(
    "div",
    { key: "scatter:" + burst.id, className: "kj-fish-scatter", "aria-hidden": true },
    ...fishParticles(burst.count).map((particle, index) =>
      h(
        "span",
        {
          key: index,
          className: "kj-falling-fish",
          style: {
            left: particle.x + "%",
            bottom: particle.floor + "%",
            "--kj-fish-delay": particle.delay + "ms",
            "--kj-fish-tilt": particle.tilt + "deg",
            "--kj-fish-lift": -particle.lift + "px",
            "--kj-fish-drift": (50 - particle.x) * 1.8 + "px",
          },
        },
        supplyIcon(h, "fish"),
      ),
    ),
  );
}
