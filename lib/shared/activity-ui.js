import { element } from "./i18n.js";
import { createActivityStore } from "./task/store.js";
import { createTaskIcons } from "./task/icons.js";
import { createTaskBubble } from "./task/bubble.js";
import { createTaskPanel } from "./task/panel.js";
/**
 * @description Compose the shared task store and its bubble and panel surfaces.
 * @param {object} React Host React instance.
 * @returns {object} Public task runtime, shared by mascot and composer dock.
 */
export function createActivityRuntime(React) {
  const h = (type, props, ...children) =>
    element(React, type, props, ...children);
  const icon = createTaskIcons(h);
  return {
    ...createActivityStore(React),
    Bubble: createTaskBubble(React, icon),
    Panel: createTaskPanel(React, icon),
  };
}
