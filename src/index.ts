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
  private sessionId: string;

  constructor() {
    this.sessionId = `session_${Date.now()}`;
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
   * 1. 自動偵測並載入相關技能
   * 2. 執行 QueryEngine 推理迴圈
   * 3. 驗證建議的正確性
   */
  async processInput(userInput: string): Promise<string> {
    // 自動偵測並載入相關技能（漸進式揭露）
    const newSkills = this.skillLoader.autoDetectAndLoad(userInput);
    if (newSkills.length > 0) {
      const names = newSkills.map((s) => s.name).join(", ");
      this.log("skill", `已載入技能: ${names}`);
    }

    const responses: string[] = [];

    // 執行推理迴圈
    const loop = this.engine.runLoop(userInput, async (messages) => {
      // 此處為推理迭代的佔位實作
      // 實際應連接 LLM API（如 Anthropic Claude API）
      return {
        type: "text" as const,
        content: `[Arch-Verifier] 已收到查詢，正在分析...`,
        tokensUsed: this.estimateTokens(userInput),
        costUsd: 0,
      };
    });

    for await (const iteration of loop) {
      switch (iteration.type) {
        case "text":
          responses.push(iteration.content);
          break;
        case "compact":
          this.log("engine", "已執行自動壓縮");
          break;
        case "budget_exceeded":
          responses.push("[警告] Token 預算已超出，建議開啟新會話");
          break;
        case "circuit_break":
          responses.push("[錯誤] 斷路器已觸發，需要人工介入");
          break;
      }
    }

    return responses.join("\n");
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

// 主程式入口
async function main(): Promise<void> {
  console.log("🏗️  ProtoAgent — 架構設計顧問 Agent");
  console.log("═".repeat(50));

  const agent = createProtoAgent();
  await agent.initialize();

  const status = agent.getStatus();
  console.log("\n📊 Agent 狀態:");
  console.log(JSON.stringify(status, null, 2));

  console.log("\n✅ ProtoAgent 已就緒，等待輸入...");
}

main().catch(console.error);
