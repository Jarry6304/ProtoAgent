# ProtoAgent

架構設計顧問 Agent — 基於 **Teammate + Skills** 模式的自我驗證架構師。

以 Claude Code 架構為藍本，模擬一位具備「自我驗證」能力的資深架構師，透過精密的記憶分層與技能按需載入，實現高效的推理能力。核心理念：**省錢即架構**。

---

## 快速開始

### 前置需求

- [Bun](https://bun.sh/) v1.0+（TypeScript 執行環境）
- [Anthropic API Key](https://console.anthropic.com/)（Claude API 金鑰）

### 安裝步驟

```bash
# 1. Clone 專案
git clone https://github.com/Jarry6304/ProtoAgent.git
cd ProtoAgent

# 2. 安裝依賴
bun install

# 3. 設定 API Key（擇一）
# 方式 A：環境變數（推薦）
export ANTHROPIC_API_KEY="sk-ant-你的金鑰"

# 方式 B：建立 .env 檔案（已被 .gitignore 排除，不會上傳）
echo 'ANTHROPIC_API_KEY=sk-ant-你的金鑰' > .env

# 4. 啟動
bun run start
```

### 使用方式

```
ProtoAgent — 架構設計顧問 Agent
==================================================

已就緒！輸入問題開始對話（輸入 'exit' 離開）

You> 請評估微服務架構的快取破壞風險
Arch-Verifier> （Claude 串流回應...）

You> status    ← 查看 Agent 內部狀態
You> exit      ← 離開
```

### 其他指令

| 指令 | 說明 |
|------|------|
| `bun run start` | 啟動 Agent |
| `bun run dev` | 開發模式（檔案變更自動重啟） |
| `bun run typecheck` | TypeScript 型別檢查 |

---

## 架構概覽

基於三層架構模型設計：

```
┌─────────────────────────────────────────┐
│  Presentation Layer                     │
│  互動式 REPL（未來可擴展 TUI / Web）    │
├─────────────────────────────────────────┤
│  Orchestration Layer                    │
│  QueryEngine / CacheGuard / 五步預處理   │
├─────────────────────────────────────────┤
│  Capability Layer                       │
│  Tools / Skills / Memory / Mailbox      │
└─────────────────────────────────────────┘
         │
         ↓
   Claude API (Anthropic)
   模型：claude-opus-4-6
   模式：Adaptive Thinking + Streaming
```

### 資料流

```
使用者輸入
    ↓
SkillLoader 自動偵測相關技能 → 按需載入 SKILL.md
    ↓
assembleSystemPrompt() 動態組裝（Persona + Skills + Memory Index）
    ↓
ClaudeClient 串流呼叫 → 即時回應
    ↓
MemoryManager 記錄對話歷史 + 成本追蹤 + JSONL 日誌
```

---

## 專案結構

```
ProtoAgent/
├── src/                              # 核心原始碼（10 個模組）
│   ├── index.ts                      # 主入口：ProtoAgent 類別 + REPL 迴圈
│   ├── client/index.ts               # ClaudeClient：API 串流 + 成本計算
│   ├── persona/index.ts              # Arch-Verifier 角色 + 系統提示詞動態組裝
│   ├── skills/index.ts               # SkillLoader：技能發現與漸進式載入（10 個技能）
│   ├── memory/index.ts               # MemoryManager：三層記憶管理器
│   ├── mailbox/index.ts              # Mailbox：信箱通訊（P2P + 廣播）
│   ├── verification/index.ts         # VerificationPipeline + CircuitBreaker
│   ├── engine/index.ts               # QueryEngine + CacheGuard
│   ├── tools/index.ts                # ToolRegistry + PermissionGate + ToolExecutor
│   └── types/index.ts                # 核心型別定義
│
├── skills/                           # SKILL.md 技能模組（10 個，按需載入）
│   ├── skill_cache_opt.md            # §3  快取經濟學（14 種破壞向量）
│   ├── skill_security.md             # §6§9 四層安全縱深（25+ 驗證器）+ 反蒸餾
│   ├── skill_memory_rem.md           # §8  三層記憶 + autoDream 做夢機制
│   ├── skill_agentic_loop.md         # §2§4 QueryEngine 迴圈 + 五步預處理
│   ├── skill_tool_system.md          # §5  工具統一介面 47 欄位 + MCP 整合
│   ├── skill_multi_agent.md          # §7  三種子智能體模式 + 信箱通訊
│   ├── skill_terminal_render.md      # §10 遊戲引擎級終端渲染
│   ├── skill_hook_system.md          # §11 Hook 25+ 生命週期事件 + IDE 橋接
│   ├── skill_unreleased.md           # §12 雙旗標 + KAIROS + ULTRAPLAN + BUDDY
│   └── skill_architecture_overview.md # §1§13§14 全局架構 + 依賴全景 + 十大原則
│
├── memory/                           # 三層記憶系統
│   ├── MEMORY.md                     # Layer 1：索引層（始終載入上下文）
│   ├── system-prompt-design.md       # Layer 2：系統提示詞設計
│   ├── tool-system.md                # Layer 2：工具系統架構
│   ├── permission-model.md           # Layer 2：權限模型
│   └── compression-strategies.md     # Layer 2：壓縮策略
│
├── specs/                            # 規格文件
│   ├── Teammate + Skills spec.md     # 實作計畫規格
│   └── agent-architecture-design-spec.md  # 核心架構知識（14 章完整剖析）
│
├── package.json                      # 依賴：@anthropic-ai/sdk, zod
├── tsconfig.json                     # TypeScript 嚴格模式
├── .gitignore                        # 排除 node_modules, *.env 等
└── LICENSE                           # MIT
```

---

## 核心功能

### 1. 技能漸進式揭露 (Progressive Disclosure)

Agent 不會一次載入所有知識，而是根據使用者輸入自動偵測並載入相關技能，節省 token 成本：

| 技能 | 觸發關鍵字 | 對應規格 | 內容 |
|------|-----------|---------|------|
| `skill_cache_opt` | 快取、cache、省錢 | §3 | 14 種快取破壞向量防護 |
| `skill_security` | 安全、shell、權限 | §6, §9 | 四層安全縱深 + 反蒸餾 |
| `skill_memory_rem` | 記憶、memory、做夢 | §8 | 三層記憶 + autoDream |
| `skill_agentic_loop` | 迴圈、壓縮、效率 | §2, §4 | 五步預處理管線 |
| `skill_tool_system` | 工具、MCP、延遲載入 | §5 | 工具 47 欄位 + MCP 整合 |
| `skill_multi_agent` | 子智能體、fork、協作 | §7 | Fork/Teammate/Worktree |
| `skill_terminal_render` | 終端、渲染、TUI | §10 | 遊戲引擎級渲染 |
| `skill_hook_system` | hook、生命週期、IDE | §11 | 25+ 事件 + 四種處理器 |
| `skill_unreleased` | 旗標、KAIROS、實驗 | §12 | 未發布功能前瞻 |
| `skill_architecture_overview` | 架構、原則、設計 | §1, §13, §14 | 全局架構 + 十大原則 |

> 規格覆蓋率：`agent-architecture-design-spec.md` 全 14 章 → 10 個 SKILL.md = **100%**

### 2. 三層自我修復記憶

| 層級 | 載入策略 | 格式 | 用途 |
|------|---------|------|------|
| Layer 1: `MEMORY.md` | 始終載入 | Markdown 索引 | 記憶目錄（≤150 字元/條） |
| Layer 2: 主題檔案 | 按需拉取 | Markdown | 詳細架構知識（4 個主題檔） |
| Layer 3: JSONL 日誌 | 僅 grep 搜尋 | JSONL | 對話紀錄考古、成本追蹤 |

### 3. 「不信任記憶」驗證管線

```
記憶記錄 → 視為 hint（非 fact）
    ↓
工具驗證事實 → FileRead / Grep 對照
    ↓
確認後才行動 → 成功後才寫入記憶
    ↓
失敗 → 反思循環（Observation → 更新 Plan → 評估策略）
    ↓
連續 3 次失敗 → 斷路器開路 → 強制人工介入
```

### 4. 信箱通訊 (Mailbox Pattern)

支援 Teammate Mode 的 P2P 訊息交換與廣播：

```
~/.claude/teams/{teamName}/inboxes/{agentName}.json
├── 直接訊息（對指定 teammate）
├── 廣播（對所有成員）
└── 未讀訊息追蹤 + 已讀標記
```

### 5. Claude API 整合

| 特性 | 說明 |
|------|------|
| 模型 | Claude Opus 4.6（最強推理能力） |
| 推理模式 | Adaptive Thinking（自動決定推理深度） |
| 輸出方式 | Streaming（串流即時顯示） |
| 成本計算 | 每次呼叫自動追蹤 input/output/cache tokens + 美元成本 |

### 6. 系統提示詞動態組裝

```
穩定前半段（積極快取）          動態後半段（每輪更新）
├── Persona 角色定義            ├── 已載入的技能內容
├── 核心行為約束                ├── 記憶索引摘要
├── 驗證流程規範                └── 環境狀態
└── 斷路器規則
```

---

## 技術堆疊

| 技術 | 版本 | 用途 |
|------|------|------|
| TypeScript | ^5.5 | 全量嚴格模式，型別安全 |
| Bun | v1.0+ | 執行環境，冷啟動快 |
| @anthropic-ai/sdk | ^0.82.0 | Claude API 官方 SDK |
| Zod | ^3.25 | 工具輸入/輸出 Schema 驗證 |

---

## 設計原則

本專案遵循 `specs/agent-architecture-design-spec.md` 的十大架構原則：

| # | 原則 | 說明 |
|---|------|------|
| 1 | 推理與執行的嚴格分離 | LLM 負責想，工具負責做，權限負責審 |
| 2 | 快取經濟學驅動架構 | 快取讀取便宜 10 倍，此事實驅動所有設計 |
| 3 | 自然語言即編排邏輯 | 行為寫在 prompt 而非程式碼，改 prompt = 改行為 |
| 4 | 記憶是提示，不是事實 | 行動前必須對照實際狀態驗證 |
| 5 | Fail-Closed 安全設計 | 不確定時預設拒絕 |
| 6 | 語義級安全 | tree-sitter AST 解析，非字串匹配 |
| 7 | 工具間零共享狀態 | 所有協作通過推理迴圈中介 |
| 8 | 漸進式上下文管理 | 多級壓縮策略形成退化管線 |
| 9 | 漸進式工具發現 | 重型工具延遲載入，技能分階段揭露 |
| 10 | 斷路器保護一切 | 每個迴圈都有自動停止機制 |

---

## 授權

MIT License
