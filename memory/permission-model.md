# 權限模型 — Layer 2 詳細層

## 四層安全縱深

1. **tree-sitter AST 解析**：語義級理解 Shell 指令
2. **正則表達式驗證器**：後備檢查
3. **權限規則執行**：allowlist / asklist / denylist + ML 分類器
4. **OS 層級沙箱**：seatbelt (macOS) / bubblewrap (Linux)

## 權限等級

| 等級 | 說明 | 範例 |
|------|------|------|
| readonly | 唯讀操作 | FileRead, Glob, Grep |
| write | 寫入操作 | FileEdit, FileWrite |
| dangerous | 危險操作 | Bash (部分指令) |

## Fail-Closed 原則

- 分類器不可用 → 預設拒絕
- 連續拒絕 3 次 → 強制人工介入
- 子智能體無法自行批准高風險操作
