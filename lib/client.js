window.__ModuleLoader__.load({
  id: "dsh-kujira",
  factory: (require) => {
    const React = require("react");
    const runtime = import("/dsh-kujira/shared/client/index.js").then(
      async (module) => {
        await module.prepareClient();
        return module.createClient(React);
      },
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
    const ComposerPause = React.lazy(() =>
      runtime.then((client) => ({ default: client.ComposerPause })),
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
        ctx.effect(() => {
          let active=true, dispose;
          runtime.then(client=>{if(active) dispose=client.connectBrowser(ctx);});
          return ()=>{active=false;dispose?.();};
        });
        ctx.slots.inject("shell.overlay", function* () {
          yield ctx.slots.register(
            { name: "shell.overlay", id: "kujira", order: 900 },
            () => mount(Pet, {}),
          );
        });
        ctx.slots.inject("conversation.input.right", function* () {
          yield ctx.slots.register(
            {
              name: "conversation.input.right",
              id: "kujira-peak-pause",
              order: 950,
            },
            (props) => mount(ComposerPause, props),
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
