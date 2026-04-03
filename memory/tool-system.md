# 工具系統架構 — Layer 2 詳細層

## 統一工具介面（47 欄位）

核心分離原則：「模型決定嘗試什麼，工具系統決定允許什麼」

- LLM 不知道自己會被阻擋，只管提出最佳行動
- Permission 層獨立判斷是否放行
- 兩者之間零耦合

## 工具分類

### 唯讀工具（可並行，最多 10 個）
- FileReadTool
- GlobTool
- GrepTool

### 寫入工具（嚴格序列化）
- FileEditTool
- FileWriteTool
- BashTool

### 網路工具（需權限）
- WebFetchTool
- WebSearchTool

### 特殊工具
- AgentTool（子智能體生成器）
- MCPTool（動態 MCP 封裝）
- LSPTool（9 種操作）
- ToolSearchTool（漸進式工具發現）

## 工具間零共享狀態

所有工具間的協作完全通過 LLM 推理迴圈中介，確保每個決策點都可追溯。

## 延遲載入設計

約 18 個工具標記為 shouldDefer: true，隱藏直到模型透過 ToolSearchTool 明確搜尋。
