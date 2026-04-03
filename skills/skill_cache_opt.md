# SKILL: 快取經濟學優化 (Cache Optimization)

> 觸發條件：當討論系統提示詞設計時

## 核心原則

**省錢即架構** — 每次快取破壞 = 10 倍成本增加（標準輸入 $5.00/M vs 快取讀取 $0.50/M）

## 14 種快取破壞向量

1. System prompt 內容變更
2. 工具定義順序變更
3. 對話歷史中插入新訊息
4. 功能旗標切換導致 prompt 結構變化
5. CLAUDE.md 內容更新
6. Git 狀態變更（分支切換、新 commit）
7. 權限規則修改
8. 技能載入/卸載改變 prompt 結構
9. 模式切換（REPL / Headless / Daemon）
10. 代理角色切換
11. MCP 工具動態註冊
12. 壓縮操作重組對話歷史
13. 記憶索引更新觸發 prompt 重組
14. 子智能體 fork 時的 cache prefix 不一致

## 防護策略

### System Prompt 分割策略
```
SYSTEM_PROMPT_DYNAMIC_BOUNDARY
├── 穩定前半段（base prompt + 工具定義）→ 積極快取
└── 動態後半段（git 狀態、CLAUDE.md 內容）→ 每輪更新
```

### 具體節省措施

| 優化 | 機制 | 效果 |
|------|------|------|
| 工具按字母排序 | 穩定排序 → 快取前綴不變 | 全域生效 |
| Explore/Plan 模式省略 CLAUDE.md | 減少動態區段 | 每週 ~5-15 Gtoken |
| 子代理重用父行程快取 | KV cache fork-join | 幾乎零額外成本 |
| 壓縮時保持 system prompt 不變 | 只壓縮對話歷史 | 快取前綴永不破壞 |

## 驗證清單

在給出任何涉及 System Prompt 結構的建議前，必須評估：

- [ ] 此變更是否會破壞現有的快取前綴？
- [ ] 是否可以將變更放入「動態後半段」？
- [ ] 變更頻率是否可接受（每輪 vs 每次會話 vs 一次性）？
- [ ] 是否有更省成本的替代方案？
