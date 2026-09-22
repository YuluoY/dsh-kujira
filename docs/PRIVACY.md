# 数据与隐私 / Data and privacy

插件不会把会话内容、密钥、库存或本机用户名上传到 GitHub。安装脚本只调用 DSH 的插件管理命令，不读取密钥，不启停会话。

The plugin does not upload conversations, credentials, inventory or account names to GitHub. Installation scripts only invoke DSH plugin management and do not read secrets or control running sessions.

| 数据 / Data | 用途与范围 / Purpose and scope |
|---|---|
| DeepSeek 凭据 / Credentials | 宿主读取，用于向 DeepSeek 查询余额；不发送给浏览器。Host-only balance requests to DeepSeek; never sent to the browser. |
| 参考汇率 / Exchange rates | 宿主按需向 api.frankfurter.dev 请求固定 CNY/USD/KRW/RUB 表；不发送金额、账户、地区偏好或密钥。服务可见宿主网络 IP。Host requests a fixed public rate table; no amounts, accounts, country preferences or credentials are sent. The provider sees the host network IP. |
| 会话用量 / Usage | 本地计算当前会话及子代理费用。Local parent/subagent cost accounting. |
| 库存 / Inventory | 宿主持久保存，使用已结算用量发放物品，不保存聊天正文。Persisted by the host; settlement-based rewards without transcript content. |
| 称呼与外观 / Name and appearance | 自定义偏好在浏览器站点存储保存；桌面端另存于应用用户数据目录的 desktop.json 及备份。系统账户名由 DSH 宿主提供，仅显示在界面。Browser site storage and a desktop-local settings file; the host account name is used only in the UI. |
| 天气 / Weather | 查询城市；留空时可依据服务所在网络 IP 定位。City query, optionally IP-based location from the host's network. |
| 价目同步 / Price sync | 默认关闭。启用后访问公开官网；模型辅助须单独开启，可能消耗额度。Off by default; optional paid model assistance has a separate switch. |

库存保存在 `~/.dsh/dsh-kujira/inventory.sqlite`（支持配置目录）。数据库仅记录物品、小型状态和哈希后的结算标识；默认由独立工作线程通过 SQLite 事务读写。首次使用会自动迁移已有 `inventory.json`，原文件保留作备份。同一目录供本机多个 DSH 实例安全共享，独立库存请配置不同目录。目录应使用本机文件系统。迁移后降级到旧版只会看到旧 JSON 的备份状态，不能继续混用新旧版本写入。

Inventory uses a local `inventory.sqlite` database and a background worker. It stores small state and hashed settlement identifiers, without transcript text. Existing JSON inventory is migrated transactionally and retained as a backup. Multiple processes on the same machine can share the directory; use separate directories for independent inventories. Use a local filesystem. Older plugin versions cannot read subsequent SQLite changes, so do not mix old and new writers after migration.

README 图片来自隔离预览；示例余额不代表真实账户。GitHub 署名、仓库地址、Star History 和 badge 是公开展示信息。

README images come from an isolated preview. Demo balances are not account records. GitHub credits, repository links, Star History and badges are public project information.

## 提交前检查 / Before publishing

```sh
npm run audit:public
npm pack --dry-run
```

自动检查只输出文件名、行号和问题类型，不回显疑似密钥。它用于检查当前 Git 跟踪文件，不能替代历史检查和截图人工检查。提交 Issue 时请遮盖密钥、真实余额、会话正文和私有文件路径。

The audit reports paths, line numbers and finding types, never matched secrets. It covers currently tracked files and does not replace history or image review. Redact credentials, real balances, private paths and conversations before opening issues.

节假日日历：宿主定期向 cdn.jsdelivr.net（失败时 raw.githubusercontent.com）请求公开年度中国放假 JSON，只发送年份，不发送账户、会话、金额、语言或 API 密钥。提供方可见网络 IP。设置 `holidayCalendar.enabled: false` 可禁用联网更新。

Holiday calendar: the host requests public annual Chinese holiday JSON from cdn.jsdelivr.net, falling back to raw.githubusercontent.com. Requests contain only the year, with no accounts, sessions, amounts, languages or API keys. Providers see the network IP. Set `holidayCalendar.enabled: false` to disable updates.

DSH 更新：默认每天向 registry.npmjs.org 查询公开的 `@deepseek-ai/dsh` 版本标签。点击安装后才查询目标版本并通过原 npm/pnpm 全局安装器下载官方包及依赖。查询不发送会话、账户或 API 密钥；服务商可见网络 IP。可在设置中关闭自动检查，或通过 `harnessUpdate.enabled: false` 完全禁用。

DSH updates: daily checks request public `@deepseek-ai/dsh` tags from registry.npmjs.org. Only clicking Install fetches the target metadata and runs the existing global npm/pnpm installer to download the official package and dependencies. Checks send no sessions, accounts or API keys; the provider sees the network IP. Disable automatic checks in Settings or the entire service with `harnessUpdate.enabled: false`.
