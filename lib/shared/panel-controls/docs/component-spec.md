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
