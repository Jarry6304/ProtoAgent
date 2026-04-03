# 系統提示詞設計 — Layer 2 詳細層

## 動態組裝結構

System Prompt 並非靜態文字，每輪動態組裝數十個元件：

```
System Prompt Assembly
├── 執行模式（REPL / Headless / Daemon）
├── 可用工具 Schema（按字母排序 → 穩定排序 → 高快取命中率）
├── 當前權限規則
├── Git 狀態（分支、最近 commit、工作樹狀態）
├── CLAUDE.md 四層層次結構
│   ├── 全域（企業管理員）
│   ├── 使用者級（個人偏好）
│   ├── 專案級（團隊共識）
│   ├── 專案規則（細粒度）
│   └── 私人（不入版控的個人覆寫）
├── 載入的技能（Agent Skills）
├── 活躍的功能旗標
└── 代理角色專屬指令（6 種角色各有不同邏輯）
```

## 快取分割策略

```
SYSTEM_PROMPT_DYNAMIC_BOUNDARY
├── 穩定前半段 → 積極快取
│   ├── Base persona prompt
│   ├── 工具定義（字母排序）
│   └── 核心權限規則
└── 動態後半段 → 每輪更新
    ├── Git 狀態
    ├── CLAUDE.md 內容
    └── 活躍技能
```

## 設計理念

借鑒 `.gitconfig` 的覆寫模式：全域設定提供基線，專案級提供專業化，`.local.md` 不入版控。
