/**
 * @description Reuse the shared help label across feature panels and settings.
 * @param {object} dependencies Explicit runtime and state dependencies.
 * @returns {object} Public values for the composing component.
 */
export function createFieldLabel({ h, controls }) {
  const fieldLabel = (label, help) => h(controls.HelpLabel, { label, help });
  return { fieldLabel };
}
