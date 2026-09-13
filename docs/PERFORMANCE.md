# 性能与模型用量

默认安装不为桌宠额外调用模型，不向任务提示词添加内容，也不代理或改写模型流。模型辅助、自动价格同步和峰谷调度默认关闭。启用调度后，峰价在执行边界等待是功能本身的行为；启用模型辅助后，官网解析失败时可能产生最多每天一次的辅助模型调用。

插件仍有本机成本：宿主首次读取长会话、浏览器动画解码、HTTP 刷新及持久化。以下测量是合成数据下的本地性能，不能换算为服务端模型 tokens/s 提升。

## 执行链路

- 任务进展复用不可变日志前缀，只处理新增事件；工具结果按调用 ID 配对，已完成正文只提取一次，普通刷新不重读历史正文。
- 常规进展返回摘要、状态和消息位置；子代理工具正文不随父会话整包返回。展开结果时单独读取正文，仍提供原会话导航。旧消息分页复用增量索引。
- 未变化进展返回 ETag/304。客户端使用版本标识比较，避免重复 stringify 大对象。
- 库存轮询单飞、可取消，失败退避；隐藏页面取消请求并停止定时刷新。结算通知在当前事件轮之后执行，同一会话有在途结算时合并后续通知，并发最多四个。
- 历史 inspect 在插件内共享四路并发；取消排队任务、合并相同读取、隔离各消费者取消。费用树有七秒总预算，超出预算返回不完整合计；HTTP 读取也受连接生命周期和八秒截止时间约束。树遍历保留父子归属检查、256 子节点和 24 层上限。
- 宿主私有用量索引原位维护记录及增量汇总，避免每次追加复制全部 Map、重新累加总价。公开纯函数仍支持独立、不可变的完整计价结果。

## 库存存储

需要 Node.js **22.13+**。使用 Node 内置 SQLite，无第三方运行依赖。默认生产路径由一个共享 worker 处理数据库事务；连接数有上限，空闲 worker 不阻止进程退出。文件 I/O、旧 JSON 的解析迁移和数据库提交不占用 DSH 主事件循环。

小型库存状态与带复合索引的结算幂等记录分别存储。多进程通过 SQLite 事务协调，避免旧内存覆盖另一实例的新余额。互动不扫描结算表，也不复制、序列化或重写全部历史账本。首次初始化会在同一事务中迁移已有 `inventory.json` 并保留原文件。数据库默认位于 `~/.dsh/dsh-kujira/inventory.sqlite`，使用本机文件系统；需要独立库存时配置不同目录。混用旧版 JSON 写入者与新版数据库写入者不受支持。

取舍：增加一个工作线程、SQLite 索引和首次初始化成本；小账本不保证每次互动比纯 JSON 更快，数据库也可能比 JSON 占更多磁盘。结算幂等记录仍保留，避免删历史后重发奖励。宿主首次建立用量索引仍需读取历史，未声称零 CPU 或零内存开销。

## 加载与界面

- 当前语言目录按需加载并去重，不预载其他三种语言。任务面板和 Markdown 解析器在展开时加载；日期/金额 formatter 有限缓存。
- `client/index.js` 的静态依赖从 65 个模块、578,248 B 降到 52 个、326,819 B。这个口径不含随后加载的当前语言、行为模块、费用栏、CSS、动画或宿主 React，不能当作整个页面的下载量。
- JS/CSS 使用 ETag 与 `no-cache` 重验证，文件有变化时立即提供新版；未变的拼接 CSS 复用已有正文。视频支持 Range 请求，连接断开会释放文件流。
- 布局观察器按挂载生命周期注册，通过尺寸与子节点变化重测，避免每次 Pet 更新都拆建观察器。
- 两个 video 元素轮换当前片段，未预加载全部动画。隐藏页面、静态陪伴及减弱动效继续暂停播放。原有 50 段素材保持不变；后续场景扩展新增 80 段，详见动画扩展体积说明。

## 可复现的本机测量

