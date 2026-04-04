# SKILL: Hook 系統與擴展性架構 (Hook System & Extensibility)

> 觸發條件：當討論生命週期事件、擴展機制、IDE 整合時

## 25+ 個生命週期 Hook 事件

### 核心事件（官方文件記錄 12 個）

| 事件 | 觸發時機 | 用途 |
|------|---------|------|
| SessionStart | 會話開始 | 初始化環境 |
| UserPromptSubmit | 使用者提交提示 | 輸入預處理 |
| PreToolUse | 工具執行前 | 攔截/修改工具呼叫 |
| PermissionRequest | 權限請求 | 自訂權限邏輯 |
| PostToolUse | 工具執行後 | 記錄/審計 |
| PostToolUseFailure | 工具執行失敗 | 錯誤處理 |
| Notification | 通知 | 自訂通知管道 |
| Stop | 停止 | 清理資源 |
| SubagentStop | 子代理停止 | 子任務完成處理 |
| PreCompact | 壓縮前 | 保護重要上下文 |
| SessionEnd | 會話結束 | 持久化狀態 |
| Setup | 設定 | 一次性初始化 |

### 擴展事件（社群記錄）

| 事件 | 觸發時機 |
|------|---------|
| SubagentStart | 子代理啟動 |
| RulesLoad | 規則載入 |
| SettingsChange | 設定變更 |
| WorktreeCreate | 工作樹建立 |

## 四種處理器類型

```
Command     Shell 命令，透過 stdin 接收 JSON，透過 exit code 通訊
HTTP        POST 到端點，失敗時非阻塞
Prompt      單輪 LLM 評估（預設 Haiku）
Agent       產生子代理（Read/Grep/Glob 工具）進行深度驗證
```

### Exit Code 語義

| Code | 意義 |
|------|------|
| 0 | 允許（放行） |
| 1 | 阻擋並向 Claude 顯示 stderr |
| 2 | 事件特定行為（阻擋+重新考慮 / 提供上下文 / 強制繼續） |

## Hook 設計模式

### 審計日誌 Hook（PostToolUse）
```
每次工具執行後 → 記錄操作到審計日誌
用途：合規追蹤、操作回溯
```

### 安全閘門 Hook（PreToolUse）
```
工具執行前 → 檢查是否符合安全策略
exit 0 → 放行
exit 1 → 阻擋並說明原因
```

### 自動品質檢查 Hook（PostToolUse）
```
檔案寫入後 → 自動執行 linter / type check
失敗 → 回饋給 Claude 自動修復
```

## 橋接層與 IDE 整合

```
src/bridge/
├── VS Code 擴充套件
├── JetBrains 擴充套件
└── 設計理念：「一個引擎，多個前端」

IPC：Unix Domain Sockets（用於代理群組）
認證：JWT
```

## 擴展性設計啟示

1. **Hook 是非侵入式擴展** — 不修改核心程式碼即可加入自訂行為
2. **Exit code 語義** — 簡單的整數值控制複雜的流程分支
3. **多種處理器類型** — 從簡單 Shell 到深度 Agent 驗證，按需選擇
4. **橋接層模式** — 核心引擎與 UI 前端解耦，支援多平台
