# Agent 架構設計技術規格：以 Claude Code 為藍本的深度工程剖析

> **文件性質**：純軟體工程技術文件，聚焦架構模式、元件依賴、設計原理與構想推演  
> **分析基礎**：v2.1.88 原始碼（~512K 行 TypeScript，~1,900 檔案）  
> **整理日期**：2026/04/03（經多源交叉驗證修訂）

---

## 一、全局架構：Agent Runtime，非 Chat Wrapper

### 1.1 三層架構模型

```
┌─────────────────────────────────────────────────┐
│              Presentation Layer                  │
│   React + Ink 終端 UI / ASCII 渲染引擎          │
│   (Int32Array 字元池、bitmask 樣式、游標 patch)  │
├─────────────────────────────────────────────────┤
│              Orchestration Layer                 │
│   Agent Loop / QueryEngine / Context Manager    │
│   (推理迴圈、工具路由、壓縮策略、快取經濟學)      │
├─────────────────────────────────────────────────┤
│              Capability Layer                    │
│   40+ Tools / Permission System / Memory Stack  │
│   (工具模組、四層權限、三層記憶、子智能體)        │
└─────────────────────────────────────────────────┘
```

**核心認知**：LLM 僅占程式碼庫的 ~1.6%（直接呼叫 AI 模型的部分）；其餘 98.4% 是基礎設施——上下文管理、工具編排、權限控制、終端渲染與多代理協調。

### 1.2 技術堆疊與設計意圖

| 技術選擇 | 具體實現 | 設計意圖 |
|----------|---------|---------|
| **Bun**（非 Node.js） | 執行環境 + 原生 Zig HTTP 堆疊 | 冷啟動速度、原生二進位層可做 API 簽名（CCH DRM） |
| **React + Ink** | 終端 UI 框架（~140 元件） | 宣告式 UI = 狀態驅動渲染，複雜 TUI 不需手動管理游標 |
| **Zod v4** | 全量 Schema 驗證 | 工具輸入/輸出的 runtime type safety，與 TypeScript 型別推導一致 |
| **tree-sitter** | Shell AST 解析 | 安全層需語義級解析複合指令，正則無法處理巢狀/轉義 |
| **TypeScript** | 全量嚴格模式 | 大型 codebase 的型別安全 + IDE 支援 + 與 Zod 天然整合 |

### 1.3 檔案規模參考

| 檔案 | 行數 | 職責 |
|------|------|------|
| `QueryEngine.ts`（展開後） | ~46,000 | LLM 引擎：串流、工具迴圈、token、快取、重試、成本 |
| `Tool.ts` | ~29,000 | 所有工具類型與權限 schema（47 個欄位） |
| `commands.ts` | ~25,000 | ~85 個 Slash 指令註冊與執行 |
| `print.ts` | ~5,594 | 輸出格式化（含 3,167 行 / 12 層嵌套單一函數） |
| `bashSecurity.ts` | ~2,500 | Shell 安全：tree-sitter AST + 25+ 項驗證器 |
| `promptCacheBreakDetection.ts` | ~500+ | 14 種快取破壞向量追蹤 |
| `undercover.ts` | ~90 | 員工匿名模式 |

---

## 二、Orchestration Layer：推理迴圈的心臟

### 2.1 QueryEngine — AsyncGenerator 驅動的核心迴圈

`QueryEngine.ts` 是整個系統的中央協調器。核心類別定義約 1,295 行，展開含所有依賴的查詢系統約 46,000 行（bundled 模組）。

```
User Input
    ↓
[System Prompt Assembly]  ← 動態組裝：base prompt + memory + tools schema + context
    ↓                       六個內建代理角色各有不同組裝邏輯
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
    ↓                       （自動重試最多 3 次，注入不可見「繼續」指令）
[Budget Guard]            ← token 預算延續 + 模型降級
```

**關鍵設計決策**：

- **單一迴圈，非遞迴**：整個 agent loop 是 `while(true)` 迴圈，避免 stack overflow 且便於追蹤狀態
- **串流優先**：所有 LLM 回應都走 streaming，`AsyncGenerator` 管線逐 token 處理
- **成本感知**：每次迴圈迭代計算 token 消耗與美元成本，內建 budget guard
- **自我修復**：內建斷路器、token 預算延續、過載時模型降級、優雅關閉處理

### 2.2 AsyncGenerator Pipeline 架構

```
REPL → QueryEngine → queryLoop → API stream → retry
  ↑                                              ↓
  └──── Tool Result ← Tool Execution ← Permission ←┘
```

每一層都是 `AsyncGenerator`，使用 `yield` 逐層向上冒泡訊息：