```sh
npm run benchmark
npm run test:performance
```

工具只使用独立临时目录和合成数据，不需要 API Key，不调用模型，也不修改真实库存。

下表为同一台 macOS ARM64、Node v25.2.1 上审查阶段与优化后的测量。更新耗时取中位数，响应大小为未压缩 JSON；工具结果每条 6,000 字符，子代理场景每个子代理 40 次工具操作。

| 场景 | 优化前 | 优化后 |
| --- | ---: | ---: |
| 5,000 次操作，新增一个 step/start 后进展重算 | 81.484 ms | 0.071 ms |
| 同一长会话冷读 | 202.182 ms | 38.963 ms |
| 50 个子代理的常规响应 | 12,784,702 B | 24,527 B |
| 200 个子代理的常规响应 | 51,137,552 B | 96,427 B |
| 50,000 条结算历史，单次库存互动 | 27.308 ms | 0.203 ms |
| 同上压力过程中最大定时器额外延迟 | 100.855 ms | 0.529 ms |

定时器观测包含 GC/系统调度噪声；数据库测试含 worker 往返与事务提交，未计一次性迁移。进展更新取五次中位数，库存优化前五次、优化后七次；冷读与响应序列化是单次样本。文件系统缓存、正文分布和设备会影响绝对耗时。尤其不能以这些数字宣称真实模型吞吐提高几千倍。

回归覆盖：两独立进程并发结算、旧账本迁移/回滚/备份、重复收据、规则改变、继承用量、跨轮次 PTC、延迟响应取消、共享读取、总截止时间、慢轮询与卸载、增量计价替换及大子代理响应预算。Node 22.13.1 的性能与边界测试通过。浏览器人工检查了中英俄切换、任务/工具详情、桌面与 390px 窄屏；这不替代真实 DSH 模型 A/B 或浏览器长任务基准。

## English summary

The default plugin does not add prompt content, make model calls, or proxy tokens. Progress and accounting now use incremental indexes; result details load on demand. Inventory is stored transactionally in SQLite on a worker, using Node 22.13+ with no third-party runtime dependency. Existing JSON is migrated atomically and retained as a backup. Multiple same-machine processes can share one local inventory directory. Old and new storage writers must not be mixed.

Polling is single-flight and cancellable; history reads share a concurrency limit and total budgets. The current locale and task details load on demand, and static resources revalidate with ETags. The measurements above are synthetic local results, not real model throughput guarantees. Cold history reads, one worker, animation decoding and persistent indexes still carry costs.

Random loot uses binomial counts for successes, bundle sizes and item types rather than iterating once per earned chance. The beta subdivision follows the order-statistic construction in [Devroye, Chapter X §4.5](https://luc.devroye.org/chapter_ten.pdf). Gamma proposals use the shape-greater-than-one method also documented in [NumPy's distribution implementation](https://github.com/numpy/numpy/blob/main/numpy/random/src/distributions/distributions.c). Tests check small and large sample means/variances and bound random calls for a billion-chance batch. Inventory writes remain serialized and unsuccessful rolls are persisted to prevent replay.

## 动画扩展的体积说明

2026-09-13 场景扩展后共有 130 段 WebM，视频合计约 69.03 MB（新增 80 段约 41.95 MB）。新增素材统一为 360×360 方形像素 VP9 alpha，最大单文件约 826 KB。

安装/更新传输体积会增加。播放仍为两个 video 缓冲交替，不预加载整个素材库；日历按天缓存，动作选择只在已有空闲调度节点运行，冷却记录按固定场景键保存，去重历史上限为 8。鼠标回应使用人物元素上的进入/离开事件和一次性计时器，没有全局 pointermove 或持续 requestAnimationFrame 循环。没有新增模型、天气或余额请求。

现有合成视频不含眼睛独立图层，本次没有添加逐帧眼部识别或独立瞳孔渲染。上述实现约束不能替代真实模型 tokens/s 的 A/B 测量；未声称安装后生成速度绝对不变。
