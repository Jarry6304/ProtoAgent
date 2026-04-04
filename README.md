# ProtoAgent

架構設計顧問 Agent — 基於 **Teammate + Skills** 模式的自我驗證架構師。

以 Claude Code 架構為藍本，模擬一位具備「自我驗證」能力的資深架構師，透過精密的記憶分層與技能按需載入，實現高效的推理能力。核心理念：**省錢即架構**。

---

## 快速開始

### 前置需求

- [Bun](https://bun.sh/) v1.0+ （TypeScript 執行環境）
- [Anthropic API Key](https://console.anthropic.com/) （Claude API 金鑰）

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
自動偵測相關技能 → 按需載入 SKILL.md
    ↓
動態組裝系統提示詞（Persona + Skills + Memory Index）
    ↓
Claude API 串流呼叫 → 即時回應
    ↓
記錄對話歷史 + 成本追蹤 + JSONL 日誌
```

---

## 專案結構

```
ProtoAgent/
├── src/                        # 核心原始碼
│   ├── index.ts                # 主入口 + REPL 迴圈
│   ├── client/index.ts         # Claude API 客戶端（串流 + 成本計算）
│   ├── persona/index.ts        # Arch-Verifier 角色 + 系統提示詞動態組裝
│   ├── skills/index.ts         # 技能發現與漸進式載入
│   ├── memory/index.ts         # 三層記憶管理器
│   ├── mailbox/index.ts        # 信箱通訊（P2P + 廣播）
│   ├── verification/index.ts   # 驗證管線 + 斷路器
│   ├── engine/index.ts         # QueryEngine + 快取守門員
│   ├── tools/index.ts          # 工具註冊 + 權限閘門 + 執行器
│   └── types/index.ts          # 核心型別定義
│
├── skills/                     # SKILL.md 技能模組（按需載入）
│   ├── skill_cache_opt.md      # 快取經濟學（14 種破壞向量）
│   ├── skill_security.md       # 四層安全縱深（25+ 驗證器）
│   ├── skill_memory_rem.md     # 三層記憶 + autoDream 做夢機制
│   └── skill_agentic_loop.md   # QueryEngine 迴圈 + 五步預處理
│
├── memory/                     # 記憶系統
│   ├── MEMORY.md               # Layer 1: 索引層（始終載入上下文）
│   ├── system-prompt-design.md # Layer 2: 主題檔案（按需拉取）
│   ├── tool-system.md          #
│   ├── permission-model.md     #
│   └── compression-strategies.md
│
├── specs/                      # 規格文件
│   ├── Teammate + Skills spec.md
│   └── agent-architecture-design-spec.md
│
├── package.json
└── tsconfig.json
```

---

## 核心功能

### 1. 技能漸進式揭露 (Progressive Disclosure)

Agent 不會一次載入所有知識。根據使用者的輸入，自動偵測並載入相關技能：

| 技能 | 觸發關鍵字 | 內容 |
|------|-----------|------|
| `skill_cache_opt` | 快取、cache、system prompt | 14 種快取破壞向量防護 |
| `skill_security` | 安全、shell、權限 | 四層安全縱深模型 |
| `skill_memory_rem` | 記憶、memory、做夢 | 三層記憶 + autoDream |
| `skill_agentic_loop` | 迴圈、壓縮、效率 | 五步預處理管線 |

### 2. 三層自我修復記憶

| 層級 | 載入策略 | 用途 |
|------|---------|------|
| Layer 1: MEMORY.md | 始終載入 | 索引目錄（≤150 字元/條） |
| Layer 2: 主題檔案 | 按需拉取 | 詳細架構知識 |
| Layer 3: JSONL 日誌 | 僅 grep 搜尋 | 對話紀錄考古 |

### 3. 「不信任記憶」驗證管線

```
記憶記錄 → 視為 hint → 工具驗證事實 → 確認後才行動
    失敗 → 反思循環 → 連續 3 次失敗 → 強制人工介入
```

### 4. 信箱通訊 (Mailbox Pattern)

支援 Teammate Mode 的 P2P 訊息交換與廣播，路徑：
```
~/.claude/teams/{teamName}/inboxes/{agentName}.json
```

### 5. 成本追蹤

每次 API 呼叫自動計算 token 消耗與美元成本，記錄於 JSONL 日誌。

---

## 技術堆疊

| 技術 | 用途 |
|------|------|
| TypeScript | 型別安全 + Zod 天然整合 |
| Bun | 高效執行環境（冷啟動快） |
| @anthropic-ai/sdk | Claude API 官方 SDK |
| Zod | 工具輸入/輸出 Schema 驗證 |

---

## 設計原則

本專案遵循 `specs/agent-architecture-design-spec.md` 的十大架構原則：

1. **推理與執行的嚴格分離** — LLM 負責想，工具系統負責做
2. **快取經濟學驅動架構** — 省錢 = 架構約束
3. **自然語言即編排邏輯** — 行為規範寫在 prompt 而非程式碼
4. **記憶是提示，不是事實** — 行動前必須驗證
5. **Fail-Closed 安全設計** — 不確定時預設拒絕
6. **工具間零共享狀態** — 所有協作通過推理迴圈中介
7. **漸進式上下文管理** — 多級壓縮策略
8. **漸進式工具發現** — 重型工具延遲載入
9. **斷路器保護一切** — 每個迴圈都有自動停止機制

---

## 授權

MIT License
