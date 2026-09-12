# 性能与模型用量

默认安装不会为桌宠额外调用模型，也不会往任务提示词中添加内容。状态来自 DSH 已产生的事件，金额和补给在本地核算。插件不代理或改写模型的流式输出。

这不等于零开销：动画使用浏览器的 CPU/GPU；状态刷新有本地 HTTP 和 JSON 开销；费用与库存需要本机计算和磁盘写入。初次读取长会话仍需扫描历史记录。低配设备可以使用“静态陪伴”，减少人物动画开销。

## 两个需要区分的开关

- **紧急避险**默认关闭。开启后，峰价在执行边界暂停，谷价续跑；等待时间是功能本身的行为。
- **模型辅助**默认关闭。只有明确开启、官网规则解析失败且满足调用间隔时，才请求模型生成辅助摘要。这会额外消耗模型用量，最多每天一次；结果不直接用于自动计价。

余额、天气和官网价格查询是普通 HTTP 请求。默认价格检查间隔为 24 小时，复用本地缓存。

## 已做的优化

- 用量索引复用 DSH 不可变日志的历史前缀，仅处理新增事件。日志替换、继承前缀或计价配置改变时重新建立索引。
- 没有新增结算时不复制整份库存；有变化时只复制需要修改的分支。原有结算幂等与原子写入规则保留。
- 同一轮事件中的重复结算通知合并，在当前事件循环之后处理，不等待库存写入才继续 agent 的事件回调。正常释放插件时会等待已排队的写入。
- 任务进展没有变化时使用 ETag/304，避免重复发送、解析结果正文；隐藏页面暂停轮询。
- Tabs 只挂载当前类别，列表按需显示更多。未选择类别保留页数和滚动位置，不渲染隐藏的大段 Markdown。
- 费用接口专注计价；任务详情由独立的进展接口提供。

## 可复现的本机测量

运行 `npm run benchmark`，不需要 API Key，也不会调用模型。

以下为一次 macOS ARM64、Node v25.2.1 的合成日志测试。计价项目取 20 次采样的中位数，单位 ms：

| 已有结算记录 | 全量重新计价 | 追加一条的增量计价 | 日志未变化 |
| ---: | ---: | ---: | ---: |
| 100 | 0.4986 | 0.0170 | 0.0005 |
| 1,000 | 2.0435 | 0.0495 | 0.0004 |
| 5,000 | 6.8054 | 0.2452 | 0.0003 |

调度关闭时，10,000 次 gate 调用的单次平均耗时约 0.0005 ms。

这些数字只测本地计价索引和空调度入口，不包含磁盘写入、网络、动画渲染或模型生成，也不能换算成 tokens/s 提升。尚未做真实模型的端到端吞吐对照测试，因此不承诺安装前后的任务总耗时完全相同。

## English summary

The default plugin makes no additional model calls, adds no prompt content, and does not proxy the token stream. It still uses local CPU/GPU, HTTP polling and disk I/O. Peak scheduling intentionally waits when enabled; optional model-assisted pricing summaries can incur usage. Both options default to off.

Accounting now processes appended events incrementally; duplicate notifications are coalesced, unchanged activity uses conditional HTTP responses, and only the active task tab mounts its content. The benchmark above is synthetic local work, not an end-to-end model throughput test.


Parent-session totals read verified descendant sessions only when the footer queries usage. Reads coalesce per parent and use four-way concurrency. Completed child summaries contain costs and child IDs rather than retained transcript text; they expire after 60 seconds and are invalidated by session events. Traversal deduplicates IDs and is bounded at 256 descendants and 24 levels. Unreadable or bounded-out branches mark totals as partial. The footer supply ring subscribes to the existing inventory source and starts no additional inventory polling.
