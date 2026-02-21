import assert from "node:assert/strict";
import test from "node:test";
import {
  validateChatMessageCount,
  validateChatSkillIds,
  validateChatTrigger,
  validateExecutionTarget,
  validateOptionalContent,
} from "../src/validate";

const TRIGGER_ERROR_RE = /trigger must be one of/;
const SKILL_FORMAT_ERROR_RE = /Each skill ID must match/;
const SKILL_TYPE_ERROR_RE = /skill_ids must be an array of strings/;
const SKILL_COUNT_ERROR_RE = /skill_ids supports at most 12 entries/;
const MESSAGE_COUNT_ERROR_RE = /messages supports at most 200 items/;
const EXECUTION_TARGET_ERROR_RE = /execution_target must be/;
const EMPTY_CONTENT_ERROR_RE = /Content must not be empty/;

test("validateChatTrigger defaults to submit-message", () => {
  assert.equal(validateChatTrigger(undefined), "submit-message");
  assert.equal(validateChatTrigger(null), "submit-message");
});

test("validateChatTrigger accepts regenerate-message and rejects unknown values", () => {
  assert.equal(validateChatTrigger("regenerate-message"), "regenerate-message");

  assert.throws(() => validateChatTrigger("resume-stream"), TRIGGER_ERROR_RE);
});

test("validateChatSkillIds trims valid values and rejects invalid ids", () => {
  assert.deepEqual(validateChatSkillIds([" tool-first ", "code-assistant"]), [
    "tool-first",
    "code-assistant",
  ]);

  assert.throws(
    () => validateChatSkillIds(["Tool-First"]),
    SKILL_FORMAT_ERROR_RE
  );
  assert.throws(
    () => validateChatSkillIds(["tool first"]),
    SKILL_FORMAT_ERROR_RE
  );
});

test("validateChatSkillIds enforces type and max size", () => {
  assert.throws(() => validateChatSkillIds("tool-first"), SKILL_TYPE_ERROR_RE);
  assert.throws(() => validateChatSkillIds([123]), SKILL_TYPE_ERROR_RE);

  const tooManySkills = Array.from({ length: 13 }, () => "tool-first");
  assert.throws(
    () => validateChatSkillIds(tooManySkills),
    SKILL_COUNT_ERROR_RE
  );
});

test("validateChatMessageCount enforces upper bound", () => {
  validateChatMessageCount(200);
  assert.throws(() => validateChatMessageCount(201), MESSAGE_COUNT_ERROR_RE);
});

test("validateExecutionTarget canonicalizes legacy default to sandbox", () => {
  assert.equal(validateExecutionTarget("sandbox"), "sandbox");
  assert.equal(validateExecutionTarget("default"), "sandbox");
  assert.throws(
    () => validateExecutionTarget("host"),
    EXECUTION_TARGET_ERROR_RE
  );
});

test("validateOptionalContent preserves undefined and delegates validation", () => {
  assert.equal(validateOptionalContent(undefined), undefined);
  assert.equal(validateOptionalContent(null), undefined);
  assert.equal(validateOptionalContent("Hello"), "Hello");
  assert.throws(() => validateOptionalContent(" "), EMPTY_CONTENT_ERROR_RE);
});
