# 时间显示约定

## 存储

- 数据库统一存 UTC，格式 `YYYY-MM-DD HH:mm:ss`
- 不在数据库里存本地时区字符串

## 展示

- 默认展示时区：`Asia/Shanghai`
- 后端返回格式化字段，后缀 `*_display` / `*_display_sec` / `*_date_display`
- 前端优先使用后端格式化好的字段，不自行处理 UTC 字符串

## 工具

- 后端统一使用 `src/utils/time.js`
- 新接口同时提供原始值和展示值
