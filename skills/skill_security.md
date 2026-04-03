# SKILL: 安全縱深防禦 (Security Defense-in-Depth)

> 觸發條件：當涉及 Shell 指令或權限設計時

## 四層安全縱深模型

```
Layer 1: tree-sitter AST 解析（主要閘門）
    ↓ — 語義級理解，非正則字串匹配
Layer 2: 正則表達式驗證器（後備）
    ↓ — 處理 AST 解析器未覆蓋的邊緣案例
Layer 3: 權限規則執行
    ├── allowlist / asklist / denylist
    └── ML 分類器（AI Classifier, Fail-Closed）
    ↓
Layer 4: OS 層級沙箱
    ├── macOS：seatbelt profiles
    ├── Linux：bubblewrap
    └── @anthropic-ai/sandbox-runtime
```

## bashSecurity 驗證器（25+ 項）

### 關鍵驗證器

| ID | 驗證項目 | 防禦目標 |
|----|---------|---------|
| 1 | 封鎖 18 個 Zsh 內建命令 | 防止特權指令執行 |
| 2 | Zsh equals expansion（=curl 繞過） | 防止指令偽裝 |
| 3 | Unicode 零寬空格注入 | 防止視覺欺騙 |
| 4 | IFS null-byte 注入 | 防止分隔符篡改 |
| 5 | HackerOne 格式錯誤 token 繞過 | 修補已知漏洞 |
| 6 | zmodload 危險模組（sysopen, ztcp, zsocket） | 封鎖網路/系統存取 |
| 7 | Windows UNC 路徑 | 防止 NTLM hash 洩漏 |
| N | 複合指令分解（&& \|\| ; \|） | 每段獨立評估 |

## 權限決策管線

```
工具執行請求
    ↓
Phase 1: Trust Bootstrap → 載入 allow/deny 規則
    ↓
Phase 2: Pre-Execution Check → 匹配 permission level
    ↓
Phase 2b: AI Classifier → 獨立 LLM 分類器（~100ms 快速 / ~1-2s 深度）
    ↓
Phase 3: User Confirmation → 高風險操作需人工確認
```

## Fail-Closed 設計原則

- 權限分類器不可用時 → **預設拒絕**
- 子智能體無法自行批准高風險操作
- 連續拒絕 3 次 → 強制人工介入
- 日誌僅追加不可擦除

## 反蒸餾防禦

- Anti-Distillation：偽造工具定義注入（混淆惡意抓取）
- Undercover 模式：敏感資訊在送往雲端前進行混淆
- 敏感詞過濾：專案變數名、資料庫連接字串自動脫敏
