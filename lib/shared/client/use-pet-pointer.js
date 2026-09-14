/**
 * @description Distinguish clicks from dragging and persist the mascot position.
 * @param {object} dependencies Explicit runtime and state dependencies.
 * @returns {object} Public values for the composing component.
 */
export function usePetPointer({
  ready,
  enterTask,
  rootRef,
  dragRef,
  prefsRef,
  DRAG_THRESHOLD,
  play,
  cfgRef,
  moveTo,
  clamp,
  GROWRef,
  writeStore,
  POS_KEY,
  readStore,
  GROW_KEY,
  busyRef,
  scheduleNext,
  stateRef,
  timerRef,
  pick,
  toggleOrb,
}) {
  const onPointerDown = (e) => {
    if (e.button !== 0 || !ready) {
      return;
    }
    enterTask();
    globalThis.kujiraDesktop?.dragStart(rootRef.current.getBoundingClientRect().toJSON());
    const rect = rootRef.current.getBoundingClientRect();
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: rect.left,
      originY: rect.top,
      moved: false,
      width: rect.width,
      height: rect.height,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (error) {}
    e.preventDefault();
  };
  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) {
      return;
    }
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;

    if (prefsRef.current.lock) return;
    if (!d.moved) {
      if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) {
        return;
      }
      d.moved = true;
      play(cfgRef.current.dragAnim, { loop: true });
    }

    if (globalThis.kujiraDesktop) { globalThis.kujiraDesktop.dragMove(); return; }
    const maxX = Math.max(0, window.innerWidth - d.width);
    const maxY = Math.max(0, window.innerHeight - d.height);
    moveTo(clamp(d.originX + dx, 0, maxX), clamp(d.originY + dy, 0, maxY));
  };
  const onPointerUp = (e) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) {
      return;
    }
    dragRef.current = null;
    globalThis.kujiraDesktop?.dragEnd();
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (error) {}

    const G = GROWRef.current;
    const cfg = cfgRef.current;
    const now = Date.now();

    if (d.moved) {
      const r = rootRef.current.getBoundingClientRect();
      writeStore(POS_KEY, { x: Math.round(r.left), y: Math.round(r.top) });

      if (G && cfg.growth.enabled) {
        const n = G.migrate(readStore(GROW_KEY), now);
        writeStore(
          GROW_KEY,
          G.applyGain(n, { stat: { drags: 1 } }, now, cfg.growth).state,
        );
      }
      if (!busyRef.current) {
        scheduleNext();
      } else {
        const def = cfg.state.map[stateRef.current];
        clearTimeout(timerRef.current);
        if (def)
          play(pick(def.anim || []), { loop: stateRef.current !== "success" });
      }
      return;
    }

    const list = cfg.pools.click;
    if (!busyRef.current && list && list.length) {
      clearTimeout(timerRef.current);
      play(pick(list), { loop: false });
    }

    if (cfg.ui.buttons) {
      toggleOrb();
    }
  };
  return { onPointerDown, onPointerMove, onPointerUp };
}
