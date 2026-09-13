/**
 * @description Share a top-layer surface and retain departing speech for its exit animation.
 * @param {object} props React, current content and interaction gates.
 * @returns {object|null} Mutually exclusive progress or thought bubble.
 */
export function BubbleLayer({
  React,
  h,
  kind,
  speech,
  state,
  runtime,
  onOpen,
  blocked,
  reduced,
  fit,
}) {
  const [present, setPresent] = React.useState(kind),
    [leaving, setLeaving] = React.useState(false);
  const container = React.useRef(null),
    content = React.useRef({ speech, state });
  if (speech) content.current.speech = speech;
  if (kind === "task") content.current.state = state;
  React.useEffect(() => {
    if (blocked) {
      setPresent(null);
      setLeaving(false);
      return;
    }
    if (kind) {
      setPresent(kind);
      setLeaving(false);
      return;
    }
    if (!present) return;
    if (reduced) {
      setPresent(null);
      return;
    }
    setLeaving(true);
    const timer = setTimeout(() => {
      setPresent(null);
      setLeaving(false);
    }, 240);
    return () => clearTimeout(timer);
  }, [kind, blocked, reduced, present]);
  React.useLayoutEffect(() => {
    const el = container.current;
    if (!el || blocked || !present) return;
    el.showPopover?.();
    fit.current?.();
    return () => {
      if (el.matches(":popover-open")) el.hidePopover();
    };
  }, [present, blocked]);
  if (!present || blocked) return null;
  const source = content.current;
  return h(
    "div",
    {
      ref: container,
      popover: "manual",
      className: "kj-bubble-layer",
      "data-leaving": leaving,
      "data-reduced": reduced,
    },
    present === "task" && runtime
      ? h(runtime.Bubble, {
          state: source.state,
          onOpen,
          shell: h(
            "svg",
            { className: "kj-shell", "aria-hidden": true },
            h("path", { className: "kj-outline" }),
          ),
        })
      : h(
          "div",
          {
            className: "dsh-kujira-bubble kj-thought-bubble",
            key: source.speech,
            role: "status",
            "aria-live": "polite",
          },
          h("span", {
            className: "kj-thought-dot kj-thought-dot-small",
            "aria-hidden": true,
          }),
          h("span", {
            className: "kj-thought-dot kj-thought-dot-large",
            "aria-hidden": true,
          }),
          h(
            "div",
            { className: "kj-thought-body" },
            h("span", { className: "kj-speech-copy" }, source.speech),
          ),
        ),
  );
}
