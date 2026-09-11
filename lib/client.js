window.__ModuleLoader__.load({
  id: "dsh-kujira",
  factory: (require) => {
    const React = require("react");
    const runtime = import("/dsh-kujira/shared/client/index.js").then(
      (module) => module.createClient(React),
    );
    const Pet = React.lazy(() =>
      runtime.then((client) => ({ default: client.Pet })),
    );
    const Usage = React.lazy(() =>
      runtime.then((client) => ({
        default: function UsageEntry({ ctx, ...props }) {
          const navigate = React.useMemo(() => client.navigate(ctx), [ctx]);
          return React.createElement(client.UsageMount, {
            ...props,
            navigate,
          });
        },
      })),
    );
    const mount = (Component, props) =>
      React.createElement(
        React.Suspense,
        { fallback: null },
        React.createElement(Component, props),
      );
    return {
      name: "kujira",
      inject: ["slots"],
      apply(ctx) {
        ctx.slots.inject("shell.overlay", function* () {
          yield ctx.slots.register(
            { name: "shell.overlay", id: "kujira", order: 900 },
            () => mount(Pet, {}),
          );
        });
        ctx.slots.inject("conversation.composer.dock", function* () {
          yield ctx.slots.register(
            {
              name: "conversation.composer.dock",
              id: "kujira-session-cost",
              order: 950,
            },
            (props) => mount(Usage, { ...props, ctx }),
          );
        });
      },
    };
  },
});
