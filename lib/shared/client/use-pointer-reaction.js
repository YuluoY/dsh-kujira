/**
 * @description Offer one idle greeting after deliberate mouse hover or keyboard focus.
 * @param {object} props React, live mascot state and scene playback.
 * @returns {void} Scoped event and timer lifecycle.
 */
export function usePointerReaction(props) {
  const { React } = props;
  const latest = React.useRef(props),
    last = React.useRef(-Infinity);
  latest.current = props;
  React.useEffect(() => {
    if (!props.ready) return;
    const stage = props.rootRef.current?.querySelector(".dsh-kujira-stage");
    if (!stage) return;
    let timer,
      inside = false;
    const eligible = () => {
      const p = latest.current;
      return (
        inside &&
        !document.hidden &&
        !p.reduced &&
        !p.prefs.focus &&
        p.prefs.contextualReactions !== false &&
        p.prefs.playful !== false &&
        !p.busyRef.current &&
        !p.dragRef.current?.moved &&
        !p.orbOpen &&
        !p.panel
      );
    };
    const leave = () => {
      inside = false;
      clearTimeout(timer);
    };
    const enter = (event) => {
      if (event.pointerType && event.pointerType !== "mouse") return;
      inside = true;
      clearTimeout(timer);
      if (Date.now() - last.current < 60000) return;
      timer = setTimeout(() => {
        if (!eligible()) return;
        if (
          latest.current.playScene("welcome", {
            ambient: true,
            guard: eligible,
          })
        )
          last.current = Date.now();
      }, 900);
    };
    stage.addEventListener("pointerenter", enter);
    stage.addEventListener("pointerleave", leave);
    stage.addEventListener("pointerdown", leave);
    stage.addEventListener("focus", enter);
    stage.addEventListener("blur", leave);
    document.addEventListener("visibilitychange", leave);
    return () => {
      leave();
      stage.removeEventListener("pointerenter", enter);
      stage.removeEventListener("pointerleave", leave);
      stage.removeEventListener("pointerdown", leave);
      stage.removeEventListener("focus", enter);
      stage.removeEventListener("blur", leave);
      document.removeEventListener("visibilitychange", leave);
    };
  }, [props.ready, props.rootRef]);
}
