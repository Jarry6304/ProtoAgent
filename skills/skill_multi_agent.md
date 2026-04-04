# SKILL: 多智能體架構 (Multi-Agent System)

> 觸發條件：當討論子智能體、任務分派、多代理協作時

## 三種子智能體模式

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

## Fork Mode：KV Cache Fork-Join

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

## Teammate Mode：基於檔案的信箱通訊

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
├── 依賴管理與自動解鎖
└── 檔案鎖定

權限同步：
~/.claude/teams/{teamName}/permissions/pending/
└── teammate 需要權限時，委託給 team lead

後端支援：tmux / iTerm2 / in-process
```

## Coordinator Mode：自然語言編排

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

## 設計構想

1. 可在不重新部署的情況下更新編排行為（改 prompt = 改行為）
2. LLM 原生理解自然語言約束，不需把啟發式規則翻譯成程式碼
3. 模型升級自動改善編排品質（更聰明的模型 → 更好的任務分解判斷）
4. Opus lead + Sonnet subagents 的配置在內部評估中超越單代理

## 模式選擇指南

| 場景 | 推薦模式 | 原因 |
|------|---------|------|
| 快速並行查詢 | Fork | 共享快取，幾乎零成本 |
| 長時間獨立任務 | Teammate | 獨立上下文，P2P 通訊 |
| 需要隔離分支的重構 | Worktree | 獨立 git worktree |
| 研究 + 實作的混合任務 | Coordinator | 自然語言編排多 worker |
