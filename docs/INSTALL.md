# 安装、更新与卸载 / Install, update and remove

需要已安装的 Node.js 22.13+、`dsh` 和 `pnpm`，并保证三者在终端 PATH 中可用。插件无需前端构建，也无需先安装开发依赖。

Requires Node.js 22.13+, `dsh` and `pnpm` on PATH. No frontend build or development dependencies are needed.

## 一行安装 / One-command installation

在任意目录执行 / Run from any directory:

```sh
dsh plugin --profile web add https://github.com/YuluoY/dsh-kujira/releases/download/v0.2.0/dsh-kujira-0.2.0.tgz
```

macOS、Linux、Windows 使用相同命令。DSH 通过自己的包管理器下载、解包并注册插件，文件由 DSH 管理，不需要保留下载目录，也不需要运行其他安装脚本。命令不自动重启 DSH；等会话完成后正常重启，再刷新浏览器。

The same command works on macOS, Linux and Windows. DSH downloads, extracts and registers the plugin through its package manager. DSH owns the installed files; there is no download folder to keep or extra installer to run. It does not restart DSH: finish active sessions, restart normally, then refresh the browser.

地址固定到 v0.2.0，避免同一个“latest”下载地址被包管理器缓存成旧版本。更新时，复制新 Release 的版本化 `.tgz` 地址重复执行 `add`，无需先卸载。自定义 Web profile 将 `web` 替换为对应名称。

The URL pins v0.2.0 so a mutable “latest” URL cannot silently reuse a cached old package. To update, use the next release's versioned `.tgz` URL with `add`; no uninstall is needed. Replace `web` for a custom Web profile.

```sh
# 卸载 / Remove
dsh plugin --profile web remove dsh-kujira
```

需要能访问 GitHub Releases。网络受限时，可从能访问 GitHub 的设备下载安装包，再按下方方式本地安装。

GitHub Releases must be reachable. If access is restricted, download the archive on another device and follow the local installation steps below.

## 本地源码或离线安装 / Local-source or offline installation

下载并解压 [最新 Release](https://github.com/YuluoY/dsh-kujira/releases/latest) 的 `.tgz` 安装包，进入解压后的 `package` 目录：

Download the `.tgz` archive from the [latest release](https://github.com/YuluoY/dsh-kujira/releases/latest), extract it, and enter the `package` directory:

```sh
node scripts/dsh-plugin.mjs install
```

也可以从仓库安装 / Or clone the repository:

```sh
git clone https://github.com/YuluoY/dsh-kujira.git
cd dsh-kujira
npm run setup
```

平台快捷入口 / Platform shortcuts:

```sh
# macOS / Linux
sh scripts/install.sh
```

```powershell
# Windows PowerShell
.\scripts\install.ps1
# 如果本机不允许执行 PowerShell 脚本，直接使用 Node 命令：
# If local policy blocks PowerShell scripts, use Node directly:
node scripts/dsh-plugin.mjs install
```

脚本调用 DSH 官方的 `plugin --profile web add link:<目录>`。它检查环境和包完整性，保留带空格的路径，不修改凭据，不终止或重启会话。DSH 自己管理 profile 与插件依赖。链接目录需要长期保留。

The script calls DSH's `plugin --profile web add link:<directory>`. It checks prerequisites and package files, preserves paths containing spaces, and does not edit credentials or stop/restart sessions. DSH manages the profile and dependencies. Keep the linked directory.

等正在执行的会话完成后，正常重启 DSH Web，再刷新页面。宿主记账、随机掉落、取消冷却等后台修改需要重启；只刷新浏览器不会加载新的宿主代码。

After active sessions finish, restart DSH normally and refresh the browser. Host accounting and reward changes require a restart; a browser refresh alone does not reload host code.

## 检查与自定义 profile / Checks and custom profiles

```sh
npm run doctor
node scripts/dsh-plugin.mjs install --profile web --dry-run
node scripts/dsh-plugin.mjs install --profile my-web
```

`doctor` 只检查命令可用性和包文件，不读取私密配置。`--dry-run` 显示将要执行的命令，不执行安装。自定义 profile 必须是运行 Web 界面的配置；不要把它当成自动创建完整 Web 环境的脚本。

`doctor` checks executables and package files without reading private configuration. `--dry-run` prints the command without installing. A custom profile must already support the Web UI; this script does not configure a full Web environment for it.

## 更新 / Update

一行命令安装请使用新版本发布包 URL 重新执行 `dsh plugin --profile web add <URL>`。以下为本地链接安装的更新方式：

Git 安装可以在目录内 `git pull --ff-only`，然后执行 `npm run setup`。Release 安装请将新版解压到稳定目录并重新执行安装脚本。重跑安装会更新链接，不先卸载现有插件。

For Git installations, run `git pull --ff-only` and `npm run setup`. For release archives, extract the new version to a stable directory and rerun the installer. Reinstall updates the link without removing the existing plugin first.

## 卸载 / Remove

```sh
node scripts/dsh-plugin.mjs uninstall
# 自定义 profile / Custom profile
node scripts/dsh-plugin.mjs uninstall --profile my-web
```

卸载后正常重启 DSH。脚本保留养成库存与设置，不删除用户数据。遇到缺少 `dsh` / `pnpm` 时先安装对应工具并重新打开终端；脚本失败时会返回非零退出码，原始 DSH 错误保持可见。

Restart DSH after removal. Saved inventory and preferences are preserved. If `dsh` or `pnpm` is missing, install it and reopen the terminal. Failures return a nonzero exit code and keep the original DSH error visible.

## Optional desktop companion / 可选桌面模式

The one-command DSH plugin installation remains unchanged. Desktop mode is a separate optional application; installing the plugin does not download or launch Electron. See [DESKTOP.md](DESKTOP.md) for preview builds and platform limits. Optional unsigned desktop previews are listed in the v0.2.0 Release assets.

浏览器插件仍按原方式安装。桌面模式需单独安装桌宠应用，开启时确认接管再隐藏网页人物；可选的未签名桌面预览包见 v0.2.0 Release 附件，平台限制见桌面模式文档。
