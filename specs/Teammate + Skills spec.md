專業規格書：架構設計顧問 Agent 實作計畫 (Teammate + Skills 模式)
一、 系統願景與設計哲學
本系統旨在模擬一個具備「自我驗證」能力的資深架構師，而非單純的對話機器人。其核心理念為 「省錢即架構」，透過精密的記憶分層與技能按需載入，實現高效的推理能力。

二、 核心架構切分 (Layered Architecture)
1. 第一層：Persona 設置 (Agent Runtime)
採用 Teammate Mode 實作獨立的思考空間，避免與主會話的上下文產生干擾。

角色定義 (Persona)：定義為「Arch-Verifier」，核心行為受 System Prompt 約束，但具體知識存放於 Skills。

編排邏輯 (Orchestration)：使用自然語言編排 (Natural Language Orchestration)，要求 Agent 在給出設計建議前，必須先評估「快取破壞風險」。

通訊機制 (Communication)：實作基於檔案的 信箱模式 (Mailbox Pattern)：

路徑：~/.claude/teams/arch_consultant/inbox/

格式：追加式 JSON，支援 P2P 訊息交換與狀態更新。

2. 第二層：程序化知識 (Capability Layer - Skills)
將規格書內容「解耦」為多個具備執行力的 SKILL.md，實作 漸進式揭露 (Progressive Disclosure)。

技能切分策略：
| Skill 模組 | 內容範疇 | 觸發條件 |
| :--- | :--- | :--- |
| skill_cache_opt.md | 快取經濟學、14 種破壞向量 | 當討論系統提示詞設計時 |
| skill_security.md | 4 層安全縱深、bashSecurity 驗證器 | 當涉及 Shell 指令或權限設計時 |
| skill_memory_rem.md | 3 層記憶、autoDream 做夢機制 | 當討論長效記憶與資料整合時 |
| skill_agentic_loop.md | QueryEngine 迴圈、五步預處理 | 當討論 Agent 執行效率與自動壓縮時 |

3. 第三層：記憶系統整合 (Memory System)
模擬規格書中的 三層自我修復記憶，優化 Token 消耗。

Layer 1: MEMORY.md (索引層)：存放在 System Prompt 中，僅包含 150 字內的架構索引清單。

Layer 2: Topic Files (詳細層)：將規格書全文拆分為主題檔案，存放於專案 memory/ 目錄，僅在 Agent 使用 GrepTool 時按需拉取。

Layer 3: Logs (考古層)：對話紀錄以 JSONL 格式存儲，僅供 Agent 進行故障溯源，不主動載入上下文。

三、 關鍵機制與流程設計
1. 「不信任記憶」驗證流程 (Verification Pipeline)
當顧問給出建議時，必須觸發以下流程：

聲明假設：Agent 標註「基於現有記憶，這可能是一個 ASP.NET 核心變更」。

執行驗證：調用 FileReadTool 或 GrepTool 檢查對應的專案檔案（事實核查）。

更新記憶：確認事實後，才將結論更新至 MEMORY.md。

2. 快取經濟學守門員 (Cache Guard)
Agent 會監控對話長度，並在接近閾值時自動建議觸發 AutoCompact (自動壓縮) 策略：

策略：將過往討論壓縮為 ≤ 20,000 Token 的結構化摘要。

保護：保留最近 5 個存取的架構檔案，確保開發連續性。

四、 實作路線圖 (Implementation Roadmap)
階段 1：基礎搭建 (Week 1)
建立 ~/.claude/ 目錄結構與信箱通訊機制。

將規格書拆分為第一批 SKILL.md 模組。

撰寫具備 Fail-Closed 安全意識的 Persona System Prompt。

階段 2：工具與記憶連結 (Week 2)
實作具備 grep 與 glob 能力的基礎工具集。

連結 Layer 2 主題檔案，並測試 Agent 的按需檢索能力。

設定 Budget Guard 監控 Token 成本。

五、 安全與防禦標準 (Security Compliance)
AST 語義分析：所有顧問產出的指令建議，必須先經過 tree-sitter 等級的語義檢查。

斷路器機制：若 Agent 的建議導致連續 3 次驗證失敗，必須強制進入「人工介入」模式。

匿名與隱私：支援 undercover.ts 模式，敏感的專案資訊在送往雲端推理前進行混淆處理。

1. 補充：技能發現機制 (Skill Discovery Mechanism)
缺漏點：當 Skill 被切分成多個檔案且採「延遲載入」時，Agent 可能不知道何時該調用哪個 Skill。

建議補充：實作一個輕量級的 ToolSearchTool。

具體做法：在 MEMORY.md (Layer 1) 中加入一份「技能清單目錄」，僅列出 Skill 名稱與一句話描述。

邏輯：當 Agent 遇到不熟悉的領域（如：Web 安全），它會先搜尋目錄，再動態加載對應的 skill_security.md。

2. 補充：自我修正與斷路器細節 (Self-Correction & Circuit Breaker)
缺漏點：規格書提到了驗證失敗 3 次轉人工，但未定義「單次驗證失敗」後的行為路徑。

建議補充：定義 「反思循環 (Reflection Loop)」。

具體做法：若 FileRead 發現事實與建議不符，Agent 必須執行以下步驟：

Step A：產生一個 Observation 區塊記錄不一致點。

Step B：更新當前對話的 Plan 狀態。

Step C：在重試前，必須先評估是否需要切換模型（如從 Haiku 降級或升級到 Opus 進行深層推理）。

3. 補充：版本化與雙旗標系統 (Versioning & Dual-Flag System)
缺漏點：作為工程師，你需要考慮如何更新顧問的「知識版本」而不破壞舊有的對話快取。

建議補充：導入 feature_flags 控制機制。

具體做法：

編譯時旗標：用於固定核心邏輯（如：不變的架構原則）。

運行時旗標 (tengu_*)：用於實驗性功能的開啟（如：你未來想測試的 Worktree 模式）。

好處：當你想微調 SKILL.md 時，可以透過版本旗標確保 Agent 讀取的是最新且與當前專案相容的規則。

4. 補充：反蒸餾與隱私保護 (Anti-Distillation & Undercover)
缺漏點：身為 IT 工程師，你可能不希望你的專案架構邏輯被雲端模型完全「吸收」或導致敏感資訊外洩。

建議補充：實作 undercover.ts 匿名模式。

具體做法：

敏感詞過濾：在 Skill 執行前，自動將專案特定的變數名或資料庫連接字串進行混淆。

偽造工具注入：若偵測到非授權的外部抓取，自動在 System Prompt 中注入偽造的工具定義（Anti-Distillation），以混淆惡意攻擊者。