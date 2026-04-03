# SKILL: QueryEngine 迴圈與五步預處理 (Agentic Loop)

> 觸發條件：當討論 Agent 執行效率與自動壓縮時

## QueryEngine 核心迴圈

```
User Input
    ↓
[System Prompt Assembly]  ← 動態組裝：base prompt + memory + tools schema + context
    ↓
[Five-Step Pre-Processing] ← Snip → MicroCompact → ContextCollapse → AutoCompact → Assemble
    ↓
[LLM API Call]            ← 串流推理、token 追蹤、cost 計算
    ↓
[Response Parse]          ← 識別 tool_use block vs text block
    ↓
[Tool Dispatch]           ← 路由至具體 Tool 模組
    ↓
[Permission Gate]         ← 多階段權限檢查
    ↓
[Tool Execution]          ← 實際執行，收集 output
    ↓
[Result Injection]        ← 將 tool result 注入對話歷史
    ↓
[Loop or Respond]         ← 決定繼續推理還是回覆用戶
    ↓
[Budget Guard]            ← token 預算延續 + 模型降級
```

## 五步預處理管線

每次 API 呼叫前執行：

| 步驟 | 名稱 | 功能 | 成本 |
|------|------|------|------|
| 1 | Snip | 移除舊工具回傳結果 | 零 |
| 2 | MicroCompact | 零 API 呼叫的本地快取編輯 | 零 |
| 3 | ContextCollapse | 摺疊上下文（處理 HTTP 413） | 零 |
| 4 | AutoCompact | 接近上限時觸發壓縮 | 1 次 API |
| 5 | Assemble | 最終請求組裝 | 零 |

## AutoCompact 斷路器

```
MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3

觸發條件：上下文視窗 - 13,000 token 緩衝區
產出：≤ 20,000 token 的結構化摘要
連續失敗 3 次 → 停止壓縮，防止無限迴圈
```

## 工具結果預算控制

| 工具 | 輸出上限 |
|------|---------|
| BashTool | 30,000 字元 |
| GrepTool | 20,000 字元 |
| 超大結果 | 持久化至檔案，僅預覽進入上下文 |

## 關鍵設計決策

1. **單一迴圈，非遞迴** — while(true)，避免 stack overflow
2. **串流優先** — AsyncGenerator 管線逐 token 處理
3. **成本感知** — 每次迭代計算 token 消耗與美元成本
4. **背壓控制** — 每層只在消費者準備好時才產生下一個值
5. **取消友好** — AsyncGenerator.return() 可乾淨中斷整條管線

## 讀寫並行策略

```
唯讀操作（FileRead, Glob, Grep）→ 可並行（最多 10 個同時）
寫入操作（FileEdit, FileWrite, Bash）→ 嚴格序列化
串流工具執行器 → 模型仍在生成時就開始執行已完成的工具呼叫
```
