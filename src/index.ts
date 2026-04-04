/**
 * ProtoAgent — 架構設計顧問 Agent 主入口
 *
 * 基於 Teammate + Skills 模式的自我驗證架構師
 * 以 agent-architecture-design-spec 為核心知識
 *
 * 三層架構模型：
 * ┌─────────────────────────────────────┐
 * │  Presentation Layer（未來擴展）      │
 * ├─────────────────────────────────────┤
 * │  Orchestration Layer                │
 * │  QueryEngine / Context / CacheGuard │
 * ├─────────────────────────────────────┤
 * │  Capability Layer                   │
 * │  Tools / Skills / Memory / Mailbox  │
 * └─────────────────────────────────────┘
 */

import {
  assembleSystemPrompt,
  createPersona,
  DEFAULT_PERSONA,
} from "./persona/index.js";
import { createMailbox } from "./mailbox/index.js";
import { createSkillLoader } from "./skills/index.js";
import { createMemoryManager } from "./memory/index.js";
import {
  createVerificationPipeline,
} from "./verification/index.js";
import { createQueryEngine } from "./engine/index.js";
import {
  createToolRegistry,
  createPermissionGate,
  createToolExecutor,
} from "./tools/index.js";
import {
  createClaudeClient,
  type ChatMessage,
  type ClaudeClient,
} from "./client/index.js";

/** ProtoAgent 主類別 */
export class ProtoAgent {
  private persona = createPersona();
  private mailbox = createMailbox(DEFAULT_PERSONA.teamName, DEFAULT_PERSONA.name);
  private skillLoader = createSkillLoader();
  private memory = createMemoryManager();
  private verification = createVerificationPipeline();
  private engine = createQueryEngine();
  private toolRegistry = createToolRegistry();
  private permissionGate = createPermissionGate();
  private toolExecutor = createToolExecutor();
  private claude: ClaudeClient;
  private conversationHistory: ChatMessage[] = [];
  private sessionId: string;

  constructor() {
    this.sessionId = `session_${Date.now()}`;
    this.claude = createClaudeClient({
      model: "claude-opus-4-6",
      maxTokens: 16000,
      streaming: true,
      thinking: true,
    });
    this.log("system", "ProtoAgent 初始化完成");
  }

  /** 初始化 Agent Runtime */
  async initialize(): Promise<void> {
    // 1. 載入記憶索引（Layer 1: 始終載入）
    const memoryIndex = this.memory.loadIndex();

    // 2. 組裝系統提示詞
    const systemPrompt = assembleSystemPrompt(
      this.persona,
      this.skillLoader.listSkills(),
      memoryIndex,
    );
    this.persona.systemPrompt = systemPrompt;

    // 3. 將系統提示詞注入 QueryEngine
    this.engine.addMessage("system", systemPrompt);

    // 4. 檢查信箱未讀訊息
    const unread = this.mailbox.receiveUnread();
    if (unread.length > 0) {
      this.log("system", `收到 ${unread.length} 則未讀訊息`);
    }

    this.log("system", "Agent Runtime 已就緒");
  }

  /**
   * 處理使用者輸入
   *
   * 流程：
   * 1. 自動偵測並載入相關技能（漸進式揭露）
   * 2. 將技能內容注入系統提示詞
   * 3. 呼叫 Claude API 取得回應
   * 4. 記錄對話歷史與成本
   */
  async processInput(userInput: string): Promise<string> {
    // Step 1: 自動偵測並載入相關技能
    const newSkills = this.skillLoader.autoDetectAndLoad(userInput);
    if (newSkills.length > 0) {
      const names = newSkills.map((s) => s.name).join(", ");
      this.log("skill", `已載入技能: ${names}`);

      // 重新組裝系統提示詞（含新載入的技能）
      const memoryIndex = this.memory.loadIndex();
      this.persona.systemPrompt = assembleSystemPrompt(
        this.persona,
        this.skillLoader.listSkills(),
        memoryIndex,
      );
    }

    // Step 2: 加入使用者訊息到對話歷史
    this.conversationHistory.push({ role: "user", content: userInput });
    this.engine.addMessage("user", userInput);

    // Step 3: 呼叫 Claude API
    try {
      const response = await this.claude.sendMessage(
        this.persona.systemPrompt,
        this.conversationHistory,
      );

      // Step 4: 記錄助手回應到對話歷史
      this.conversationHistory.push({
        role: "assistant",
        content: response.text,
      });
      this.engine.addMessage("assistant", response.text);

      // 記錄成本與 token 使用
      this.log(
        "query",
        `tokens: ${response.inputTokens}+${response.outputTokens} | ` +
          `cache: ${response.cacheReadTokens} | ` +
          `cost: $${response.costUsd.toFixed(4)} | ` +
          `stop: ${response.stopReason}`,
      );

      if (response.thinking) {
        this.log("thinking", response.thinking.slice(0, 500));
      }

      return response.text;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      this.log("error", `Claude API 錯誤: ${message}`);
      return `[錯誤] 無法取得 Claude 回應: ${message}`;
    }
  }

