/**
 * 三層自我修復記憶系統
 *
 * 對應規格：
 * - Teammate + Skills spec: 第三層 記憶系統整合
 * - Architecture spec: §8 Memory System 三層自我修復記憶
 *
 * Layer 1: MEMORY.md（索引層）— 始終載入上下文
 * Layer 2: Topic Files（詳細層）— 按需拉取
 * Layer 3: Logs（考古層）— 僅供 grep 搜尋
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type {
  LogEntry,
  MemoryIndex,
  MemoryType,
  TopicFile,
} from "../types/index.js";

/** 記憶系統路徑 */
const MEMORY_DIR = join(process.cwd(), "memory");
const MEMORY_INDEX_FILE = join(MEMORY_DIR, "MEMORY.md");
const LOGS_DIR = join(MEMORY_DIR, "logs");

/** 記憶管理器 */
export class MemoryManager {
  private indexCache: MemoryIndex[] = [];
  private accessedFiles: TopicFile[] = [];
  private readonly maxRecentFiles = 5; // 壓縮時保留最近 5 個存取檔案

  constructor() {
    this.ensureDirectories();
  }

  /** 確保目錄結構存在 */
  private ensureDirectories(): void {
    for (const dir of [MEMORY_DIR, LOGS_DIR]) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
  }

  // ============================================================
  // Layer 1: MEMORY.md 索引層
  // ============================================================

  /** 載入 MEMORY.md 索引（始終載入上下文） */
  loadIndex(): string {
    if (!existsSync(MEMORY_INDEX_FILE)) return "";
    return readFileSync(MEMORY_INDEX_FILE, "utf-8");
  }

  /** 新增記憶索引項目 */
  addIndexEntry(entry: MemoryIndex): void {
    this.indexCache.push(entry);
  }

  /** 取得索引快取 */
  getIndexEntries(): MemoryIndex[] {
    return [...this.indexCache];
  }

  /** 根據類型查詢索引 */
  queryByType(type: MemoryType): MemoryIndex[] {
    return this.indexCache.filter((e) => e.type === type);
  }

  // ============================================================
  // Layer 2: Topic Files 詳細層
  // ============================================================

  /** 按需讀取主題檔案 */
  readTopicFile(relativePath: string): string | null {
    const fullPath = join(MEMORY_DIR, relativePath);
    if (!existsSync(fullPath)) return null;

    const content = readFileSync(fullPath, "utf-8");

    // 記錄存取歷史（用於壓縮重注入）
    this.trackFileAccess(relativePath);

    return content;
  }

  /** 寫入主題檔案（成功後才寫入原則） */
  writeTopicFile(relativePath: string, content: string): boolean {
    const fullPath = join(MEMORY_DIR, relativePath);
    writeFileSync(fullPath, content, "utf-8");

    // 驗證寫入成功
    if (existsSync(fullPath)) {
      this.trackFileAccess(relativePath);
      return true;
    }
    return false;
  }

  /** 追蹤檔案存取記錄（保留最近 N 個） */
  private trackFileAccess(path: string): void {
    const existing = this.accessedFiles.findIndex((f) => f.path === path);
    if (existing !== -1) {
      this.accessedFiles.splice(existing, 1);
    }

    this.accessedFiles.push({
      path,
      title: path.replace(/\.md$/, ""),
      lastAccessed: new Date().toISOString(),
    });

    // 保留最近的 N 個
    if (this.accessedFiles.length > this.maxRecentFiles) {
      this.accessedFiles = this.accessedFiles.slice(-this.maxRecentFiles);
    }
  }

  /** 取得最近存取的檔案（用於壓縮重注入） */
  getRecentFiles(): TopicFile[] {
    return [...this.accessedFiles];
  }

  // ============================================================
  // Layer 3: Logs 考古層（JSONL 格式）
  // ============================================================

  /** 取得當前 session 的日誌檔案路徑 */
  private getLogFile(sessionId: string): string {
    return join(LOGS_DIR, `${sessionId}.jsonl`);
  }

  /** 追加日誌（僅追加，不可修改） */
  appendLog(sessionId: string, entry: Omit<LogEntry, "timestamp" | "sessionId">): void {
    const logEntry: LogEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
      sessionId,
    };

    const logFile = this.getLogFile(sessionId);
    appendFileSync(logFile, JSON.stringify(logEntry) + "\n", "utf-8");
  }

  /** 搜尋日誌（僅透過關鍵字，非語意搜尋） */
  searchLogs(sessionId: string, keyword: string): LogEntry[] {
    const logFile = this.getLogFile(sessionId);
    if (!existsSync(logFile)) return [];

    const content = readFileSync(logFile, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);

    return lines
      .map((line) => JSON.parse(line) as LogEntry)
      .filter(
        (entry) =>
          entry.content.includes(keyword) ||
          JSON.stringify(entry.metadata ?? {}).includes(keyword),
      );
  }
}

/** 建立記憶管理器實例 */
export function createMemoryManager(): MemoryManager {
  return new MemoryManager();
}
