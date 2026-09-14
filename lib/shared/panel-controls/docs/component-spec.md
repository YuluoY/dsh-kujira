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

思考气泡保持两个圆泡和一个主体，共三个图形，入场延迟 0/160/360ms、文字延迟 660ms，退出反向 340ms。主泡沿用用户参考图的多瓣 SVG 云朵，尾泡为正圆；颜色集中在 surface-tokens.css 的独立思考泡 token。垂直尾迹预留 63px，侧向预留 70px，减少动态效果时直接显示内容。

视频保留导出素材的原始大小，取消 26 段宽幅片段的放大补偿，优先保证清晰度。动画间原有大小差异保留。`animationAnchors` 只给气泡提供人物位置，不改变视频 transform。动作开始时更新一次气泡位置，拖拽与视口变化沿用已有布局回调，不增加逐帧测量。

主泡保留多瓣云朵 SVG，改用人物的蓝紫色系：浅蓝紫底、靛蓝描边、深蓝字，两颗尾泡由浅到深。主泡随映射后人物宽度 0.74 联动，限制 144–208px；尾泡 28/18px。未受视口限制的上/下布局中，圆泡间及小泡到估算头部各保留 8px。整体考虑面部碰撞与屏幕边界。预览删除旧缩放对比，全部动作使用原始大小。

纠偏记录：用户要求清晰度优先于动作尺寸一致，禁止再次对低分辨率片段添加放大补偿；云朵用色跟随人物而非参考图的薄荷绿。保留小圆泡、中圆泡、主云朵依次冒出的动效。

## 分类设置与文本输入（2026-09-13）

用户反馈：设置折叠层级过多，字段和按钮没有统一对齐。改为外观、互动、桌面、服务四个页签，分类内部使用静态 section 标题，保留单一滚动区域和固定页签/页脚。只挂载当前分类，避免未打开的服务设置持续请求。

参考 [Radix Tabs](https://www.radix-ui.com/themes/docs/components/tabs)、[Radix Text Field](https://www.radix-ui.com/themes/docs/components/text-field)、[Ant Design Form](https://ant.design/components/form-cn/) 的交互和布局原则。继续复用本地组件库及宿主 React，不引入第二套样式运行时。

TextField 为原子组件：label/value/onChange/onCommit/placeholder/help/error/disabled/loading/readOnly/clearable/type/maxLength/action/hideLabel。onChange 只更新草稿；失焦提交，Enter 触发失焦，IME 中 Enter 不提交；不会在挂载时保存。action 是尾部按钮的 label/icon/onClick。label 与 input ID 关联，错误通过 aria-invalid 和 aria-describedby 定位。Loading 禁用输入；Error 保留草稿并在字段下显示；Empty 保留占位；Success 正常编辑或只读复制。

SettingsTabs 接受 items（id/label/render），提供 tablist/tab/tabpanel 语义，左右箭头、Home/End 切换并移动焦点。render 只执行当前分类。SettingsSection 负责分组标题和内容，不增加折叠。

尺寸：32px 控件高、7px 圆角；普通行共用 144px 控件列，列间 12px，组内 8px，分组间 20px；长地址与文件路径采用标签在上的整行 TextField。字段内 label/control gap 6px，动作组间 gap 8px。所有颜色引用既有主题 token；浅色/深色均沿用相同布局。

测试覆盖输入法不误提交、失焦提交一次、字段错误关联、加载/只读状态、分类按需挂载与键盘导航。布局以浏览器和本机桌面应用实际检查为准。

边框与说明跟进：TextField、NumberField 内部 input 清除旧通用样式的内阴影；外层只保留 1px 边框，focus 使用统一 2px 柔和 halo，不再叠加 input 的独立描边。称呼和下拉控件采用同一焦点规则。错误状态使用语义错误色；禁用状态不触发 hover 强调。

TextField 的 help 改为标签右上角问号，复用 HelpLabel / TooltipHost 的悬停、键盘聚焦和点击提示；正常说明不占正文高度，错误仍在输入框下方显示。HelpLabel 新增可选 htmlFor，标签文字与 input 关联，问号按钮作为 label 的同级元素，避免把按钮嵌进 label。输入通过 visually-hidden 说明保留 aria-describedby。桌面配置补充显示位置、穿透、启动、节能、连接与程序路径的四语言说明。
