/**
 * 工具系統抽象層
 *
 * 對應規格：
 * - Architecture spec: §5 Tool System 模組化能力擴展架構
 *
 * 核心分離原則：「模型決定嘗試什麼，工具系統決定允許什麼」
 * 工具間零共享狀態，所有協作通過 LLM 推理迴圈中介
 */

import type { PermissionLevel, Tool, ToolResult } from "../types/index.js";

/** 工具輸出上限（字元） */
const OUTPUT_LIMITS: Record<string, number> = {
  BashTool: 30_000,
  GrepTool: 20_000,
  DEFAULT: 50_000,
};

/** 截斷工具輸出 */
function truncateOutput(toolName: string, output: string): string {
  const limit = OUTPUT_LIMITS[toolName] ?? OUTPUT_LIMITS.DEFAULT;
  if (output.length <= limit) return output;
  return (
    output.slice(0, limit) +
    `\n\n[截斷] 輸出超過 ${limit} 字元上限，已截斷。完整結果已持久化。`
  );
}

/** 工具註冊表 */
export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private deferredTools: Set<string> = new Set();

  /** 註冊工具 */
  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
    if (tool.shouldDefer) {
      this.deferredTools.add(tool.name);
    }
  }

  /** 取得工具（漸進式發現：延遲載入的工具需先搜尋） */
  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /** 搜尋工具（ToolSearchTool 等效） */
  searchTools(query: string): Tool[] {
    const queryLower = query.toLowerCase();
    return Array.from(this.tools.values()).filter(
      (t) =>
        t.name.toLowerCase().includes(queryLower) ||
        t.description.toLowerCase().includes(queryLower),
    );
  }

  /** 列出可見工具（排除延遲載入的） */
  listVisible(): Tool[] {
    return Array.from(this.tools.values()).filter(
      (t) => !this.deferredTools.has(t.name),
    );
  }

  /** 列出所有工具（含延遲載入） */
  listAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  /** 取得工具名稱列表（按字母排序，穩定快取） */
  getToolNames(): string[] {
    return Array.from(this.tools.keys()).sort();
  }
}

/** 權限閘門 */
export class PermissionGate {
  private allowList: Set<string> = new Set();
  private denyList: Set<string> = new Set();

  /** 新增允許規則 */
  allow(pattern: string): void {
    this.allowList.add(pattern);
  }

  /** 新增拒絕規則 */
  deny(pattern: string): void {
    this.denyList.add(pattern);
  }

  /** 檢查權限（Fail-Closed 設計） */
  check(
    toolName: string,
    permissionLevel: PermissionLevel,
  ): "allow" | "ask" | "deny" {
    // Deny list 優先
    if (this.denyList.has(toolName)) return "deny";

    // Allow list
    if (this.allowList.has(toolName)) return "allow";

    // 依權限等級判斷
    switch (permissionLevel) {
      case "readonly":
        return "allow";
      case "write":
        return "ask";
      case "dangerous":
        return "deny"; // Fail-Closed: 危險操作預設拒絕
    }
  }
}

/** 工具執行器（序列化寫入、並行讀取） */
export class ToolExecutor {
  private writeLock = false;
  private readonly maxParallelReads = 10;
  private activeReads = 0;

  /** 執行工具 */
  async execute(tool: Tool, input: Record<string, unknown>): Promise<ToolResult> {
    const isReadonly = tool.permissionLevel === "readonly";

    if (isReadonly && tool.isParallelizable) {
      return this.executeParallel(tool, input);
    }
    return this.executeSerial(tool, input);
  }

  /** 並行執行（唯讀工具） */
  private async executeParallel(
    tool: Tool,
    input: Record<string, unknown>,
  ): Promise<ToolResult> {
    if (this.activeReads >= this.maxParallelReads) {
      return {
        success: false,
        output: "",
        error: `並行讀取數已達上限 (${this.maxParallelReads})`,
      };
    }

    this.activeReads++;
    try {
      const result = await tool.execute(input);
      result.output = truncateOutput(tool.name, result.output);
      return result;
    } finally {
      this.activeReads--;
    }
  }

  /** 序列化執行（寫入工具） */
  private async executeSerial(
    tool: Tool,
    input: Record<string, unknown>,
  ): Promise<ToolResult> {
    // 等待寫入鎖
    while (this.writeLock) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    this.writeLock = true;
    try {
      const result = await tool.execute(input);
      result.output = truncateOutput(tool.name, result.output);
      return result;
    } finally {
      this.writeLock = false;
    }
  }
}

/** 建立工具註冊表 */
export function createToolRegistry(): ToolRegistry {
  return new ToolRegistry();
}

/** 建立權限閘門 */
export function createPermissionGate(): PermissionGate {
  return new PermissionGate();
}

/** 建立工具執行器 */
export function createToolExecutor(): ToolExecutor {
  return new ToolExecutor();
}
