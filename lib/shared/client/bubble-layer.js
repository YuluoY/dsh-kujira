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
    }, 340);
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
            h("svg", {
              className: "kj-thought-cloud", viewBox: "105 10 380 320",
              "aria-hidden": true, focusable: "false",
            }, h("path", {
              d: "M205 77 C166 66 118 97 140 166 C107 193 115 247 154 266 C171 276 187 275 205 267 C226 317 276 325 311 289 C350 325 414 310 414 239 C481 224 483 137 417 117 C421 55 365 25 319 56 C286 10 226 12 205 77 Z",
            })),
            h("span", { className: "kj-speech-copy" }, source.speech),
          ),
        ),
  );
}