- **背壓（backpressure）控制**：每層只在消費者準備好時才產生下一個值
- **中間件可插拔**：計量、日誌、安全檢查只需在管線中插入新 generator
- **取消友好**：`AsyncGenerator.return()` 可乾淨中斷整條管線
- **即時轉向**：h2A 異步雙緩衝佇列確保使用者中斷能快速傳播

### 2.3 系統提示詞的動態組裝

系統提示並非靜態文字。`getSystemPrompt()` 函數**每輪動態組裝數十個提示詞元件**：

```
System Prompt Assembly
├── 執行模式（REPL / Headless / Daemon）
├── 可用工具 Schema（按字母排序 → 穩定排序 → 高快取命中率）
├── 當前權限規則
├── Git 狀態（分支、最近 commit、工作樹狀態 ← 每次查詢重讀）
├── CLAUDE.md 四層層次結構
│   ├── /etc/claude-code/CLAUDE.md         ← 全域（企業管理員）
│   ├── ~/.claude/CLAUDE.md                ← 使用者級（個人偏好）
│   ├── <project>/CLAUDE.md                ← 專案級（團隊共識）
│   ├── <project>/.claude/rules/*.md       ← 專案規則（細粒度）
│   └── <project>/CLAUDE.local.md          ← 私人（不入版控的個人覆寫）
├── 載入的技能（Agent Skills）
├── 活躍的功能旗標
└── 代理角色專屬指令（6 種角色各有不同邏輯）
```

**設計理念**：借鑒 `.gitconfig` 的覆寫模式——全域設定提供基線，專案級提供專業化，`.local.md` 不入版控，解決「團隊規範 vs 個人偏好」的衝突。

---

## 三、Prompt Cache 經濟學：驅動架構決策的核心力量

### 3.1 經濟模型

```
標準輸入：$5.00 / M tokens
快取讀取：$0.50 / M tokens
                ↓
        每次快取破壞 = 10 倍成本增加
```

### 3.2 由快取經濟學衍生的架構決策

```
promptCacheBreakDetection.ts
├── 追蹤 14 種快取破壞向量
├── "sticky latches" 防止模式切換（Shift+Tab）破壞 70K 上下文快取
├── DANGEROUS_uncachedSystemPromptSection() ← 命名暗示：不快取 = 危險 = 燒錢
└── 系統提示分割：SYSTEM_PROMPT_DYNAMIC_BOUNDARY
    ├── 穩定前半段（base prompt + 工具定義）→ 積極快取
    └── 動態後半段（git 狀態、CLAUDE.md 內容）→ 每輪更新
```

**具體節省措施**：

| 優化 | 機制 | 節省量 |
|------|------|--------|
| 工具按字母排序 | 穩定排序 → 快取前綴不變 | 全域生效 |
| Explore/Plan 模式省略 CLAUDE.md | 減少動態區段 | 每週 ~5-15 Gtoken |
| 一次性代理跳過 agentId 尾部 | ~135 字元 × 34M/週 | 可觀 |
| 代理列表從工具描述移至附加訊息 | 減少 cache_creation | ~10.2% |
| 子代理重用父行程快取 | KV cache fork-join | Fork 模式幾乎零額外成本 |
| 壓縮時保持 system prompt 不變 | 只壓縮對話歷史 | 快取前綴永不破壞 |

**設計原則**：System prompt 的結構、壓縮策略的觸發點、fork 模式的選擇，都受 prompt cache 命中率的影響。**省錢 = 架構約束**。

---

## 四、上下文管理：五步預處理管線與多級壓縮策略

### 4.1 五步預處理管線（每次 API 呼叫前執行）

```
上下文使用量 →→→→→→→→→→→→→→→→→→→→ 接近上限

Step 1: Snip          移除舊工具回傳結果
Step 2: MicroCompact  零 API 呼叫的本地快取編輯（白名單 COMPACTABLE_TOOLS）
Step 3: ContextCollapse  摺疊上下文（處理 HTTP 413 過長提示）
Step 4: AutoCompact   接近上限時觸發（13K buffer，≤20K 摘要）
Step 5: Assemble      最終請求組裝
```

### 4.2 壓縮策略細節

**MicroCompact**（零成本）：
- 使用 `cache_edits` API 從伺服器快取中移除訊息
- 不破壞 prompt cache 的完整性
- MCP 工具、代理工具及自訂工具豁免

**AutoCompact**（帶斷路器）：
- 觸發條件：上下文視窗 - 13,000 token 緩衝區
- 產出：≤ 20,000 token 的結構化摘要
- 壓縮後重注入：最近 5 個存取檔案（每檔 ≤ 5K token）、活動計畫、相關 skill schema
- **斷路器**：`MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3`
  - 修復前：單一會話最嚴重案例有 3,272 次連續壓縮失敗
  - 修復後：每日全球節省 ~250,000 次 API 呼叫

