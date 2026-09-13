import { createActivityProjection } from "./activity-projector.js";
export {
  cleanText,
  publicText,
  operationKind,
  phaseLabel,
} from "./activity-facts.js";
export { createActivityProjection };
/**
 * @description Project one complete session history through the incremental reducer.
 * @param {Array} events Durable events.
 * @param {number} inherited Prefix owned by a parent.
 * @returns {object} Bounded public task facts.
 */
export function sessionActivity(events, inherited = 0) {
  const projection = createActivityProjection();
  for (let index = inherited; index < events.length; index++)
    projection.append(events[index]);
  return projection.snapshot();
}
export {animationState} from "./activity-state.js";
