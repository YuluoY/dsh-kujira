# Component spec

## 组件层次定位

Select、TooltipHost、NumberField 是原子控件；不读写偏好、不请求账户或同步接口。调用方处理存储、异步和业务限制。bubbleOutline 与 floatingPosition 为可测试纯函数。

## 输入输出

Select 的 label/value/options/onChange 必填；disabled/loading/error 可选。NumberField 的 label/value/onChange 必填，min/step 可选。TooltipHost 使用 rootRef 限定事件委托，通过 data-tooltip 读取文案。

## 知识缺口与调研

- [WAI-ARIA combobox](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/)：选择与键盘游标分开，Escape 取消，保留触发器焦点。
- [MDN Popover API](https://developer.mozilla.org/en-US/docs/Web/API/Popover_API/Using)：top layer 逃离 overflow 裁切；仍保留 DOM 父子关系，兼容现有外部点击判断。
- 当前素材为 50 段 WebM，无独立眼部图层。真实眼睛跟随需新增分层或可绑定模型，不以整个人物的移动替代。

## 样式架构

行为：../../panel-controls.js；视觉：../../../appearance.css 中的语义 Token 与结构规则；主题值分别由浅色、深色覆盖。保留零构建 JavaScript 工程约定，目录模板中的 index.ts/types.ts 改由运行时 ESM 入口与本文 API 契约承担。

## 状态与测试

Loading / Error / Empty / Success 均在 README 定义。浏览器验收选择提交、取消、互斥手风琴、提示、说话位置、控件失焦。纯函数测试覆盖贴底翻转、窄屏限宽、大菜单滚动空间与气泡边界尺寸。