**Full Compact**：
- 壓縮整個對話
- 重設 50,000 token 工作預算

**Session Memory**：
- 使用預先萃取的會話記憶作為摘要
- 零 API 成本

**FILE_UNCHANGED_STUB**：
- 對重讀未修改檔案回傳 30 字簡述

### 4.3 壓縮與快取的交互

```
壓縮前：
┌────────────────────────┬───────────────────────┐
│ System Prompt (cached) │ Conversation (dynamic) │
│ ████████████████████   │ ░░░░░░░░░░░░░░░░░░░░ │
└────────────────────────┴───────────────────────┘
                              ↑ 過長，觸發壓縮

壓縮後：
┌────────────────────────┬────────┐
│ System Prompt (cached) │Summary │ ← 對話被壓縮為摘要
│ ████████████████████   │ ░░░░░ │
└────────────────────────┴────────┘
                                    + 重注入最近檔案、計畫、schema

關鍵：被壓縮的永遠是對話歷史，不是系統提示
```

**工具結果預算控制**（上游截斷）：

| 工具 | 輸出上限 |
|------|---------|
| BashTool | 30,000 字元 |
| GrepTool | 20,000 字元 |
| 超大結果 | 持久化至 `~/.claude/tool-results/{uuid}/output.txt`，僅預覽進入上下文 |

---

## 五、Tool System：模組化的能力擴展架構

### 5.1 Tool 抽象模型

```typescript
// 統一工具介面（47 個欄位）
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

- LLM 不知道自己會被阻擋，它只管提出最佳行動
- Permission 層獨立判斷是否放行
- 兩者之間零耦合

### 5.2 工具分類與依賴關係圖

```
                    ┌─── BashTool ←── bashSecurity.ts (tree-sitter AST)
                    │                  └── 25+ 項安全驗證器
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
                    ├─── AgentTool ────→ [子智能體生成器] ←── §七
                    │
                    ├─── MCPTool ──────→ [動態 MCP 封裝] ←── §五.4
                    │
                    ├─── LSPTool ──────→ [9 種操作：goToDefinition, findReferences, hover...]
                    ├─── NotebookEditTool → [Jupyter]
                    ├─── MultiEditTool → [原子性多檔案編輯]
                    ├─── ToolSearchTool → [漸進式工具發現]
                    └─── TodoRead/WriteTool → [任務追蹤]
```

### 5.3 工具間零共享狀態

```
BashTool ─────X────→ FileEditTool     ← 沒有直接呼叫
     ↓                    ↓
  [stdout]            [file diff]
     ↓                    ↓
  ──→ 注入對話歷史 ←──────┘
          ↓
     LLM 下一輪推理（決定下一步）
```

所有工具間的「協作」完全通過 **LLM 推理迴圈** 中介。沒有工具直接呼叫另一個工具的路徑，確保每個決策點都可追溯。

### 5.4 讀寫操作的並行/序列化策略

```
唯讀操作（FileRead, Glob, Grep）
    → 可並行（最多 10 個同時進行）
    → 不需互斥鎖
    → 目的：加速探索階段

寫入操作（FileEdit, FileWrite, Bash）
    → 嚴格序列化
    → 前一個完成才執行下一個
    → 目的：避免競態條件、確保每步可回溯

串流工具執行器：
    → 模型仍在生成回應時就開始執行已完成的工具呼叫
```

### 5.5 MCP 整合：動態工具擴展

```
┌──────────────┐     stdio/SSE      ┌──────────────────┐
│  Claude Code │ ◄──────────────── │  MCP Server       │
│  (MCP Client)│ ────────────────► │  (外部工具提供者)   │
└──────┬───────┘                   └──────────────────┘
       │
       │  MCPTool 封裝
       ▼
┌──────────────────────────────────┐
│ 每個 MCP 工具 → 一個 MCPTool 實例 │
│ - 繼承統一 Tool 介面              │
│ - 套用相同 Permission 機制        │
│ - Schema 由 MCP Server 動態提供   │
│ - 前綴 mcp__server__toolname      │
│ - 8 個組態範圍（local → enterprise → dynamic）│
│ - 預設延遲載入（僅名稱消耗上下文） │
└──────────────────────────────────┘
```

**延遲載入設計**：約 18 個工具標記為 `shouldDefer: true`，隱藏直到模型透過 `ToolSearchTool` 明確搜尋。原因：單一 MCP 伺服器（如 Umbraco）可包含 345 個工具，光定義就消耗 ~30,000 token。

### 5.6 Agent Skills：程序性知識層

```
Skills = 「如何使用工具」的程序性記憶（而非僅是「有什麼工具」）

