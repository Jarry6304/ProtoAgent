/**
 * Claude API 客戶端
 *
 * 這是 ProtoAgent 與 Claude 之間的橋樑。
 * 負責：API 呼叫、串流處理、成本計算、錯誤重試
 *
 * ┌──────────────┐        ┌──────────────┐
 * │  ProtoAgent  │  ───►  │ ClaudeClient │  ───►  Claude API
 * │  (engine)    │  ◄───  │ (本模組)      │  ◄───  (Anthropic)
 * └──────────────┘        └──────────────┘
 */

import Anthropic from "@anthropic-ai/sdk";

// ============================================================
// 型別定義
// ============================================================

/** 客戶端配置 */
export interface ClaudeClientConfig {
  /** 模型 ID（預設 claude-opus-4-6） */
  model?: string;
  /** 最大輸出 token 數 */
  maxTokens?: number;
  /** 是否啟用串流 */
  streaming?: boolean;
  /** 是否啟用 adaptive thinking */
  thinking?: boolean;
}

/** 對話訊息格式 */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** API 回應結果 */
export interface ClaudeResponse {
  text: string;
  thinking?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  stopReason: string;
}

// ============================================================
// 成本常數（Claude Opus 4.6 定價）
// ============================================================

const PRICING = {
  "claude-opus-4-6": { input: 5.0, output: 25.0, cacheRead: 0.5 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0, cacheRead: 0.3 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0, cacheRead: 0.1 },
} as const;

type ModelId = keyof typeof PRICING;

// ============================================================
// Claude 客戶端
// ============================================================

export class ClaudeClient {
  private client: Anthropic;
  private model: string;
  private maxTokens: number;
  private streaming: boolean;
  private useThinking: boolean;

  constructor(config?: ClaudeClientConfig) {
    // SDK 會自動讀取 ANTHROPIC_API_KEY 環境變數
    this.client = new Anthropic();
    this.model = config?.model ?? "claude-opus-4-6";
    this.maxTokens = config?.maxTokens ?? 16000;
    this.streaming = config?.streaming ?? true;
    this.useThinking = config?.thinking ?? true;
  }

  /**
   * 發送訊息給 Claude（核心方法）
   *
   * @param systemPrompt - 系統提示詞（你的 Persona + Skills）
   * @param messages - 對話歷史
   * @returns Claude 的回應
   */
  async sendMessage(
    systemPrompt: string,
    messages: ChatMessage[],
  ): Promise<ClaudeResponse> {
    // 將 ChatMessage 轉為 SDK 格式
    const apiMessages: Anthropic.MessageParam[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // 建構請求參數
    const params: Anthropic.MessageCreateParams = {
      model: this.model,
      max_tokens: this.maxTokens,
      system: systemPrompt,
      messages: apiMessages,
      // Opus 4.6 使用 adaptive thinking（無需設定 budget_tokens）
      ...(this.useThinking && { thinking: { type: "adaptive" as const } }),
    };

    if (this.streaming) {
      return this.sendStreaming(params);
    }
    return this.sendNonStreaming(params);
  }

  /** 非串流請求 */
  private async sendNonStreaming(
    params: Anthropic.MessageCreateParams,
  ): Promise<ClaudeResponse> {
    const response = await this.client.messages.create(params);
    return this.parseResponse(response);
  }

  /** 串流請求（推薦，避免逾時） */
  private async sendStreaming(
    params: Anthropic.MessageCreateParams,
  ): Promise<ClaudeResponse> {
    const stream = this.client.messages.stream(params);

    // 可選：即時輸出文字
    stream.on("text", (delta) => {
      process.stdout.write(delta);
    });

    const finalMessage = await stream.finalMessage();
    process.stdout.write("\n");
    return this.parseResponse(finalMessage);
  }

  /**
   * 串流請求（帶回呼，讓呼叫者控制輸出）
   */
  async sendMessageWithCallback(
    systemPrompt: string,
    messages: ChatMessage[],
    onTextDelta: (text: string) => void,
    onThinkingDelta?: (thinking: string) => void,
  ): Promise<ClaudeResponse> {
    const apiMessages: Anthropic.MessageParam[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: this.maxTokens,
      system: systemPrompt,
      messages: apiMessages,
      ...(this.useThinking && { thinking: { type: "adaptive" as const } }),
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          onTextDelta(event.delta.text);
        } else if (
          event.delta.type === "thinking_delta" &&
          onThinkingDelta
        ) {
          onThinkingDelta(event.delta.thinking);
        }
      }
    }

    const finalMessage = await stream.finalMessage();
    return this.parseResponse(finalMessage);
  }

  /** 解析 API 回應 */
  private parseResponse(response: Anthropic.Message): ClaudeResponse {
    let text = "";
    let thinking = "";

    for (const block of response.content) {
      if (block.type === "text") {
        text += block.text;
      } else if (block.type === "thinking") {
        thinking += block.thinking;
      }
    }

    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const cacheReadTokens =
      (response.usage as Record<string, number>).cache_read_input_tokens ?? 0;

    return {
      text,
      thinking: thinking || undefined,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      costUsd: this.calculateCost(inputTokens, outputTokens, cacheReadTokens),
      stopReason: response.stop_reason ?? "unknown",
    };
  }

  /** 計算 API 成本（美元） */
  private calculateCost(
    inputTokens: number,
    outputTokens: number,
    cacheReadTokens: number,
  ): number {
    const pricing =
      PRICING[this.model as ModelId] ?? PRICING["claude-opus-4-6"];

    const inputCost = ((inputTokens - cacheReadTokens) * pricing.input) / 1_000_000;
    const outputCost = (outputTokens * pricing.output) / 1_000_000;
    const cacheCost = (cacheReadTokens * pricing.cacheRead) / 1_000_000;

    return inputCost + outputCost + cacheCost;
  }
}

/** 建立 Claude 客戶端 */
export function createClaudeClient(
  config?: ClaudeClientConfig,
): ClaudeClient {
  return new ClaudeClient(config);
}
