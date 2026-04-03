/**
 * ProtoAgent 核心型別定義
 * 基於 agent-architecture-design-spec 的三層架構模型
 */

// ============================================================
// Skill 系統型別
// ============================================================

/** 技能觸發條件 */
export interface SkillTrigger {
  keywords: string[];
  description: string;
}

/** 技能模組定義 */
export interface SkillModule {
  id: string;
  name: string;
  filePath: string;
  description: string;
  trigger: SkillTrigger;
  loaded: boolean;
  content?: string;
}

// ============================================================
// 記憶系統型別（三層自我修復記憶）
// ============================================================

/** 記憶類型（對應 MEMORY.md 四種記憶） */
export type MemoryType = "user" | "feedback" | "project" | "reference";

/** Layer 1: MEMORY.md 索引項目 */
export interface MemoryIndex {
  id: string;
  type: MemoryType;
  summary: string; // ≤150 字元
  topicFile?: string; // 對應的 Layer 2 檔案路徑
  createdAt: string;
  updatedAt: string;
}

/** Layer 2: 主題檔案元資料 */
export interface TopicFile {
  path: string;
  title: string;
  lastAccessed: string;
}

/** Layer 3: JSONL 日誌條目 */
export interface LogEntry {
  timestamp: string;
  sessionId: string;
  type: "query" | "verification" | "tool_use" | "error" | "memory_update";
  content: string;
  metadata?: Record<string, unknown>;
}

// ============================================================
// 信箱通訊型別（Mailbox Pattern）
// ============================================================

/** 信箱訊息 */
export interface MailboxMessage {
  id: string;
  sender: string;
  recipient: string | "broadcast";
  text: string;
  timestamp: string;
  read: boolean;
  summary?: string;
}

// ============================================================
// 工具系統型別
// ============================================================

/** 工具權限等級 */
export type PermissionLevel = "readonly" | "write" | "dangerous";

/** 統一工具介面 */
export interface Tool {
  name: string;
  description: string;
  permissionLevel: PermissionLevel;
  isParallelizable: boolean;
  shouldDefer: boolean;
  execute(input: Record<string, unknown>): Promise<ToolResult>;
}

/** 工具執行結果 */
export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

// ============================================================
// 驗證管線型別
// ============================================================

/** 驗證步驟結果 */
export interface VerificationResult {
  step: "assume" | "verify" | "update";
  assumption: string;
  verified: boolean;
  evidence?: string;
  observation?: string;
}

/** 斷路器狀態 */
export type CircuitState = "closed" | "open" | "half-open";

// ============================================================
// QueryEngine 型別
// ============================================================

/** 查詢引擎配置 */
export interface QueryEngineConfig {
  maxTokenBudget: number;
  autoCompactThreshold: number;
  autoCompactBuffer: number; // 13K buffer
  summaryMaxTokens: number; // ≤20K
  recentFilesRetain: number; // 最近 5 個
  maxConsecutiveFailures: number; // 斷路器閾值 = 3
}

/** Agent 角色定義 */
export interface PersonaConfig {
  name: string;
  role: string;
  systemPrompt: string;
  teamName: string;
  skills: string[];
}