SKILL.md 檔案 → 注入領域專用指令的專門提示模板
├── 漸進式揭露：分階段按需載入
├── 重型依賴（OpenTelemetry, gRPC）延遲載入
├── 108 個功能閘控模組透過 Bun 編譯時死碼消除
└── 所有 cli.tsx 中的匯入都是動態的
```

---

## 六、Permission System：多階段安全閘控

### 6.1 四層安全縱深

```
Layer 1: tree-sitter AST 解析（主要閘門）
    ↓
Layer 2: 正則表達式驗證器（後備）
    ↓
Layer 3: 權限規則執行
    ├── allowlist / asklist / denylist
    └── ML 分類器（AI Classifier）
    ↓
Layer 4: OS 層級沙箱
    ├── macOS：seatbelt profiles
    ├── Linux：bubblewrap
    └── @anthropic-ai/sandbox-runtime
```

### 6.2 權限執行流程

```
                    Phase 1: Trust Bootstrap
                    ┌───────────────────────┐
                    │ 專案載入時：            │
                    │ - 讀取 CLAUDE.md       │
                    │ - 建立信任規則基線      │
                    │ - 載入 allow/deny 清單  │
                    └──────────┬────────────┘
                               ↓
                    Phase 2: Pre-Execution Check
                    ┌───────────────────────┐
                    │ 每次工具執行前：        │
                    │ - 匹配 permission level │
                    │ - 檢查 allow/deny 規則  │
                    │ - Auto 模式 → Phase 2b  │
                    └──────────┬────────────┘
                               ↓
                    Phase 2b: AI Classifier
                    ┌───────────────────────┐
                    │ 獨立 LLM 分類器：       │
                    │ - 非推理實例（隔離）     │
                    │ - 快速檢查 ~100ms       │
                    │ - 深度推理 ~1-2s        │
                    │ - 連續拒絕 3 次 → 人工   │
                    │ - Fail-closed 設計      │
                    └──────────┬────────────┘
                               ↓
                    Phase 3: User Confirmation
                    ┌───────────────────────┐
                    │ 高風險操作：             │
                    │ - 終端顯示操作預覽       │
                    │ - 等待用戶確認/拒絕      │
                    │ - 支援「本次全允許」      │
                    └───────────────────────┘

    權限決策管線：10+ 個檢查點
```

### 6.3 bashSecurity.ts 的精密防禦

```
Shell 指令字串
    ↓
[tree-sitter 解析為 AST]  ← 非正則！語義級理解
    ↓                       三個獨立解析器：
    │                       splitCommand_DEPRECATED / tryParseShellCommand / ParsedCommand.parse
    ↓
[遍歷 AST 節點]
    ↓
┌── 驗證器 1: 封鎖 18 個 Zsh 內建命令
├── 驗證器 2: 防禦 Zsh equals expansion（=curl 繞過）
├── 驗證器 3: Unicode 零寬空格注入偵測
├── 驗證器 4: IFS null-byte 注入偵測
├── 驗證器 5: HackerOne 格式錯誤 token 繞過
├── 驗證器 6: 封鎖 zmodload 及危險模組（sysopen, ztcp, zsocket）
├── 驗證器 7: Windows UNC 路徑安全（防 NTLM hash 洩漏）
├── ... (共 25+ 項，每個驗證器有數值 ID 供分析追蹤)
└── 驗證器 N: 複合指令分解（&& || ; | 的每段獨立評估）
    ↓
[Accept / Reject / Escalate]
```

**已知的設計限制**：
- 回傳 `allow` 的驗證器可繞過所有後續驗證器（歷史性弱點）
- 50+ 個子命令的管線命令完全繞過逐子命令分析

---

## 七、Multi-Agent 架構：三種執行模型與信箱通訊

### 7.1 三種子智能體模式

```
                          AgentTool
                             │
              ┌──────────────┼──────────────┐
              ↓              ↓              ↓
          Fork Mode     Teammate Mode   Worktree Mode
              │              │              │
              ↓              ↓              ↓
     複製父級上下文      獨立終端面板       獨立 git worktree
     命中 prompt 快取    信箱式通訊        隔離分支
     不可再 fork         可直接 P2P 通訊   全新上下文
     「幾乎零成本」平行  1M token 視窗     結果 ≤ 100K 字元
```

### 7.2 Fork Mode：KV Cache Fork-Join

```
┌─────────────┐
│ Coordinator │ ← 主智能體，擁有完整上下文
│  (Parent)   │
└──┬───┬───┬──┘
   │   │   │
   ↓   ↓   ↓    Fork: KV cache fork-join → 位元組完全相同的副本
┌──┴┐┌─┴─┐┌┴──┐
│W-1││W-2││W-3│  Worker: 只返回 output，不返回完整工作上下文
└─┬─┘└─┬─┘└─┬─┘  禁止再次 fork（防遞迴分叉）
  │    │    │
  └────┼────┘
       ↓
   結果注入父級上下文

