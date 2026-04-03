# 壓縮策略 — Layer 2 詳細層

## 五級漸進退化管線

| 策略 | 成本 | 機制 |
|------|------|------|
| MicroCompact | 零 API | 從伺服器快取移除訊息，不破壞 prompt cache |
| AutoCompact | 1 次 API | 觸發：上下文視窗 - 13K buffer，產出 ≤ 20K 摘要 |
| Full Compact | 1 次 API | 壓縮整個對話，重設 50K token 工作預算 |
| Session Memory | 零 API | 使用預先萃取的會話記憶作為摘要 |
| FILE_UNCHANGED_STUB | 零 | 對重讀未修改檔案回傳 30 字簡述 |

## AutoCompact 斷路器

- MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3
- 連續失敗 3 次 → 停止壓縮
- 壓縮後重注入：最近 5 個存取檔案、活動計畫、相關 skill schema

## 關鍵原則

被壓縮的永遠是對話歷史，不是系統提示。
