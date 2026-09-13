# Component spec

## 组件层次定位

Select、TooltipHost、NumberField 是原子控件；不读写偏好、不请求账户或同步接口。调用方处理存储、异步和业务限制。bubbleOutline 与 floatingPosition 为可测试纯函数。

## 输入输出

Select 的 label/value/options/onChange 必填；disabled/loading/error 可选。NumberField 的 label/value/onChange 必填，min/step 可选。TooltipHost 使用 rootRef 限定事件委托，通过 data-tooltip 读取文案。

## 知识缺口与调研

- [WAI-ARIA combobox](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/)：选择与键盘游标分开，Escape 取消，保留触发器焦点。
- [MDN Popover API](https://developer.mozilla.org/en-US/docs/Web/API/Popover_API/Using)：top layer 逃离 overflow 裁切；仍保留 DOM 父子关系，兼容现有外部点击判断。
- 当前素材为 130 段 WebM，无独立眼部图层。真实眼睛跟随需新增分层或可绑定模型，不以整个人物的移动替代。

## 样式架构

行为：../../panel-controls.js；视觉：../../../appearance.css 中的语义 Token 与结构规则；主题值分别由浅色、深色覆盖。保留零构建 JavaScript 工程约定，目录模板中的 index.ts/types.ts 改由运行时 ESM 入口与本文 API 契约承担。

## 状态与测试

Loading / Error / Empty / Success 均在 README 定义。浏览器验收选择提交、取消、互斥手风琴、提示、说话位置、控件失焦。纯函数测试覆盖贴底翻转、窄屏限宽、大菜单滚动空间与气泡边界尺寸。

## SearchSelect 扩展规格（2026-09-13）

原子层。输入 label/value/options/onChange、可选 disabled/loading/error；value 默认空字符串。输出仅来自用户确认不同值或显式清空。输入为检索文本，不作为任意视频路径执行；不在 mount/effect/blur/Tab 中提交。业务 AnimationMenu 只对有效、非空且不同的值调用播放器；组件内保持值用于再次清空，整页初始化为空，不读 localStorage。

实现沿用零构建 ESM：search-select.js 与 client 组件同级，统一由 createControls 暴露 SearchSelect；布局位置复用 floatingPosition，样式为 search-select.css。全部消费现有语义颜色，浅/深主题可用。输入焦点用外框 focus-within 边框和可见光圈，替代内层 input outline；该替代为明确的焦点样式设计，不取消焦点可见性。

Loading：禁用并显示正在读取；Error：aria-invalid、关联错误提示；Empty：展开后无匹配提示；Success：筛选/键盘/鼠标/清空。只挂载当前展开列表，130 项无需新依赖或视频缩略图预载。

单测覆盖挂载不播放、同值不重播、清空不播放、筛选不提交、无效值、禁用、IME、Enter、Escape、Tab。浏览器核对默认空值、搜索后才选中、再次打开不重播、点击清空与 top-layer 下拉位置。

## 模板检查适用性

validate_output.py 的 index.vue/ts/tsx 与 types.ts 两项仅适用于该目录模板；当前组件的真实 ESM 入口为 ../panel-controls.js，SearchSelect 为 ../client/search-select.js，输入输出类型由 JSDoc 和本规格表定义。保持现有零构建入口，不添加不被运行时消费的 TypeScript 占位文件。其余文档结构检查照常执行；运行时检查由 ESLint、tsc、单测与浏览器验证承担。

## 线上交互与尺寸纠偏（2026-09-13）

用户反馈要求以实际 DSH 验收，不能以开发预览代替。调研 [Reka UI Combobox](https://www.reka-ui.com/docs/components/combobox) 的输入、选中状态与键盘交互分离，以及 [Radix Popover](https://www.radix-ui.com/primitives/docs/components/popover) 的浮层外部交互边界。当前代码复用现有 Select 的触发器、选项、图标、主题 token，不额外引入框架依赖。

- SearchSelect 使用设置同款 144 × 32px 控件；窄面板按 52% 限宽。11px 字号、7px 圆角、12px 图标，清除按钮放在内部。通用输入框的 min-height 和父容器 padding 不再累加；实测已从 46px 回到 32px。选项复用 Select 的列表规则。
- 面板内输入框即使已有焦点，点击仍可展开；清空与 Escape 关闭后可再次点击。失焦、Tab 与初始化不提交动作。
- 原先全局 scroll 监听会把宿主对话区域的独立滚动当作关闭条件。现在仅祖先滚动/窗口变化重定位，列表保持打开；列表自身滚动不触发关闭。
- 播放请求被拒绝时不保存值，允许重选同一动作。明确手动点播立即取代环境动作并清理排队项；普通自动场景继续原有队列策略。清空、同值、挂载仍不播放。
- 浏览器验收必须在实际 DSH 完成：检索、滚动对话、选项仍在、点击后前景视频名称吻合；另检查桌面/窄屏尺寸与本地状态预览。

响应式校验提示 search-select.css 无独立断点属于跨文件组合：宽度使用 min(144px,52%)，列表断点定义在 form-controls.css，触发器按用户要求保持设置同款 32px；不为了消除提示额外增高移动端控件。

## 思考气泡与渲染平面（2026-09-13）

思考气泡保持两个圆泡和一个主体，共三个图形，入场延迟 0/160/360ms、文字延迟 660ms，退出反向 340ms。白底蓝线用 surface-tokens.css 的独立思考泡 token，避免暗色主题将它变成普通深色聊天框。布局预留 62px 尾迹，减少动态效果时直接显示内容。

视频视觉平面可根据导入时的缩小与留白进行逆变换，但交互平面保持原 stage 大小。变换只在切换视频时设置，不按帧测量 DOM 或像素。26 段配置均由滤镜推导并有坐标逆变换测试；普通素材与无效配置恢复 1/1/0，防止前后缓冲复用遗留样式。