設計經濟學：5 個 fork 的成本 ≈ 1 個（共享 prompt cache）
```

### 7.3 Teammate Mode（Agent Teams）：基於檔案的信箱通訊

```
啟用：CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1

通訊機制：
~/.claude/teams/{teamName}/inboxes/{agentName}.json
├── 追加式 JSON（sender, text, timestamp, read, color, summary）
├── flock() 檔案鎖防止競爭條件
├── 支援直接訊息（對單一 teammate）
├── 支援廣播（對所有人）
└── 支援閒置通知

角色模型：
┌──────────────┐     直接 P2P      ┌──────────────┐
│  Team Lead   │ ◄──────────────► │  Teammate A  │
│  (主 session) │                  │  (獨立實例)   │
└──────┬───────┘                  └──────────────┘
       │           直接 P2P
       ◄──────────────────────────►
                                   ┌──────────────┐
                                   │  Teammate B  │
                                   │  (獨立實例)   │
                                   └──────────────┘

共享任務列表：
├── 狀態：pending → in_progress → completed / blocked
├── 依賴管理
├── 自動解鎖
└── 檔案鎖定

權限同步：
~/.claude/teams/{teamName}/permissions/pending/
└── teammate 需要權限時，委託給 team lead

後端支援：tmux / iTerm2 / in-process
```

### 7.4 Coordinator Mode：自然語言編排

```
程式碼層（TypeScript）：
    → 提供基礎設施（fork/spawn/mailbox 機制）
    → 不包含「什麼時候該分派子任務」的邏輯

System Prompt 層（自然語言）：
    → "不要對劣質工作蓋章通過"
    → "絕不將理解移交給其他 Worker"
    → "大型重構應分派給 Worktree 模式的子智能體"

典型工作流：
    Research（並行 workers）
        ↓
    Synthesis（coordinator 整合）
        ↓
    Implementation（workers 實作）
        ↓
    Verification（workers 驗證）
```

**設計構想**：
1. 可在不重新部署的情況下更新編排行為（改 prompt = 改行為）
2. LLM 原生理解自然語言約束，不需把啟發式規則翻譯成程式碼
3. 模型升級自動改善編排品質（更聰明的模型 → 更好的任務分解判斷）
4. Opus 4 lead + Sonnet 4 subagents 的配置在內部評估中超越單代理

---

## 八、Memory System：三層自我修復記憶

### 8.1 記憶分層架構

```
┌──────────────────────────────────────────┐
│ Layer 1: MEMORY.md（索引層）              │
│ ├── 始終載入上下文（會話啟動時永久載入）   │
│ ├── 每條 ~150 字元，輕量級                │
│ ├── < 200 行 / ~25KB                     │
│ ├── 功能如目錄，非全書                    │
│ └── 四種記憶類型：用戶/回饋/專案/參考       │
├──────────────────────────────────────────┤
│ Layer 2: 主題檔案（詳細層）               │
│ ├── 按需拉取（grep/glob 找到後才讀取）    │
│ ├── 按專案主題分檔                        │
│ ├── 永不全部同時存在於上下文              │
│ ├── 儲存於 ~/.claude/projects/<path>/memory/ │
│ └── 例：memory/react-patterns.md          │
├──────────────────────────────────────────┤
│ Layer 3: 原始紀錄（考古層）               │
│ ├── JSONL 格式對話紀錄（追加式儲存）       │
│ ├── 永不完整重讀入上下文                  │
│ ├── 僅透過 grep 搜尋特定標識符（無語意搜尋）│
│ └── 支援 --continue / --resume 恢復       │
└──────────────────────────────────────────┘
```

### 8.2 「不信任自己的記憶」原則

```
MEMORY.md 說「這個專案用 React 18」
    ↓
智能體：這是一個 hint，不是 fact
    ↓
FileRead package.json  ← 對照實際程式碼庫驗證
    ↓
確認："react": "^18.3.1"
    ↓
才基於此事實行動

嚴格的「成功後才寫入」紀律：
    → 確認檔案寫入成功後才修改記憶索引
    → 若事實可從原始碼重新推導，永遠不儲存
```

### 8.3 autoDream — 記憶整合「做夢」機制

```
位置：services/autoDream/
執行方式：分叉子代理，唯讀 bash 存取
理論基礎：UC Berkeley/Letta "Sleep-time compute"（Lin et al., 2025）
GrowthBook 旗標：tengu_onyx_plover

三閘觸發機制：
    ├── 距上次整合 ≥ 24 小時
    ├── 至少完成 5 個 session
    └── 整合鎖定（mutex，防並行做夢）

