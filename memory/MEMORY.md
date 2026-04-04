# MEMORY.md — Layer 1 索引層

> 此檔案始終載入上下文，作為記憶目錄（非全書）
> 每條摘要 ≤ 150 字元 | 總量 < 200 行

## 技能清單目錄（Skill Discovery）

| Skill | 對應規格章節 | 一句話描述 |
|-------|-------------|-----------|
| skill_cache_opt | §3 | 快取經濟學、14 種快取破壞向量追蹤與防護 |
| skill_security | §6, §9 | 四層安全縱深、bashSecurity 25+ 驗證器、反蒸餾防禦 |
| skill_memory_rem | §8 | 三層記憶架構、autoDream 做夢機制 |
| skill_agentic_loop | §2, §4 | QueryEngine 推理迴圈、五步預處理管線 |
| skill_tool_system | §5 | 工具統一介面 47 欄位、MCP 整合、延遲載入 |
| skill_multi_agent | §7 | 三種子智能體模式、信箱通訊、自然語言編排 |
| skill_terminal_render | §10 | 遊戲引擎級終端渲染、Diff Patch、LRU 快取 |
| skill_hook_system | §11 | 25+ 生命週期事件、四種處理器、IDE 橋接 |
| skill_unreleased | §12 | 雙旗標系統、KAIROS、ULTRAPLAN、BUDDY |
| skill_architecture_overview | §1, §13, §14 | 三層架構模型、依賴全景圖、十大原則 |

## 專案記憶 (project)

- [P001] ProtoAgent 採用 TypeScript + Bun 技術堆疊，基於三層架構模型
- [P002] 核心設計原則：推理與執行分離、快取經濟學驅動、自然語言即編排
- [P003] 多智能體支援三種模式：Fork / Teammate / Worktree

## 架構參考 (reference)

- [R001] 系統提示詞為動態組裝，分穩定前半段與動態後半段 → 詳見 memory/system-prompt-design.md
- [R002] 工具系統 47 欄位統一介面，零共享狀態 → 詳見 memory/tool-system.md
- [R003] 權限系統四層縱深 + Fail-Closed 設計 → 詳見 memory/permission-model.md
- [R004] 壓縮策略五級漸進退化管線 → 詳見 memory/compression-strategies.md

## 用戶記憶 (user)

- [U001] （待會話中累積）

## 回饋記憶 (feedback)

- [F001] （待驗證流程中累積）
