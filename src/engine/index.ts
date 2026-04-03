/**
 * QueryEngine 核心迴圈與快取守門員
 *
 * 對應規格：
 * - Teammate + Skills spec: 三、2. 快取經濟學守門員
 * - Architecture spec: §2.1 QueryEngine AsyncGenerator 驅動的核心迴圈
 * - Architecture spec: §4 上下文管理 五步預處理管線
 *
 * 核心設計：單一迴圈（非遞迴）、串流優先、成本感知、自我修復
 */

import type { QueryEngineConfig, ToolResult } from "../types/index.js";

/** 預設配置 */
const DEFAULT_CONFIG: QueryEngineConfig = {
  maxTokenBudget: 200_000,
  autoCompactThreshold: 0.9, // 上下文視窗的 90%
  autoCompactBuffer: 13_000,
  summaryMaxTokens: 20_000,
  recentFilesRetain: 5,
  maxConsecutiveFailures: 3,
};

/** 對話歷史訊息 */
interface Message {
  role: "system" | "user" | "assistant" | "tool_result";
  content: string;
  tokenEstimate: number;
  timestamp: string;
  compactable?: boolean;
}

/** 迴圈迭代結果 */
interface LoopIteration {
  type: "text" | "tool_use" | "compact" | "budget_exceeded" | "circuit_break";
  content: string;
  toolName?: string;
  toolResult?: ToolResult;
  tokensUsed: number;
  costUsd: number;
}

/** 快取守門員 — 監控對話長度並自動建議壓縮 */
export class CacheGuard {
  private config: QueryEngineConfig;
  private consecutiveCompactFailures = 0;

  constructor(config?: Partial<QueryEngineConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** 檢查是否需要觸發壓縮 */
  shouldCompact(currentTokens: number): boolean {
    if (this.isCircuitOpen()) return false;

    const threshold =
      this.config.maxTokenBudget - this.config.autoCompactBuffer;
    return currentTokens >= threshold;
  }

  /** 記錄壓縮結果 */
  recordCompactResult(success: boolean): void {
    if (success) {
      this.consecutiveCompactFailures = 0;
    } else {
      this.consecutiveCompactFailures++;
    }
  }

  /** 斷路器是否開路 */
  isCircuitOpen(): boolean {
    return (
      this.consecutiveCompactFailures >= this.config.maxConsecutiveFailures
    );
  }

  /** 取得壓縮目標 token 數 */
  getSummaryTarget(): number {
    return this.config.summaryMaxTokens;
  }
}

/** QueryEngine — Agent 推理迴圈核心 */
export class QueryEngine {
  private config: QueryEngineConfig;
  private conversationHistory: Message[] = [];
  private cacheGuard: CacheGuard;
  private totalTokensUsed = 0;
  private totalCostUsd = 0;
  private iterationCount = 0;

  constructor(config?: Partial<QueryEngineConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.cacheGuard = new CacheGuard(config);
  }

  /** 取得快取守門員 */
  getCacheGuard(): CacheGuard {
    return this.cacheGuard;
  }

  /** 估算 token 數（粗略：1 token ≈ 4 字元） */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /** 計算當前上下文總 token 數 */
  getCurrentTokenCount(): number {
    return this.conversationHistory.reduce(
      (sum, msg) => sum + msg.tokenEstimate,
      0,
    );
  }

  /** 新增訊息到對話歷史 */
  addMessage(role: Message["role"], content: string): void {
    this.conversationHistory.push({
      role,
      content,
      tokenEstimate: this.estimateTokens(content),
      timestamp: new Date().toISOString(),
      compactable: role === "tool_result",
    });
  }

  /**
   * 五步預處理管線
   *
   * Step 1: Snip — 移除舊工具回傳結果
   * Step 2: MicroCompact — 零 API 呼叫的本地快取編輯
   * Step 3: ContextCollapse — 摺疊上下文
   * Step 4: AutoCompact — 接近上限時觸發壓縮
   * Step 5: Assemble — 最終請求組裝
   */
  async preprocess(): Promise<{
    messages: Message[];
    compacted: boolean;
  }> {
    let compacted = false;

    // Step 1: Snip — 移除舊工具回傳結果
    this.snip();

    // Step 2: MicroCompact — 標記可壓縮的工具結果
    this.microCompact();

    // Step 3: ContextCollapse — 檢查是否超長
    if (this.getCurrentTokenCount() > this.config.maxTokenBudget) {
      this.contextCollapse();
    }

    // Step 4: AutoCompact — 接近閾值時自動壓縮
    if (this.cacheGuard.shouldCompact(this.getCurrentTokenCount())) {
      const success = await this.autoCompact();
      this.cacheGuard.recordCompactResult(success);
      compacted = success;
    }

    // Step 5: Assemble — 回傳處理後的訊息
    return {
      messages: [...this.conversationHistory],
      compacted,
    };
  }

