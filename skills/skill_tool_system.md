# SKILL: 工具系統架構 (Tool System)

> 觸發條件：當討論工具設計、MCP 整合或工具擴展時

## 統一工具介面（47 欄位）

```typescript
interface Tool {
  name: string;
  description: string;        // 動態描述，供 LLM 理解用途
  inputSchema: ZodSchema;     // Zod 定義的輸入驗證
  permissionLevel: PermLevel; // readonly | write | dangerous
  shouldDefer: boolean;       // 延遲載入（漸進式發現）
  isParallelizable: boolean;  // 可否並行
  execute(input): Promise<ToolResult>;
  // 四層渲染：使用中、進度、結果、錯誤
}
```

**核心分離原則：「模型決定嘗試什麼，工具系統決定允許什麼」**

- LLM 不知道自己會被阻擋，只管提出最佳行動
- Permission 層獨立判斷是否放行
- 兩者之間零耦合

## 工具分類與依賴關係

```
                    ┌─── BashTool ←── bashSecurity.ts (tree-sitter AST)
                    │
                    ├─── FileReadTool ──→ [唯讀，可並行]
                    ├─── FileEditTool ──→ [寫入，序列化]
                    ├─── FileWriteTool ─→ [寫入，序列化]
                    │
Core Tool Router ───├─── GlobTool ─────→ [唯讀，可並行，結構化結果]
                    ├─── GrepTool ─────→ [唯讀，可並行，結構化結果]
                    │
                    ├─── WebFetchTool ─→ [網路，需權限]
                    ├─── WebSearchTool → [網路，需權限]
                    │
                    ├─── AgentTool ────→ [子智能體生成器]
                    ├─── MCPTool ──────→ [動態 MCP 封裝]
                    ├─── LSPTool ──────→ [9 種操作]
                    ├─── ToolSearchTool → [漸進式工具發現]
                    └─── TodoRead/WriteTool → [任務追蹤]
```

## 工具間零共享狀態

```
BashTool ─────X────→ FileEditTool     ← 沒有直接呼叫
     ↓                    ↓
  [stdout]            [file diff]
     ↓                    ↓
  ──→ 注入對話歷史 ←──────┘
          ↓
     LLM 下一輪推理（決定下一步）
```

所有工具間的「協作」完全通過 **LLM 推理迴圈** 中介，確保每個決策點都可追溯。

## 讀寫並行策略

```
唯讀操作（FileRead, Glob, Grep）
    → 可並行（最多 10 個同時進行）
    → 不需互斥鎖

寫入操作（FileEdit, FileWrite, Bash）
    → 嚴格序列化
    → 前一個完成才執行下一個

串流工具執行器：
    → 模型仍在生成回應時就開始執行已完成的工具呼叫
```

## MCP 整合：動態工具擴展

```
┌──────────────┐     stdio/SSE      ┌──────────────────┐
│  Claude Code │ ◄──────────────── │  MCP Server       │
│  (MCP Client)│ ────────────────► │  (外部工具提供者)   │
└──────────────┘                   └──────────────────┘

每個 MCP 工具 → 一個 MCPTool 實例
- 繼承統一 Tool 介面
- 套用相同 Permission 機制
- Schema 由 MCP Server 動態提供
- 前綴 mcp__server__toolname
- 8 個組態範圍（local → enterprise → dynamic）
- 預設延遲載入（僅名稱消耗上下文）
```

**延遲載入設計**：約 18 個工具標記為 `shouldDefer: true`，隱藏直到模型透過 `ToolSearchTool` 明確搜尋。單一 MCP 伺服器可包含 345 個工具，光定義就消耗 ~30,000 token。

## Agent Skills：程序性知識層

```
Skills = 「如何使用工具」的程序性記憶（而非僅是「有什麼工具」）

SKILL.md 檔案 → 注入領域專用指令的專門提示模板
├── 漸進式揭露：分階段按需載入
├── 重型依賴延遲載入
├── 108 個功能閘控模組透過 Bun 編譯時死碼消除
└── 所有匯入都是動態的
```

## 工具結果預算控制

| 工具 | 輸出上限 |
|------|---------|
| BashTool | 30,000 字元 |
| GrepTool | 20,000 字元 |
| 超大結果 | 持久化至 `~/.claude/tool-results/{uuid}/output.txt`，僅預覽進入上下文 |
