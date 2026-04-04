# SKILL: 未發布功能前瞻 (Unreleased Features)

> 觸發條件：當討論未來架構演進、實驗性功能、功能旗標時

## 雙旗標系統

```
編譯時旗標：
    import { feature } from 'bun:bundle'
    → Bun 死碼消除在外部建置中移除禁用功能
    → 108 個功能閘控模組

執行時旗標：
    GrowthBook 平台，前綴 tengu_
    → 可動態開關，不需重新部署
    → 控制實驗性功能的開啟
```

## KAIROS — 自主背景守護程式

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
```

## ULTRAPLAN — 雲端規劃卸載

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

## BUDDY — Tamagotchi 虛擬寵物系統

```
位置：src/buddy/

物種系統：18 個物種（十六進位編碼）
稀有度：Common(60%) → Uncommon(20%) → Rare(10%) → Epic(5%) → Legendary(1%)
    └── 1% 閃光機率（Shiny Legendary = 0.01%）
屬性：DEBUGGING / PATIENCE / CHAOS / WISDOM / SNARK
PRNG：Mulberry32, seed = hash(userId) + salt
```

## 其他未發布功能

| 功能 | 說明 |
|------|------|
| VOICE_MODE | 完整按住說話介面，串流語音轉文字 |
| BRIDGE_MODE | IDE 擴充套件與 CLI 雙向深度連結協議 |
| CHICAGO_MCP | 基於 Playwright 的瀏覽器/桌面控制 |
| WORKFLOW_SCRIPTS | 無需持續人工輸入的自動化管線 |
| BG_SESSIONS | 背景執行會話 |
| SSH_REMOTE | 遠端 SSH 連線支援 |

## 架構設計啟示

1. **雙旗標系統** — 編譯時消除未用功能 + 執行時動態切換，兼顧效能與彈性
2. **背景守護程式** — 自主行動但受安全約束（僅追加日誌、焦點感知）
3. **雲端卸載** — 將昂貴的規劃任務卸載到雲端，本地只處理輕量互動
4. **遊戲化元素** — BUDDY 系統展示如何在工具中加入趣味性
