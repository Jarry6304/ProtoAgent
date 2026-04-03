/**
 * 技能發現與載入機制 — Skill Discovery & Progressive Disclosure
 *
 * 對應規格：
 * - Teammate + Skills spec: 第二層 程序化知識 (Capability Layer)
 * - Architecture spec: §5.6 Agent Skills 程序性知識層
 *
 * 漸進式揭露：技能按需載入，MEMORY.md 中僅存放目錄索引
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SkillModule, SkillTrigger } from "../types/index.js";

/** 技能目錄根路徑 */
const SKILLS_DIR = join(process.cwd(), "skills");

/** 預定義的技能註冊表 */
const SKILL_REGISTRY: Array<{
  id: string;
  name: string;
  fileName: string;
  description: string;
  trigger: SkillTrigger;
}> = [
  {
    id: "skill_cache_opt",
    name: "快取經濟學優化",
    fileName: "skill_cache_opt.md",
    description: "快取經濟學、14 種快取破壞向量追蹤與防護",
    trigger: {
      keywords: [
        "快取",
        "cache",
        "system prompt",
        "系統提示詞",
        "token 成本",
        "省錢",
      ],
      description: "當討論系統提示詞設計時",
    },
  },
  {
    id: "skill_security",
    name: "安全縱深防禦",
    fileName: "skill_security.md",
    description: "四層安全縱深、bashSecurity 25+ 驗證器",
    trigger: {
      keywords: [
        "安全",
        "security",
        "shell",
        "權限",
        "permission",
        "沙箱",
        "sandbox",
      ],
      description: "當涉及 Shell 指令或權限設計時",
    },
  },
  {
    id: "skill_memory_rem",
    name: "三層記憶與做夢機制",
    fileName: "skill_memory_rem.md",
    description: "三層記憶架構、autoDream 做夢機制",
    trigger: {
      keywords: [
        "記憶",
        "memory",
        "MEMORY.md",
        "做夢",
        "dream",
        "整合",
        "consolidate",
      ],
      description: "當討論長效記憶與資料整合時",
    },
  },
  {
    id: "skill_agentic_loop",
    name: "QueryEngine 推理迴圈",
    fileName: "skill_agentic_loop.md",
    description: "QueryEngine 推理迴圈、五步預處理管線",
    trigger: {
      keywords: [
        "迴圈",
        "loop",
        "壓縮",
        "compact",
        "預處理",
        "pipeline",
        "效率",
      ],
      description: "當討論 Agent 執行效率與自動壓縮時",
    },
  },
];

/** 技能載入器 */
export class SkillLoader {
  private skills: Map<string, SkillModule> = new Map();

  constructor() {
    this.initializeRegistry();
  }

  /** 初始化技能註冊表（僅載入元資料，不載入內容） */
  private initializeRegistry(): void {
    for (const entry of SKILL_REGISTRY) {
      this.skills.set(entry.id, {
        id: entry.id,
        name: entry.name,
        filePath: join(SKILLS_DIR, entry.fileName),
        description: entry.description,
        trigger: entry.trigger,
        loaded: false,
      });
    }
  }

  /** 根據使用者輸入搜尋相關技能（ToolSearchTool 等效實作） */
  searchSkills(query: string): SkillModule[] {
    const queryLower = query.toLowerCase();
    const results: Array<{ skill: SkillModule; score: number }> = [];

    for (const skill of this.skills.values()) {
      let score = 0;

      // 關鍵字匹配
      for (const keyword of skill.trigger.keywords) {
        if (queryLower.includes(keyword.toLowerCase())) {
          score += 10;
        }
      }

      // 名稱模糊匹配
      if (skill.name.toLowerCase().includes(queryLower)) {
        score += 5;
      }

      // 描述模糊匹配
      if (skill.description.toLowerCase().includes(queryLower)) {
        score += 3;
      }

      if (score > 0) {
        results.push({ skill, score });
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .map((r) => r.skill);
  }

  /** 按需載入技能內容（延遲載入） */
  loadSkill(skillId: string): SkillModule | null {
    const skill = this.skills.get(skillId);
    if (!skill) return null;

    if (skill.loaded && skill.content) return skill;

    if (!existsSync(skill.filePath)) {
      console.error(`技能檔案不存在: ${skill.filePath}`);
      return null;
    }

    skill.content = readFileSync(skill.filePath, "utf-8");
    skill.loaded = true;
    this.skills.set(skillId, skill);
    return skill;
  }

  /** 卸載技能（釋放上下文空間） */
  unloadSkill(skillId: string): boolean {
    const skill = this.skills.get(skillId);
    if (!skill) return false;

    skill.content = undefined;
    skill.loaded = false;
    this.skills.set(skillId, skill);
    return true;
  }

  /** 取得所有技能清單（含載入狀態） */
  listSkills(): SkillModule[] {
    return Array.from(this.skills.values());
  }

  /** 取得已載入的技能 */
  getLoadedSkills(): SkillModule[] {
    return Array.from(this.skills.values()).filter((s) => s.loaded);
  }

  /** 自動偵測並載入相關技能 */
  autoDetectAndLoad(userInput: string): SkillModule[] {
    const matches = this.searchSkills(userInput);
    const loaded: SkillModule[] = [];

    for (const match of matches) {
      if (!match.loaded) {
        const result = this.loadSkill(match.id);
        if (result) loaded.push(result);
      }
    }

    return loaded;
  }
}

/** 建立技能載入器實例 */
export function createSkillLoader(): SkillLoader {
  return new SkillLoader();
}