  /** 執行驗證流程 */
  async verifyAssumption(
    assumption: string,
    checkFn: () => Promise<{ verified: boolean; evidence?: string }>,
  ): Promise<string> {
    const result = await this.verification.verify(assumption, async () =>
      checkFn(),
    );

    if (result.verified) {
      this.log("verification", `驗證通過: ${assumption}`);
      return `✓ 驗證通過: ${assumption}`;
    }

    this.log("verification", `驗證失敗: ${assumption}`);
    return result.observation ?? `✗ 驗證失敗: ${assumption}`;
  }

  /** 傳送訊息給 teammate */
  sendMessage(recipient: string, text: string): void {
    this.mailbox.send(recipient, text);
    this.log("mailbox", `已傳送訊息給 ${recipient}`);
  }

  /** 取得 Agent 狀態摘要 */
  getStatus(): Record<string, unknown> {
    const engineStats = this.engine.getStats();
    const mailboxStats = this.mailbox.getStats();
    const circuitBreaker = this.verification.getCircuitBreaker();

    return {
      sessionId: this.sessionId,
      persona: this.persona.name,
      skills: {
        loaded: this.skillLoader.getLoadedSkills().length,
        total: this.skillLoader.listSkills().length,
      },
      engine: engineStats,
      mailbox: mailboxStats,
      circuitBreaker: {
        state: circuitBreaker.getState(),
        failures: circuitBreaker.getFailureCount(),
      },
      memory: {
        recentFiles: this.memory.getRecentFiles().length,
      },
    };
  }

  /** 估算 token 數 */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /** 記錄日誌（Layer 3 考古層） */
  private log(type: string, content: string): void {
    this.memory.appendLog(this.sessionId, {
      type: type as "query",
      content,
    });
  }
}

/** 建立 ProtoAgent 實例 */
export function createProtoAgent(): ProtoAgent {
  return new ProtoAgent();
}

// 主程式入口 — 互動式 REPL
async function main(): Promise<void> {
  console.log("ProtoAgent — 架構設計顧問 Agent");
  console.log("=".repeat(50));

  const agent = createProtoAgent();
  await agent.initialize();

  const status = agent.getStatus();
  console.log("\nAgent 狀態:");
  console.log(JSON.stringify(status, null, 2));

  console.log("\n已就緒！輸入問題開始對話（輸入 'exit' 離開）\n");

  // 簡易 REPL 迴圈
  const reader = require("node:readline").createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const askQuestion = (): void => {
    reader.question("You> ", async (input: string) => {
      const trimmed = input.trim();
      if (!trimmed || trimmed === "exit") {
        console.log("\n再見！");
        reader.close();
        return;
      }

      if (trimmed === "status") {
        console.log(JSON.stringify(agent.getStatus(), null, 2));
        askQuestion();
        return;
      }

      console.log("\nArch-Verifier>");
      const response = await agent.processInput(trimmed);
      if (!response.startsWith("[錯誤]")) {
        // 串流模式下文字已即時輸出，這裡不需重複
      } else {
        console.log(response);
      }
      console.log();
      askQuestion();
    });
  };

  askQuestion();
}

main().catch(console.error);
