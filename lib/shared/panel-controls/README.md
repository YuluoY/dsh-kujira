# Panel controls

## 元信息

| 字段 | 值 |
|---|---|
| 组件名 | Panel controls |
| 版本 | v1.4.0 |
| 框架 | React 18 |
| 状态 | 已集成，浏览器验收 |
| 入口路径 | ../panel-controls.js |
| 依赖 | 宿主 React、浏览器 Popover API、本地 i18next / Intl |
| 组件层次 | 原子层 Select / SearchSelect / NumberField / Range / TooltipHost |
| 风格兼容性 | 中性浅色与深色；全部消费语义 Token |

## 是什么

桌宠信息面板共用的选择器、数字步进输入、提示层与浮层轮廓计算。业务状态由调用方管理。

## 快速上手

```js
import { createControls } from './panel-controls.js';
const { Select } = createControls(React);
React.createElement(Select, { label: '主题', value: theme,
  options: [['light', '浅色'], ['dark', '深色']], onChange: setTheme });
```

## API 参考

### Props

SearchSelect 是单个可编辑下拉控件。初始 value 为空，不自动提交首项；输入仅过滤，点击候选或 Enter 明确确认后提交。清除回调空字符串；Tab、Escape、加载和外部 value 更新都不提交。支持 IME 组合输入。下拉使用 Popover top layer 避免面板 overflow 裁切。


| 名称 | 适用 | 说明 |
|---|---|---|
| label | Select / SearchSelect / NumberField | 必填，可访问名称 |
| value | Select / SearchSelect / NumberField | 当前受控值 |
| options | Select / SearchSelect | `[value, label][]`，保留数字值类型 |
| onChange | Select / SearchSelect / NumberField | 提交后回调新值 |
| disabled | Select / NumberField | 禁止交互，默认 false |
| loading | Select | 显示加载文案并禁用，默认 false |
| error | Select | 错误文案、aria-invalid 和描述关联 |
| min / step | NumberField | 下界与增量，默认 0 / 1 |
| rootRef | TooltipHost | 提示委托范围 |
| kind / label | Skeleton | balance/weather/growth/settings 形态及加载状态说明 |
| label / labelNode / value / min / max / unit / onChange | Range | 可访问标签、可选帮助标签、受控数值、范围、单位与回调 |

### Emits / Events

| 名称 | 参数 | 时机 |
|---|---|---|
| onChange | 新值 | 选项提交、有效数字编辑、步进或失焦确认 |

### Slots

| 名称 | 说明 |
|---|---|
| 无 | 选项来自 options；图标由组件内部提供 |

### Methods

| 名称 | 说明 |
|---|---|
| createControls(React) | 返回 Select、NumberField、TooltipHost |
| floatingPosition(anchor, size, viewport, gap) | 下拉翻转、限宽、可滚动高度 |
| beginRefresh(previous) / finishRefresh(previous, result) | 保留成功内容的刷新状态转换 |
| bubbleOutline(width, height, anchorY, pointer, diagonal) | 气泡主体与指向口的连续 SVG 路径 |

## 四态说明

- Loading：Select 显示加载文案并禁用。Tooltip 与 NumberField 不取异步数据。
- Error：Select 关联可读错误文案。数字编辑忽略不可解析的中间值，失焦恢复有效值。
- Empty：空 options 显示“暂无可选项”并禁用。
- Success：选中勾、悬浮、键盘高亮、焦点、关闭与禁用态均有独立处理。

## 使用示例

设置中的主题与动画、同步设置中的检查间隔共用 Select；会话预算共用 NumberField；桌宠与费用面板共用 TooltipHost。

## 设计决策

列表和提示使用浏览器 top layer，避免被面板滚动区裁切。数据仍保持 React 受控，菜单仅管理展开与游标状态。手风琴使用每个实例独立的 details name，并对旧浏览器提供 onToggle 互斥关闭。

本项目为零构建 ESM，保留平级 `.js` 路由白名单入口；不引入仅为了目录模板而存在的 TypeScript 编译或重复实现。文档与组件同目录前缀存放。

## 可访问性

Select 采用 select-only combobox：方向键、Home/End、Enter/Space、字符定位、Tab、Escape；焦点保持在触发器，以 aria-activedescendant 表达活动选项。Escape 仅先关闭列表；外部点击不提交。Tooltip 支持悬浮与键盘焦点，通过 aria-describedby 关联。

### 国际化

控件文案、ARIA 标签、选项与提示通过统一 i18next 字典渲染，选项 value 和输入值保持原始语义。NumberField 使用支持地区小数分隔符的 spinbutton，键盘上下键即时更新；Range 的输出和提示按地区格式化。语言切换不重建控件身份，跟随系统时响应 languagechange。

## 变更记录

### v1.4.0 (2026-09-13)

新增 SearchSelect。清空和筛选与选项提交分离；空选项、禁用、加载、错误状态完整；保留 Select 的旧 API。


### v1.3.0 (2026-09-11)

新增可复用骨架；面板固定外框与头部，设置操作区独立于滚动内容。标签提示改为跟随文字右上角。

### v1.1.0 (2026-09-11)

新增单行 Range、实时 thumb 提示、短气泡轮廓和保留内容的刷新状态处理；修正数字控件统一尺寸。

### v1.0.0 (2026-09-11)

新增组件化列表、提示与数字步进；统一说话与功能气泡轮廓。
