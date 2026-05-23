# 页面间距平衡、导出按钮强化与内心天气卡片重构计划

为了提升 MindSpace 的视觉品质，解决页面顶部紧贴、内心天气排版不一致以及导出按钮边框虚化的问题，我们规划了以下优化方案：

## Proposed Changes

---

### [Component 1] 全局页面间距与导出按钮样式

#### [MODIFY] [css/style.css](file:///D:/Docs/gemini_cli/mindspace/css/style.css)
1. **平衡各页面顶部边距**：
   - 增加 `#app-content` 在各屏幕尺寸下的 padding，提供更匀称的上下对称感（呼吸感）。
   - **移动端**：从原来的 `padding: 20px 24px;` 调整为 `padding: 28px 24px 24px 24px;`。
   - **平板端** (min-width: 768px)：从原来的 `padding: 40px 48px;` 调整为 `padding: 36px 48px 24px 48px;`。
   - **桌面端** (min-width: 1024px)：从原来的 `padding: 16px 36px;` 调整为 `padding: 32px 36px 24px 36px;`（使顶部留白增倍，避免文字贴顶，与底部高度呼应）。
2. **强化“导出随笔”按钮边框颜色**：
   - 在 `.settings-actions .secondary-btn` 中，将静止态下过于虚弱的 `border: 1px solid var(--card-border);` 进行加深：
     - **浅色主题**：使用 `border: 1px solid rgba(0, 0, 0, 0.16);`（提升对比度）。
     - **深色主题**：使用 `border-color: rgba(255, 255, 255, 0.24);`。
3. **补充内心天气容器的基础样式**：
   - 增加基础样式，使移动端的 `.weather-pane-left` 和 `.weather-pane-right` 默认作为 flex 列排版，使移动端和桌面端逻辑更为统一。

---

### [Component 2] “内心天气”页面结构重构

为了将“内心天气”与“正念呼吸舱”、“数据与安全”等页面统一为精致的左右（或上下）对称卡片框体，我们将去除琐碎的“嵌套卡片”设计，将左/右半栏分别作为完整的卡片。

#### [MODIFY] [index.html](file:///D:/Docs/gemini_cli/mindspace/index.html)
1. **左栏卡片化**：
   - 给 `<div class="weather-pane-left">` 添加 `card` 类，使其包装在一个优雅的磨砂玻璃框体中。
   - 在卡片顶部添加 `<h3>选择内心天气</h3>`，作为选择区域的标准标题。
   - 移除原 `.tags-container` 的 `card` 类，并添加一个上方分割线样式（`style="border-top: 1px solid var(--card-border); padding-top: 16px; margin-top: 8px;"`），使其作为左侧大卡片内的一个清晰分区。
2. **右栏卡片化**：
   - 给 `<div class="weather-pane-right">` 添加 `card` 类，让右栏整体包装为一个框体。
   - 将原 `.diary-input-container` 的 `card` 类移除，并将里面的标题 `<h3>内心絮语 (可选)</h3>` 提取为右侧大卡片的直接子元素。
   - 将 `.action-bar`（包含“记在心空”按钮）移动到 `.weather-pane-right` 容器内部的底端，利用 `margin-top: auto; padding-top: 12px;` 属性，使其在桌面端自动对齐到右侧大卡片的底部，展现极致的细节严谨度。

## Verification Plan

### Manual Verification
1. **页面顶部间距走查**：
   - 切换各个页面（看板、呼吸舱、专注舱、随笔、气象图、数据安全），确认页面内容不再紧贴顶部边缘，上下空间分布匀称。
2. **导出随笔按钮边框对比**：
   - 进入“数据与安全”页面，对比“导出并下载我的心声随笔 (.md)”按钮与其他按钮。静态下其灰色边框应清晰可见，不再因太浅而融入背景。
3. **内心天气重构效果验证**：
   - 确认整个内心天气页面呈现出两个平齐的卡片（左边为天气选择与标签，右边为随笔输入框与保存按钮）。
   - 切换天气时，底层的动态渐变色应能透过半透明的磨砂卡片折射出来，实现极具质感的视觉联动。
   - 检查在移动端（手机尺寸）和桌面端下，卡片的排列与高度对齐是否完全正常，有无溢出或变形。