四階段流程（模仿 REM 睡眠）：
    ┌──────────┐
    │ Orient   │ 掃描記憶目錄、評估當前記憶狀態
    └────┬─────┘
         ↓
    ┌──────────────────┐
    │ Gather Signal    │ 從日誌收集近期信號、偵測過時記憶
    └────┬─────────────┘
         ↓
    ┌──────────────────┐
    │ Consolidate      │ 合併新信號、相對日期→絕對日期、消除矛盾事實
    └────┬─────────────┘
         ↓
    ┌──────────────────┐
    │ Prune & Index    │ 壓縮整理、更新 MEMORY.md
    └──────────────────┘
```

---

## 九、安全與防禦機制

### 9.1 反蒸餾（Anti-Distillation）雙層架構

```
Layer 1: ANTI_DISTILLATION_CC（claude.ts L301-313）
┌──────────────────────────────────┐
│ 四條件同時滿足才啟用：            │
│ ├── 編譯時旗標                   │
│ ├── CLI 入口點                   │
│ ├── 第一方 API 提供者             │
│ └── GrowthBook: tengu_anti_distill_fake_tool_injection │
│     ↓                            │
│ 送出 anti_distillation: ['fake_tools'] │
│     ↓                            │
│ 伺服器靜默注入偽造工具定義至      │
│ system prompt                    │
└──────────────────────────────────┘

Layer 2: CONNECTOR_TEXT（betas.ts L279-298）
┌──────────────────────────────────┐
│ 伺服器端機制：                    │
│ ├── 緩衝工具呼叫間的助手文字      │
│ ├── 產生摘要 + 加密簽名           │
│ └── 僅限 Anthropic 內部（USER_TYPE === 'ant'）│
└──────────────────────────────────┘
```

### 9.2 原生客戶端認證（CCH DRM）

```
system.ts L59-95

API 請求：
    request.headers["cch"] = "00000"  ← JS 層佔位符

Bun 原生 Zig HTTP 層（nativeFetch）：
    → 建構含佔位符的完整請求體
    → 序列化為 JSON
    → xxHash64(body_bytes, seed=0x6E52736AC806831E) & 0xFFFFF
    → 格式化為 5 字元十六進位
    → 就地替換（突變 JS 字串——違反 JS 規範，使用自訂 Bun 建置）

技術細節：
    → 自訂 Bun 版本：1.3.9-canary.51+d5628db23
    → 演算法：xxHash64 + 烘焙種子常數
    → 目的：確認正版 binary
```

---

## 十、終端渲染引擎：遊戲引擎技術的降維打擊

### 10.1 渲染管線

```
React Component Tree
    ↓
Ink Reconciler（將 React 元素轉為終端輸出）
    ↓
┌─────────────────────────────────────┐
│ 自訂 ASCII 渲染引擎                  │
│ ├── Int32Array 字元池（預分配）       │
│ ├── Bitmask 編碼樣式元資料           │
│ │   └── bold|italic|color 壓縮成位元  │
│ ├── Diff Patch 優化器               │
│ │   └── 只發送變更的游標移動+字元     │
│ └── 行寬快取（自驅逐 LRU）           │
│     └── stringWidth 呼叫減少 ~50x    │
└─────────────────────────────────────┘
    ↓
ANSI Escape Sequences → Terminal
```

### 10.2 為什麼用遊戲引擎技術

Token 串流場景（~40-100 tokens/sec）的特殊需求：
- 每個 token 都觸發 UI 更新
- 傳統「清屏重繪」在終端機中會閃爍
- `stringWidth()`（計算 Unicode 字元寬度）是熱路徑，CJK/Emoji 特別昂貴

解決方案：
- 預分配 `Int32Array` → 零 GC 壓力
- Diff patch → 只更新變更的字元，消除閃爍
- LRU 行寬快取 → 已計算過的行不重算

---

## 十一、Hook 系統與擴展性架構

### 11.1 生命週期事件

```
25+ 個生命週期 Hook 事件（官方文件記錄 12 個核心事件）：

核心事件：
├── SessionStart        會話開始
├── UserPromptSubmit    使用者提交提示
├── PreToolUse          工具執行前
├── PermissionRequest   權限請求
├── PostToolUse         工具執行後
├── PostToolUseFailure  工具執行失敗
├── Notification        通知
├── Stop                停止
├── SubagentStop        子代理停止
├── PreCompact          壓縮前
├── SessionEnd          會話結束
└── Setup               設定

擴展事件（社群記錄）：
├── SubagentStart       子代理啟動
├── RulesLoad           規則載入
├── SettingsChange      設定變更
├── WorktreeCreate      工作樹建立
└── ...
```

### 11.2 四種處理器類型

```
Command     Shell 命令，透過 stdin 接收 JSON，透過 exit code 通訊
HTTP        POST 到端點，失敗時非阻塞
Prompt      單輪 LLM 評估（預設 Haiku）
Agent       產生子代理（Read/Grep/Glob 工具）進行深度驗證

