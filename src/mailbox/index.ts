/**
 * 信箱通訊機制 — Mailbox Pattern
 *
 * 對應規格：
 * - Teammate + Skills spec: 通訊機制（信箱模式）
 * - Architecture spec: §7.3 Teammate Mode 基於檔案的信箱通訊
 *
 * 路徑：~/.claude/teams/{teamName}/inboxes/{agentName}.json
 * 格式：追加式 JSON，支援 P2P 訊息交換與狀態更新
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MailboxMessage } from "../types/index.js";

/** 信箱根目錄 */
const TEAMS_BASE_DIR = join(
  process.env.HOME ?? "~",
  ".claude",
  "teams",
);

/** 產生唯一訊息 ID */
function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 信箱管理器 */
export class Mailbox {
  private readonly inboxPath: string;
  private readonly agentName: string;
  private readonly teamName: string;

  constructor(teamName: string, agentName: string) {
    this.teamName = teamName;
    this.agentName = agentName;
    this.inboxPath = join(TEAMS_BASE_DIR, teamName, "inboxes");
    this.ensureDirectory();
  }

  /** 確保信箱目錄存在 */
  private ensureDirectory(): void {
    if (!existsSync(this.inboxPath)) {
      mkdirSync(this.inboxPath, { recursive: true });
    }
  }

  /** 取得指定 agent 的信箱檔案路徑 */
  private getInboxFile(agentName: string): string {
    return join(this.inboxPath, `${agentName}.json`);
  }

  /** 讀取信箱中的所有訊息 */
  private readInbox(agentName: string): MailboxMessage[] {
    const filePath = this.getInboxFile(agentName);
    if (!existsSync(filePath)) return [];
    const content = readFileSync(filePath, "utf-8");
    if (!content.trim()) return [];
    return JSON.parse(content) as MailboxMessage[];
  }

  /** 寫入訊息到指定 agent 的信箱 */
  private writeToInbox(
    agentName: string,
    messages: MailboxMessage[],
  ): void {
    const filePath = this.getInboxFile(agentName);
    writeFileSync(filePath, JSON.stringify(messages, null, 2), "utf-8");
  }

  /** 發送直接訊息給指定 teammate */
  send(recipient: string, text: string, summary?: string): MailboxMessage {
    const message: MailboxMessage = {
      id: generateMessageId(),
      sender: this.agentName,
      recipient,
      text,
      timestamp: new Date().toISOString(),
      read: false,
      summary,
    };

    const inbox = this.readInbox(recipient);
    inbox.push(message);
    this.writeToInbox(recipient, inbox);
    return message;
  }

  /** 廣播訊息給團隊所有成員 */
  broadcast(text: string, summary?: string): MailboxMessage {
    const message: MailboxMessage = {
      id: generateMessageId(),
      sender: this.agentName,
      recipient: "broadcast",
      text,
      timestamp: new Date().toISOString(),
      read: false,
      summary,
    };

    // 廣播訊息寫入共享的 broadcast 信箱
    const inbox = this.readInbox("_broadcast");
    inbox.push(message);
    this.writeToInbox("_broadcast", inbox);
    return message;
  }

  /** 讀取自己的未讀訊息 */
  receiveUnread(): MailboxMessage[] {
    const directMessages = this.readInbox(this.agentName).filter(
      (m) => !m.read,
    );
    const broadcasts = this.readInbox("_broadcast").filter(
      (m) => !m.read && m.sender !== this.agentName,
    );
    return [...directMessages, ...broadcasts];
  }

  /** 標記訊息為已讀 */
  markAsRead(messageIds: string[]): void {
    const idSet = new Set(messageIds);

    // 標記直接訊息
    const directMessages = this.readInbox(this.agentName);
    for (const msg of directMessages) {
      if (idSet.has(msg.id)) msg.read = true;
    }
    this.writeToInbox(this.agentName, directMessages);

    // 標記廣播訊息
    const broadcasts = this.readInbox("_broadcast");
    for (const msg of broadcasts) {
      if (idSet.has(msg.id)) msg.read = true;
    }
    this.writeToInbox("_broadcast", broadcasts);
  }

  /** 取得信箱統計 */
  getStats(): { total: number; unread: number } {
    const direct = this.readInbox(this.agentName);
    const broadcasts = this.readInbox("_broadcast").filter(
      (m) => m.sender !== this.agentName,
    );
    const all = [...direct, ...broadcasts];
    return {
      total: all.length,
      unread: all.filter((m) => !m.read).length,
    };
  }
}

/** 建立信箱實例的工廠函數 */
export function createMailbox(
  teamName: string,
  agentName: string,
): Mailbox {
  return new Mailbox(teamName, agentName);
}
