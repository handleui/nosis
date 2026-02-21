import assert from "node:assert/strict";
import test from "node:test";
import { normalizeChatRequest } from "../src/chat-request";

const UNKNOWN_SKILLS_ERROR_RE = /Unknown skill_ids: custom-skill/;
const INVALID_MESSAGES_ERROR_RE = /Invalid messages payload:/;
const MESSAGE_COUNT_ERROR_RE = /messages supports at most 200 items/;
const EMPTY_INPUT_ERROR_RE = /Provide either messages or content/;

test("normalizes content-only chat payloads with default trigger", async () => {
  const request = await normalizeChatRequest({ content: "Review this patch" });

  assert.equal(request.content, "Review this patch");
  assert.equal(request.trigger, "submit-message");
  assert.deepEqual(request.skillIds, []);
  assert.equal(request.messages, undefined);
});

test("normalizes message-based payloads and known skill IDs", async () => {
  const request = await normalizeChatRequest({
    trigger: "regenerate-message",
    skill_ids: [" tool-first ", "code-assistant"],
    messages: [
      {
        id: "m-user",
        role: "user",
        parts: [{ type: "text", text: "Help me write tests" }],
      },
    ],
  });

  assert.equal(request.content, undefined);
  assert.equal(request.trigger, "regenerate-message");
  assert.deepEqual(request.skillIds, ["tool-first", "code-assistant"]);
  assert.equal(request.messages?.length, 1);
});

test("rejects unknown but well-formed skill IDs", async () => {
  await assert.rejects(
    () =>
      normalizeChatRequest({
        content: "hello",
        skill_ids: ["tool-first", "custom-skill"],
      }),
    UNKNOWN_SKILLS_ERROR_RE
  );
});

test("rejects invalid messages payload shapes", async () => {
  await assert.rejects(
    () =>
      normalizeChatRequest({
        messages: "not-an-array",
      }),
    INVALID_MESSAGES_ERROR_RE
  );
});

test("rejects oversized chat history payloads", async () => {
  const messages = Array.from({ length: 201 }, (_, index) => ({
    id: `m-${index}`,
    role: "user" as const,
    parts: [{ type: "text" as const, text: `message ${index}` }],
  }));

  await assert.rejects(
    () =>
      normalizeChatRequest({
        messages,
      }),
    MESSAGE_COUNT_ERROR_RE
  );
});

test("rejects requests that omit both content and messages", async () => {
  await assert.rejects(() => normalizeChatRequest({}), EMPTY_INPUT_ERROR_RE);
});
