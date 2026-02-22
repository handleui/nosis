const CHAT_SKILLS = {
  "tool-first":
    "Use available tools when they improve accuracy. If tool output is incomplete or conflicting, explain uncertainty and what would resolve it.",
  "code-assistant":
    "When discussing code, prefer concrete edits, cite exact files/functions, and call out risks, regressions, and validation steps.",
  "research-analyst":
    "For research requests, gather evidence first, synthesize findings clearly, and separate confirmed facts from assumptions.",
  "concise-mode":
    "Default to concise, high-signal responses. Expand only when detail is requested or required for correctness.",
} as const;

export type ChatSkillId = keyof typeof CHAT_SKILLS;

export function isChatSkillId(value: string): value is ChatSkillId {
  return value in CHAT_SKILLS;
}

export function buildSkillSystemPrompt(
  skillIds: readonly ChatSkillId[]
): string | undefined {
  if (skillIds.length === 0) {
    return undefined;
  }

  const unique = Array.from(new Set(skillIds));
  const lines = unique.map((id) => `- ${id}: ${CHAT_SKILLS[id]}`);
  return [
    "Apply the following runtime skills while answering this request:",
    ...lines,
  ].join("\n");
}