Exit code 語義：
    0 = 允許
    1 = 阻擋並向 Claude 顯示 stderr
    2 = 事件特定行為（阻擋+重新考慮 / 提供上下文 / 強制繼續）
```

### 11.3 橋接層與 IDE 整合

```
src/bridge/
├── VS Code 擴充套件
├── JetBrains 擴充套件
└── 設計理念：「一個引擎，多個前端」

IPC：Unix Domain Sockets（用於代理群組）
認證：JWT
```

---

## 十二、未發布功能的架構前瞻

### 12.1 雙旗標系統

```
編譯時旗標：
    import { feature } from 'bun:bundle'
    → Bun 死碼消除在外部建置中移除禁用功能

執行時旗標：
    GrowthBook 平台，前綴 tengu_
    → 可動態開關，不需重新部署
```

### 12.2 KAIROS — 自主背景守護程式

```
引用次數：150+（原始碼中）
命名：希臘語 kairos（恰當時機）vs chronos（時序時間）

              ┌──── cron 每 5 分鐘 ────┐
              ↓                        │
    ┌─────────────────┐                │
    │   KAIROS Daemon  │ ← 常駐背景進程 │
    │   ┌───────────┐ │                │
    │   │ <tick>    │ │ ← 週期性提示    │
    │   │ 15s 預算   │ │ ← 決策阻塞上限 │
    │   └─────┬─────┘ │                │
    │         ↓        │                │
    │  [決定行動?]      │                │
    │   Y → 執行       │                │
    │   N → 沉默       │                │
    └─────────────────┘
    
    能力：
    ├── 推播通知
    ├── 檔案遞送
    ├── GitHub webhook 訂閱
    └── autoDream 記憶整合
    
    安全約束：
    └── 僅追加式每日日誌（不可自我擦除）
    
    終端焦點感知：
    ├── 使用者切換離開 → 完全自主模式
    └── 使用者返回 → 報告並請求回饋
    
    相關旗標：
    ├── KAIROS_BRIEF
    ├── KAIROS_CHANNELS
    ├── KAIROS_GITHUB_WEBHOOKS
    ├── PROACTIVE
    └── DAEMON
```

### 12.3 ULTRAPLAN — 雲端規劃卸載

```
本地終端                           遠端 Cloud Container Runtime (CCR)
┌──────────┐    API Call     ┌──────────────────┐
│ Claude   │ ──────────────→ │ Opus 4.6         │
│ Code     │    每 3 秒輪詢   │ 規劃窗口 ≤ 30 min │
│ (local)  │ ←────────────── │ 瀏覽器 UI 監控    │
└──────────┘    狀態更新      │ 核准/拒絕介面      │
                             └──────────────────┘

特殊哨兵值：__ULTRAPLAN_TELEPORT_LOCAL__
    → 將結果帶回本地終端
```

### 12.4 BUDDY — Tamagotchi 虛擬寵物系統

```
位置：src/buddy/

物種系統：18 個物種（十六進位編碼繞過 excluded-strings.txt）
稀有度：Common(60%) → Uncommon(20%) → Rare(10%) → Epic(5%) → Legendary(1%)
    └── 1% 閃光機率（Shiny Legendary = 0.01%）
