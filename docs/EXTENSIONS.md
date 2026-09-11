# 功能扩展 / Feature extensions

通过公开 ESM 入口注册人物菜单功能。所有实例即时更新，自动参与用户设置的分页。内置 ID 受到保护，插件卸载时调用返回的注销函数。

Import the public ESM entry to register a radial action. Mounted mascots update immediately; user-controlled pagination also applies to extensions. Built-in IDs cannot be replaced. Call the returned disposer when your plugin unloads.

```js
const { registerFeature } = await import('/dsh-kujira/shared/feature-registry.js');

const unregister = registerFeature({
  id: 'my-plugin.docs',
  label: 'Documentation',
  iconPath: 'M4 3h12l4 4v14H4zM16 3v5h4',
  href: 'https://example.com/docs',
  order: 100,
});
// Plugin teardown:
unregister();
```

Or invoke a custom action:

```js
const unregister = registerFeature({
  id: 'my-plugin.weather',
  label: 'Local weather',
  iconPath: 'M4 16h16M7 12a5 5 0 1 1 10 0',
  onActivate: ({ openPanel }) => openPanel('weather'),
});
```

| 字段 / Field | 约定 / Contract |
|---|---|
| `id` | 2–64 characters: lowercase letters, digits, `.` and `-`; must start with a letter. Unique per active registration. |
| `label` | Nonempty display text, at most 80 characters. Supply your localized label. |
| `iconPath` | SVG path data in a 24×24 view box. No HTML or arbitrary SVG markup. |
| `href` | Absolute HTTP(S) URL. Opens a new tab with `noopener,noreferrer`. |
| `onActivate` | Callback; receives `openPanel(id)` and `closeMenu()`. May return a Promise. Use instead of `href`. |
| `order` | Optional finite number. External actions sort ascending after built-in actions. |

Built-in panel IDs: `balance`, `weather`, `growth`, `settings`, `activity`.
Reserved action IDs additionally include `feed`, `github`, `__more`.

每页按钮数量范围 3–8，包含“更多”；设置中的 GitHub 开关只影响项目仓库入口，不影响第三方功能。

The 3–8 button limit includes More. The GitHub visibility setting only controls the project shortcut, not third-party entries.
