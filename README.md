<div align="center">

# Kujira · 鲸鱼娘

**让 DeepSeek Harness 的任务进展，有一个安静又鲜活的陪伴。**

[English](README.en.md) · [下载](https://github.com/YuluoY/dsh-kujira/releases) · [反馈](https://github.com/YuluoY/dsh-kujira/issues) · [扩展接口](docs/EXTENSIONS.md)

[![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/YuluoY/dsh-kujira)](https://github.com/YuluoY/dsh-kujira/releases)
[![Stars](https://img.shields.io/github/stars/YuluoY/dsh-kujira?style=flat)](https://github.com/YuluoY/dsh-kujira/stargazers)

<img src="docs/images/task-progress.png" width="560" alt="鲸鱼娘与任务进展面板：当前操作、子代理协作和结果入口" />

*实际组件截图，任务与费用为本地模拟数据。*

</div>

## 她能做什么

- **跟随真实 Agent 进展**：思考、执行、等待回应、完成、错误；按需查看计划、工具结果、修改文件和子代理，提供宿主跳转入口。
- **50 段透明动画**：待机、工作、睡眠三段、点击、拖动、喂食、查看天气与翻钱包；状态和用户操作优先，支持静态陪伴与减少动态效果。
- **全局峰谷调度**：开启后，同一 DSH 服务的所有主代理及子代理在峰价的步骤边界暂停，谷价继续原任务。
- **克制的费用栏**：输入框底部右侧只显示“谷／峰”和当前会话预估费用；悬浮有背景反馈，点击只看谷价、峰价、合计。
- **余额与天气**：余额来自 DeepSeek 官方接口，保留原币种；城市留空自动定位，可手动指定。支持中、美、韩、俄和跟随系统。
- **可选择的养成规则**：DeepSeek 可核对用量累计产生随机补给，互动消费库存；也可打开无限免费互动。
- **可扩展菜单**：GitHub 入口可隐藏，每页 3–8 个按钮（含“更多”），超出自动分页；外部插件可注册新功能。

## 效果一览

<p align="center"><img src="docs/images/session-cost.png" width="256" alt="紧凑的会话费用浮层，只有谷价费用、峰价费用和合计" /></p>

面板按内容向下展开，最高为 520px 或视口高度的 78%。超过上限时只滚动内容，保留标题与设置操作区。大量任务先展示 8 项，按需追加；正文、状态和次要链接分别处理，不把全部信息塞进默认视图。

## 安装到 DSH

需要已能正常运行的 DeepSeek Harness Web。插件使用宿主提供的 React、slots、sessions 和 agents 服务，不需要单独安装 React 或打包前端。

```bash
git clone https://github.com/YuluoY/dsh-kujira.git
cd dsh-kujira
npm run link
```

重启 DSH Web 并刷新页面。也可下载 [Release](https://github.com/YuluoY/dsh-kujira/releases) 中的插件包，解压后在目录内运行同一链接命令。

```bash
# 卸载
npm run unlink
```

余额使用 DSH 已配置的 DeepSeek 凭据，密钥仅在宿主侧读取。未配置凭据时展示明确的错误，不生成虚构余额。

### 峰谷调度如何工作

在 **设置 → 全局会话调度 → 谷价自动执行** 中打开。默认关闭，偏好在宿主持久保存。

| 时机 | 行为 |
|---|---|
| 峰价 | 拦截全局 `agent/pre-step`，阻止下一步骤继续执行；主代理和子代理均适用。 |
| 谷价 | 放行等待中的原始 continuation，继续原会话，不发送伪造的“继续”提示词。 |
| 用户手动取消 | 保留取消结果，不会在谷价复活已取消任务。 |
| 关闭调度 | 立即释放调度等待中的步骤。 |

已经发出的模型请求或正在执行的工具会完成，然后暂停；这不是撤销请求，也不能追回已经发生的费用。范围为**同一 DSH 服务进程**，不跨机器控制独立 DSH 实例。峰谷时段取当前计价配置与其时区，不以界面语言推断。

本地预览没有连接真实 DSH，因此会标记为预览；正式安装使用真实钩子。宿主缺少必要能力时会显示不可用，而不是假装暂停成功。

### 金额与补给

`total_balance` 是可用余额，`topped_up_balance` 是剩余充值余额，`granted_balance` 是赠金余额；并非历史充值总额。切换国家只改变格式，**不转换官方账户币种**。会话费用属于依据可核对用量与价格计算的估算，不是官方账单。

默认每累计 ¥0.10 可核对 DeepSeek 用量预估费用获得一次补给。每五次包含小鱼干×2、摸头／陪玩／舒展各×1，顺序随机。互动共用冷却时间；无限免费模式不扣库存。预览用量不会产生真实补给。

## 本地预览与开发

```bash
npm ci --legacy-peer-deps
npm run preview
# 默认 http://127.0.0.1:8792/
# 指定端口：PREVIEW_PORT=8793 npm run preview
```

预览可切换工作状态、峰谷费用示例和“长内容与多任务”。任务与费用示例隔离于生产路由；余额／天气仍可能读取真实服务，请勿将私人账户数据放进公开截图。

```bash
npm test          # 逻辑、宿主、计费、调度、控件与客户端回归
npm run lint     # ESLint、React Hooks 和 Stylelint
npm run typecheck
```

无前端构建步骤。类型检查覆盖已标注的状态语义、几何、语言资源与资源清单；动态 React 工厂使用 JavaScript。

```text
lib/client.js                 DSH 浏览器模块与槽位注册
lib/index.js                  宿主路由与服务装配
lib/host/                     真实会话、余额、用量、库存、全局调度
lib/shared/client/            人物状态、播放、布局、菜单与功能面板
lib/shared/task/              任务订阅、状态语义、渐进式展示
lib/shared/feature-registry.js 外部功能注册入口
lib/shared/locales/           中、英、韩、俄语言资源
lib/styles/                   按职责拆分，宿主合并发送的样式
assets/anim/                  50 段透明 WebM
assets/pet.config.json        动作、状态与布局配置
tools/                        测试与独立预览
```

[扩展接口与示例](docs/EXTENSIONS.md) · [全部动画触发映射](docs/ANIMATIONS.md)

## 兼容性与验证范围

实现对照本地取得的 DSH 源码中的 `agent/pre-step`、`conversation.composer.dock`、会话快照与子代理导航接口。自动化测试及内置浏览器预览已验证；不同 DSH 版本仍可能存在接口差异，尚未宣称覆盖全部真实宿主版本。WebM 素材不支持独立眼球变形，因此没有虚构鼠标眼神追踪。

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=YuluoY/dsh-kujira&type=Date)](https://www.star-history.com/#YuluoY/dsh-kujira&Date)

曲线由 [Star History](https://www.star-history.com/blog/how-to-use-github-star-history/) 根据真实 GitHub 星标生成；新仓库需积累数据，图像可能有缓存延迟。

## 许可与致谢

代码采用 [MIT](LICENSE)。动画来自 [yanzwzz/dsh-whale-girl-pet](https://github.com/yanzwzz/dsh-whale-girl-pet)，保留原作者版权与 MIT 许可。感谢 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 的参考实现。内置 i18next 保留其 [第三方许可](lib/shared/vendor/i18next.LICENSE)。本项目为社区插件，非 DeepSeek 官方产品。
