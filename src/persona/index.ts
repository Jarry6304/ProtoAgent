/**
 * Persona 系統 — Arch-Verifier 角色定義與系統提示詞動態組裝
 *
 * 對應規格：
 * - Teammate + Skills spec: 第一層 Persona 設置 (Agent Runtime)
 * - Architecture spec: §2.3 系統提示詞的動態組裝
 */

import type { PersonaConfig, SkillModule } from "../types/index.js";

/** 預設 Arch-Verifier 角色配置 */
export const DEFAULT_PERSONA: PersonaConfig = {
  name: "Arch-Verifier",
  role: "資深架構設計顧問",
  systemPrompt: "",
  teamName: "arch_consultant",
  skills: [
    "skill_cache_opt",
    "skill_security",
    "skill_memory_rem",
    "skill_agentic_loop",
  ],
};

/**
 * 系統提示詞動態組裝邊界
 * 穩定前半段積極快取，動態後半段每輪更新
 */
const SYSTEM_PROMPT_DYNAMIC_BOUNDARY = "--- DYNAMIC SECTION ---";

/** 組裝穩定的基礎 prompt（快取友好區段） */
function assembleStableSection(persona: PersonaConfig): string {
  return `# ${persona.name} — ${persona.role}

## 核心行為約束

你是一位具備「自我驗證」能力的資深架構師。你的核心理念是「省錢即架構」。

### 行為準則
1. **不信任記憶**：所有記憶內容視為 hint 而非 fact，行動前必須驗證
2. **快取破壞評估**：給出設計建議前，必須先評估「快取破壞風險」
3. **Fail-Closed 安全**：不確定時預設拒絕，寧可多問不可冒進
4. **成功後才寫入**：確認事實後，才將結論更新至記憶

### 驗證流程（每次建議必須觸發）
Step 1: 聲明假設 — 標註「基於現有記憶，這可能是…」
Step 2: 執行驗證 — 調用工具檢查對應的專案檔案（事實核查）
Step 3: 更新記憶 — 確認事實後，才將結論更新至 MEMORY.md

### 反思循環（驗證失敗時）
Step A: 產生 Observation 區塊記錄不一致點
Step B: 更新當前 Plan 狀態
Step C: 評估是否需要切換推理深度

### 斷路器
- 連續 3 次驗證失敗 → 強制進入「人工介入」模式
- 不可自行繞過此限制`;
}

/** 組裝動態區段（每輪更新） */
function assembleDynamicSection(
  loadedSkills: SkillModule[],
  memoryIndex: string,
  gitStatus?: string,
): string {
  const skillList = loadedSkills
    .filter((s) => s.loaded)
    .map((s) => `- [已載入] ${s.name}: ${s.description}`)
    .join("\n");

  const pendingSkills = loadedSkills
    .filter((s) => !s.loaded)
    .map((s) => `- [待載入] ${s.name}: ${s.description}`)
    .join("\n");

  return `
${SYSTEM_PROMPT_DYNAMIC_BOUNDARY}

## 當前載入的技能
${skillList || "(無)"}

## 可用但未載入的技能
${pendingSkills || "(無)"}

## 記憶索引摘要
${memoryIndex}

## 當前環境狀態
${gitStatus ?? "(未取得 Git 狀態)"}`;
}

/** 完整組裝系統提示詞 */
export function assembleSystemPrompt(
  persona: PersonaConfig,
  loadedSkills: SkillModule[],
  memoryIndex: string,
  gitStatus?: string,
): string {
  const stableSection = assembleStableSection(persona);
  const dynamicSection = assembleDynamicSection(
    loadedSkills,
    memoryIndex,
    gitStatus,
  );
  return `${stableSection}\n\n${dynamicSection}`;
}

/** 建立新的 Persona 配置 */
export function createPersona(
  overrides?: Partial<PersonaConfig>,
): PersonaConfig {
  return { ...DEFAULT_PERSONA, ...overrides, systemPrompt: "" };
}
