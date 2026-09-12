# 动画覆盖 / Animation coverage

全部 50 个素材均有实际播放入口。静态陪伴、系统减少动态效果、后台标签页会抑制动画。覆盖表表示可触发路径，不表示每次都会播放全部素材。

All 50 clips have a playback route. Reduced motion, focus mode and hidden tabs suppress playback. Probabilistic and context-specific clips do not run on every interaction.

| 场景 / Context | 触发 / Trigger | 素材 / Clips |
|---|---|---|
| idle | 随机安静待机 / quiet idle | 待机呼吸休闲、东张西望、悠闲哼歌、原地小憩沉眠、睡眼惺忪、空白举牌 |
| action | 空闲小动作 / idle gestures | 超大伸懒腰、哈欠连天、喝奶茶、原地专心玩魔方、原地敲击桌面互动、原地重力下蹲压缩、原地蹲下玩玩具汽车、鲸鱼吐泡泡特效、女仆屈膝礼仪、被吓一跳（炸毛）、原地跳跃抓碎头顶物品、小幅度原地 360 度旋转展示、偷吃零食被抓住、打喷嚏、用鲸鱼尾巴拍打地面、打瞌睡被惊醒、偷吃Token、举牌不是大肥鱼、原地漂浮踏步、迷糊犯困 |
| long | 低频空闲动作 / rare idle | 玩游戏气急败坏、闲得无聊打游戏、女仆扫除、螃蟹走路、吃盒饭 |
| click | 点击与摸头 / click and pat | 点击回应 - 开心跃动、点击回应 - 害羞惊讶、点击回应 - 傲娇生气（侧身展示） |
| sleep | 23:00–06:00 空闲时，20% 概率进入三段睡眠 / nighttime idle sequence | 睡觉第一段、睡觉第二段、睡觉第三段 |
| workBreak | 连续工作至少 3 分钟，最多每 3 分钟一次；摸鱼→被抓→认真工作 / playful long-work interlude | 工作摸鱼、摸鱼被抓、认真工作 |
| thinking | 真实任务状态 / public task state | 工作思考 |
| working | 真实任务状态 / public task state | 认真工作 |
| result | 真实任务状态 / public task state | 工作思考 |
| waiting | 真实任务状态 / public task state | 工作被打扰、看表叹气 |
| success | 真实任务状态 / public task state | 工作结束 |
| error | 真实任务状态 / public task state | 长时间工作看表 |
| 启动 / Startup | 首次配置加载 / first load | 待机呼吸休闲 |
| 拖拽 / Drag | 超过点击阈值 / drag threshold | 被鼠标拖拽悬空反馈 |
| 查看数据 / Open panels | 空闲时打开天气或余额 / open weather or balance while idle | 看天气、翻钱包 |
| 喂食 / Feed | 库存消费成功或免费模式 / inventory accepted or free mode | 吃小鱼干 |
| 状态过渡 / Enter state | 开始工作、结束工作 / work transitions | 开始工作、工作结束 |

工作状态优先于睡眠和空闲链；用户拖动或需要确认、错误等紧急状态会取消旧动画序列；短暂反馈完整播放后回到最新任务状态。所有影片通过双 video 缓冲交替，避免黑帧。未对 WebM 瞳孔进行独立变形，因此不声称支持眼睛追踪鼠标。

Task state takes priority over idle and sleep sequences. Dragging and urgent states cancel stale sequences; other reactions finish before returning to the latest task state. Two video buffers avoid a blank frame between clips. The supplied WebM clips do not support independent pupil tracking.

## 功能与启动反馈 / Feature and startup reactions

`ui.featureAnimations` configures first-session eating (`偷吃Token`) and the default menu actions. Feed hover combines the eating clip with a separate SVG drool overlay; wallet and weather use `翻钱包` and `看天气`. Hover waits for a deliberate dwell and observes cooldowns. Reactions play to their natural end, with a 320 ms crossfade. A pending hover is replaced by the latest one and discarded when the pointer leaves. Peak rewards use `ui.featureAnimations.reward` (`点击回应 - 开心跃动`) with bounded SVG fish scatter and drool. Inventory gains use SVG symbols shared with the growth panel.

## 情境回应 / Context reactions

| 条件 / Condition | 反馈 / Reaction |
|---|---|
| 打开余额，低于 CNY 10 / USD 2（含零） | 翻钱包；零钱回应 / wallet gesture |
| 打开余额，至少 CNY 100 / USD 20 | 开心跃动 / happy jump |
| 已观察到本轮执行，30 秒内完成 | 开心跃动；不重播历史完成 / quick completion |
| 当前页面累计观察执行 10 分钟 | 喝奶茶；每轮一次 / long-work companionship |
| 已观察到本轮执行，至少 10 分钟后完成 | 超大伸懒腰 / stretch after long completion |
| 无结束记录的空闲状态，每 10 分钟以 35% 概率 | 鲸鱼吐泡泡特效 / occasional idle bubbles |

情境回应共享 2 分钟冷却，余额同一档位不因刷新重播。暂停、后台与专注时间不累计为执行时间。等待输入、错误、暂停状态抑制反馈，排队动作播放前重新检查当前状态。用户主动动作优先；“情境回应”开关也控制工作摸鱼序列。余额档位只用于动画，不是理财建议，也不改变库存或记账。

Context reactions share a two-minute cooldown. Repeated balance refreshes in the same band do not replay them. Paused, hidden and focus time does not count as observed execution. Waiting, error and paused states suppress reactions; queued clips recheck the current state before playback. Deliberate interactions take priority. The setting also controls playful work-break sequences. Balance bands are decorative and do not alter inventory or accounting.