  /** Step 1: Snip — 移除舊工具結果（保留最近的） */
  private snip(): void {
    const toolResults = this.conversationHistory.filter(
      (m) => m.role === "tool_result",
    );

    if (toolResults.length <= this.config.recentFilesRetain) return;

    const toRemove = toolResults.slice(
      0,
      toolResults.length - this.config.recentFilesRetain,
    );

    for (const msg of toRemove) {
      msg.content = `[已移除] ${msg.content.slice(0, 30)}...`;
      msg.tokenEstimate = 10;
    }
  }

  /** Step 2: MicroCompact — 零成本本地壓縮 */
  private microCompact(): void {
    for (const msg of this.conversationHistory) {
      if (msg.compactable && msg.tokenEstimate > 1000) {
        msg.content = msg.content.slice(0, 500) + "\n[MicroCompact 截斷]";
        msg.tokenEstimate = this.estimateTokens(msg.content);
      }
    }
  }

  /** Step 3: ContextCollapse — 摺疊過長上下文 */
  private contextCollapse(): void {
    // 保留系統訊息和最近的對話
    const systemMessages = this.conversationHistory.filter(
      (m) => m.role === "system",
    );
    const recentMessages = this.conversationHistory
      .filter((m) => m.role !== "system")
      .slice(-10);

    this.conversationHistory = [...systemMessages, ...recentMessages];
  }

  /** Step 4: AutoCompact — 自動壓縮為結構化摘要 */
  private async autoCompact(): Promise<boolean> {
    if (this.cacheGuard.isCircuitOpen()) return false;

    const targetTokens = this.cacheGuard.getSummaryTarget();

    // 保留系統訊息
    const systemMessages = this.conversationHistory.filter(
      (m) => m.role === "system",
    );

    // 將對話歷史壓縮為摘要
    const conversationText = this.conversationHistory
      .filter((m) => m.role !== "system")
      .map((m) => `[${m.role}] ${m.content}`)
      .join("\n");

    // 產生摘要（此處為簡化實作，實際應調用 LLM）
    const summary =
      conversationText.slice(0, targetTokens * 4) +
      "\n[AutoCompact 摘要結束]";

    this.conversationHistory = [
      ...systemMessages,
      {
        role: "assistant",
        content: `[壓縮摘要] ${summary}`,
        tokenEstimate: this.estimateTokens(summary),
        timestamp: new Date().toISOString(),
      },
    ];

    return true;
  }

  /**
   * 核心推理迴圈（單一迴圈，非遞迴）
   *
   * 使用 AsyncGenerator 實現串流處理，支援背壓控制
   */
  async *runLoop(
    userInput: string,
    processIteration: (
      messages: Message[],
    ) => Promise<LoopIteration>,
  ): AsyncGenerator<LoopIteration> {
    this.addMessage("user", userInput);

    while (true) {
      this.iterationCount++;

      // 預處理
      const { messages, compacted } = await this.preprocess();

      if (compacted) {
        yield {
          type: "compact",
          content: "已執行自動壓縮",
          tokensUsed: this.getCurrentTokenCount(),
          costUsd: this.totalCostUsd,
        };
      }

      // 預算檢查
      if (this.totalTokensUsed > this.config.maxTokenBudget) {
        yield {
          type: "budget_exceeded",
          content: `Token 預算已超出 (${this.totalTokensUsed}/${this.config.maxTokenBudget})`,
          tokensUsed: this.totalTokensUsed,
          costUsd: this.totalCostUsd,
        };
        break;
      }

      // 斷路器檢查
      if (this.cacheGuard.isCircuitOpen()) {
        yield {
          type: "circuit_break",
          content: "壓縮斷路器已開路，需要人工介入",
          tokensUsed: this.totalTokensUsed,
          costUsd: this.totalCostUsd,
        };
        break;
      }

      // 執行一次推理迭代
      const iteration = await processIteration(messages);
      this.totalTokensUsed += iteration.tokensUsed;
      this.totalCostUsd += iteration.costUsd;

      // 記錄助手回應
      this.addMessage("assistant", iteration.content);

      // 如果有工具結果，注入對話歷史
      if (iteration.toolResult) {
        this.addMessage("tool_result", iteration.toolResult.output);
      }

      yield iteration;

      // 如果是純文字回應（無工具呼叫），結束迴圈
      if (iteration.type === "text") break;
    }
  }

  /** 取得統計資訊 */
  getStats(): {
    totalTokens: number;
    totalCost: number;
    iterations: number;
    messageCount: number;
  } {
    return {
      totalTokens: this.totalTokensUsed,
      totalCost: this.totalCostUsd,
      iterations: this.iterationCount,
      messageCount: this.conversationHistory.length,
    };
  }
}

/** 建立 QueryEngine */
export function createQueryEngine(
  config?: Partial<QueryEngineConfig>,
): QueryEngine {
  return new QueryEngine(config);
}

/** 建立快取守門員 */
export function createCacheGuard(
  config?: Partial<QueryEngineConfig>,
): CacheGuard {
  return new CacheGuard(config);
}
