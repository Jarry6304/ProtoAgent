/**
 * 驗證管線與斷路器
 *
 * 對應規格：
 * - Teammate + Skills spec: 三、1.「不信任記憶」驗證流程
 * - Teammate + Skills spec: 補充 2. 自我修正與斷路器
 * - Architecture spec: §8.2「不信任自己的記憶」原則
 */

import type { CircuitState, VerificationResult } from "../types/index.js";

/** 斷路器配置 */
const MAX_CONSECUTIVE_FAILURES = 3;

/** 驗證步驟回呼型別 */
type VerifyFunction = (assumption: string) => Promise<{
  verified: boolean;
  evidence?: string;
}>;

/** 斷路器 — 防止無限失敗迴圈 */
export class CircuitBreaker {
  private state: CircuitState = "closed";
  private consecutiveFailures = 0;
  private lastFailureTime?: Date;

  /** 取得當前狀態 */
  getState(): CircuitState {
    return this.state;
  }

  /** 取得連續失敗次數 */
  getFailureCount(): number {
    return this.consecutiveFailures;
  }

  /** 記錄成功 — 重置斷路器 */
  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.state = "closed";
  }

  /** 記錄失敗 — 可能觸發斷路 */
  recordFailure(): CircuitState {
    this.consecutiveFailures++;
    this.lastFailureTime = new Date();

    if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      this.state = "open";
    }

    return this.state;
  }

  /** 嘗試半開（允許一次試探性請求） */
  tryHalfOpen(): boolean {
    if (this.state !== "open") return false;

    // 開路後至少等待 30 秒才允許試探
    if (this.lastFailureTime) {
      const elapsed = Date.now() - this.lastFailureTime.getTime();
      if (elapsed < 30_000) return false;
    }

    this.state = "half-open";
    return true;
  }

  /** 是否需要人工介入 */
  requiresHumanIntervention(): boolean {
    return this.state === "open";
  }

  /** 重置（僅供人工介入後呼叫） */
  reset(): void {
    this.state = "closed";
    this.consecutiveFailures = 0;
    this.lastFailureTime = undefined;
  }
}

/** 驗證管線 — 實作「不信任記憶」流程 */
export class VerificationPipeline {
  private circuitBreaker: CircuitBreaker;
  private history: VerificationResult[] = [];

  constructor(circuitBreaker?: CircuitBreaker) {
    this.circuitBreaker = circuitBreaker ?? new CircuitBreaker();
  }

  /** 取得斷路器實例 */
  getCircuitBreaker(): CircuitBreaker {
    return this.circuitBreaker;
  }

  /** 取得驗證歷史 */
  getHistory(): VerificationResult[] {
    return [...this.history];
  }

  /**
   * 執行完整驗證流程
   *
   * Step 1: 聲明假設
   * Step 2: 執行驗證（調用工具檢查）
   * Step 3: 更新記憶（成功後才寫入）
   */
  async verify(
    assumption: string,
    verifyFn: VerifyFunction,
  ): Promise<VerificationResult> {
    // 檢查斷路器狀態
    if (this.circuitBreaker.requiresHumanIntervention()) {
      return {
        step: "assume",
        assumption,
        verified: false,
        observation: "斷路器已開路：連續驗證失敗已達上限，需要人工介入",
      };
    }

    // Step 1: 聲明假設
    const result: VerificationResult = {
      step: "assume",
      assumption,
      verified: false,
    };

    // Step 2: 執行驗證
    result.step = "verify";
    const verification = await verifyFn(assumption);
    result.verified = verification.verified;
    result.evidence = verification.evidence;

    if (!verification.verified) {
      // 驗證失敗 — 觸發反思循環
      const circuitState = this.circuitBreaker.recordFailure();
      result.observation = this.buildObservation(
        assumption,
        verification.evidence,
        circuitState,
      );
    } else {
      // 驗證成功 — 重置斷路器
      this.circuitBreaker.recordSuccess();
      result.step = "update";
    }

    this.history.push(result);
    return result;
  }

  /**
   * 反思循環 — 驗證失敗時的處理
   *
   * Step A: 產生 Observation 區塊記錄不一致點
   * Step B: 更新 Plan 狀態（由呼叫者處理）
   * Step C: 評估是否需要切換推理深度
   */
  private buildObservation(
    assumption: string,
    evidence: string | undefined,
    circuitState: CircuitState,
  ): string {
    const parts = [
      `[Observation] 假設「${assumption}」與事實不符。`,
    ];

    if (evidence) {
      parts.push(`[Evidence] ${evidence}`);
    }

    parts.push(
      `[Circuit] 斷路器狀態: ${circuitState}，連續失敗: ${this.circuitBreaker.getFailureCount()}/${MAX_CONSECUTIVE_FAILURES}`,
    );

    if (circuitState === "open") {
      parts.push("[Action] 已達失敗上限，強制進入人工介入模式。");
    } else {
      parts.push("[Action] 建議重新檢視假設前提，考慮切換推理策略。");
    }

    return parts.join("\n");
  }
}

/** 建立驗證管線 */
export function createVerificationPipeline(): VerificationPipeline {
  return new VerificationPipeline();
}

/** 建立斷路器 */
export function createCircuitBreaker(): CircuitBreaker {
  return new CircuitBreaker();
}
