# 时间存储与展示约定 (Time Display Convention)

本文档规范大姨子面板 (Dayizi Panel) 在后端数据库存储、接口数据交互以及前端页面展示中的时间时区标准。

---

## 1. 数据库存储规范

- **统一标准**：数据库（SQLite）中所有时间字段统一以 **UTC 时间** 存储。
- **存储格式**：标准字符串格式 `YYYY-MM-DD HH:mm:ss`（如 `2026-07-19 14:30:00`）。
- **原则**：禁止在数据库中直接存储带本地时区偏移的字符串，保证数据跨时区迁移与计算的一致性。

---

## 2. 接口与前端展示规范

- **默认展示时区**：前端与视图统一使用 **北京时间 (`Asia/Shanghai` / UTC+8)** 展示。
- **字段命名约定**：
  - 后端在 API 或 EJS 渲染上下文返回时间时，统一提供已按 `Asia/Shanghai` 格式化好的展示字段。
  - 命名后缀约定为：
    - `*_display`：显示年月日及时分（如 `2026-07-19 22:30`）。
    - `*_display_sec`：显示年月日及时分秒（如 `2026-07-19 22:30:00`）。
    - `*_date_display`：仅显示日期（如 `2026-07-19`）。
- **前端规范**：前端页面优先使用后端提供的 `*_display` 格式化字段直接渲染，避免前端 JS 因客户端本地时区差异导致显示错乱。

---

## 3. 后端统一时间工具库

后端统一调用工具模块 [src/utils/time.js](file:///root/panel/src/utils/time.js) 进行时间处理与格式转换：

```javascript
const { formatBeijingTime, getUtcTimestamp } = require('../utils/time');

// 将 UTC 字符串格式化为北京时间展示字符串
const displayTime = formatBeijingTime(dbRecord.created_at);
```
