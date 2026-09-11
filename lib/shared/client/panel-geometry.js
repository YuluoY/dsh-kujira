/**
 * @description Position panels independently of content height and cap their reading area.
 * @param {{top:number,height:number}} anchor Mascot viewport rectangle.
 * @param {{w:number,h:number}} viewport Available viewport.
 * @param {number} minimumHeight Minimum useful reading height before scrolling.
 * @returns {{top:number,maxHeight:number}} Stable viewport position and size limit.
 */
export function panelGeometry(anchor, viewport, minimumHeight = 260) {
  const margin = 12;
  const maxHeight = Math.max(
    0,
    Math.min(520, Math.floor(viewport.h * 0.78), viewport.h - margin * 2),
  );
  const preferred = anchor.top + anchor.height * 0.5 - 80;
  const reserve = Math.min(maxHeight, minimumHeight);
  const top = Math.max(
    margin,
    Math.min(preferred, viewport.h - reserve - margin),
  );
  return {
    top,
    maxHeight: Math.max(0, Math.min(maxHeight, viewport.h - top - margin)),
  };
}
