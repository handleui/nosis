import assert from "node:assert/strict";
import test from "node:test";
import { buildSkillSystemPrompt, isChatSkillId } from "../src/chat-skills";

const HEADER_RE = /Apply the following runtime skills/;
const TOOL_FIRST_RE = /- tool-first:/;
const CODE_ASSISTANT_RE = /- code-assistant:/;

test("isChatSkillId accepts known ids and rejects unknown ids", () => {
  assert.equal(isChatSkillId("tool-first"), true);
  assert.equal(isChatSkillId("code-assistant"), true);
  assert.equal(isChatSkillId("research-analyst"), true);
  assert.equal(isChatSkillId("concise-mode"), true);
  assert.equal(isChatSkillId("unknown-skill"), false);
});

test("buildSkillSystemPrompt returns undefined for no skills", () => {
  assert.equal(buildSkillSystemPrompt([]), undefined);
});

test("buildSkillSystemPrompt deduplicates repeated skills", () => {
  const prompt = buildSkillSystemPrompt([
    "tool-first",
    "code-assistant",
    "tool-first",
  ]);

  assert.ok(prompt);
  assert.match(prompt, HEADER_RE);
  assert.match(prompt, TOOL_FIRST_RE);
  assert.match(prompt, CODE_ASSISTANT_RE);
  assert.equal(
    prompt?.indexOf("- tool-first:"),
    prompt?.lastIndexOf("- tool-first:")
  );
});