屬性：DEBUGGING / PATIENCE / CHAOS / WISDOM / SNARK
PRNG：Mulberry32, seed = hash(userId) + salt('friend-2026-401')
```

### 12.5 其他未發布功能

```
VOICE_MODE       完整按住說話介面，串流語音轉文字
BRIDGE_MODE      IDE 擴充套件與 CLI 雙向深度連結協議
CHICAGO_MCP      基於 Playwright 的瀏覽器/桌面控制
WORKFLOW_SCRIPTS 無需持續人工輸入的自動化管線
BG_SESSIONS      背景執行會話
SSH_REMOTE       遠端 SSH 連線支援
LODESTONE        （用途未明確記載）
TORCH            （用途未明確記載）
```

---

## 十三、架構依賴全景圖

```
┌─────────────────────────────────────────────────────────────┐
│                     Claude Code v2.1.88                      │
│                 (~512K 行 TypeScript / ~1,900 檔案)           │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │ Bun      │  │ React+Ink│  │ Zod v4   │  │tree-sitter │  │
│  │ Runtime  │  │ Term UI  │  │ Schema   │  │ Shell AST  │  │
│  │ (Zig)    │  │(~140 元件)│  │          │  │            │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └─────┬──────┘  │
│       │              │             │               │         │
│       ↓              ↓             ↓               ↓         │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │     QueryEngine (~46K bundled lines) — AsyncGenerator   │ │
│  │  Agent Loop → Stream Pipeline → Tool Router → History   │ │
│  │  五步預處理 → 多級壓縮 → 斷路器 → 模型降級              │ │
│  └───────────────────────┬─────────────────────────────────┘ │
│                          │                                   │
│       ┌──────────────────┼──────────────────┐               │
│       ↓                  ↓                  ↓               │
│  ┌─────────┐  ┌──────────────┐  ┌───────────────────┐      │
│  │ 40+Tools│  │ Permission   │  │ Memory System     │      │
│  │ (29K ln)│  │ System       │  │ (3-layer)         │      │
│  │ 47 欄位  │  │ (4-layer)    │  │                   │      │
│  │         │  │              │  │ MEMORY.md (索引)   │      │
│  │ Bash    │  │ tree-sitter  │  │ Topic Files (詳細) │      │
│  │ File*   │  │ Regex        │  │ JSONL Logs (考古)  │      │
│  │ Web*    │  │ ML Classifier│  │                   │      │
│  │ Agent   │  │ OS Sandbox   │  │ CLAUDE.md 4-layer  │      │
│  │ MCP     │  │              │  │ autoDream 做夢     │      │
│  │ LSP     │  │ Fail-Closed  │  │ 5 壓縮策略         │      │
│  └────┬────┘  └──────┬───────┘  └────────┬──────────┘      │
│       │              │                    │                  │
│       ↓              ↓                    ↓                  │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │           Multi-Agent System (AgentTool)                │ │
│  │  Fork Mode | Teammate Mode | Worktree Mode              │ │
│  │  Mailbox Pattern | Natural Language Orchestration       │ │
│  │  Coordinator/Worker | KV Cache Fork-Join                │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │           Security & Defense                            │ │
│  │  Anti-Distillation(2L) | CCH DRM(xxHash64) | Undercover│ │
│  │  bashSecurity(25+ validators) | Prompt Cache Guards     │ │
│  │  OS Sandbox(seatbelt/bubblewrap) | Hook System(25+)     │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │           Feature Flags (44 unreleased, dual system)    │ │
│  │  KAIROS (daemon) | autoDream (memory consolidation)     │ │
│  │  ULTRAPLAN (cloud planning) | BUDDY (tamagotchi)        │ │
│  │  VOICE_MODE | BRIDGE_MODE | CHICAGO (desktop control)   │ │
│  │  WORKFLOW_SCRIPTS | BG_SESSIONS | SSH_REMOTE             │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## 十四、設計理念總結：十大架構原則

### 原則 1：推理與執行的嚴格分離
LLM 負責「想」，工具系統負責「做」，權限系統負責「審」。三者在架構上完全獨立，通過對話歷史作為唯一通訊媒介。

### 原則 2：快取經濟學驅動架構
System prompt 的結構、壓縮策略的觸發點、fork 模式的選擇，都受 prompt cache 命中率的影響。快取讀取比標準輸入便宜 10 倍——這個單一經濟事實衍生了幾乎所有重要設計決策。

### 原則 3：自然語言即編排邏輯
多智能體的行為規範寫在 prompt 而非程式碼中，使得編排可在不部署的情況下更新，且隨模型升級自動改善。

### 原則 4：記憶是提示，不是事實
所有記憶都被視為「可能過時的提示」，智能體在行動前必須對照實際狀態驗證。這是架構級的防幻覺設計。

### 原則 5：Fail-Closed 安全設計
權限分類器不可用時預設拒絕。子智能體無法自行批准高風險操作。日誌僅追加不可擦除。四層安全縱深。

### 原則 6：語義級安全（非字串匹配）
使用 tree-sitter AST 解析 shell 指令而非正則，確保安全檢查在語義層面運作。成本極高（帶完整 shell grammar parser），但換來不可繞過性。

### 原則 7：工具間零共享狀態
所有工具間的協作通過 LLM 推理迴圈中介，不存在工具直接呼叫工具的路徑，確保每個決策點都可追溯與審計。

### 原則 8：漸進式上下文管理
從零成本 MicroCompact 到丟棄式 Truncation，多種策略形成漸進式退化（graceful degradation）管線，確保無論上下文多大都能繼續工作。

### 原則 9：漸進式工具發現
重型工具延遲載入、技能分階段揭露、108 個功能閘控透過編譯時死碼消除——維持啟動速度的同時保留彈性擴展能力。

### 原則 10：斷路器保護一切
壓縮（3 次失敗停止）、權限分類（連續拒絕轉人工）、模型降級（過載時切換）——每個可能失控的迴圈都有自動停止機制。

---

*本文件為純技術架構分析，聚焦設計模式與工程原理，不包含任何可直接執行的原始碼。*
