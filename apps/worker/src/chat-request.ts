import { safeValidateUIMessages, type UIMessage } from "ai";
import { HTTPException } from "hono/http-exception";
import { isChatSkillId, type ChatSkillId } from "./chat-skills";
import {
  type ChatRequestTrigger,
  validateChatMessageCount,
  validateChatSkillIds,
  validateChatTrigger,
  validateOptionalContent,
} from "./validate";

export interface NormalizedChatRequest {
  content?: string;
  trigger: ChatRequestTrigger;
  skillIds: ChatSkillId[];
  messages?: UIMessage[];
}

export async function normalizeChatRequest(
  body: Record<string, unknown>
): Promise<NormalizedChatRequest> {
  const content = validateOptionalContent(body.content);
  const trigger = validateChatTrigger(body.trigger);
  const requestedSkillIds = validateChatSkillIds(body.skill_ids);
  const skillIds = requestedSkillIds.filter(isChatSkillId);
  const unknownSkillIds = requestedSkillIds.filter((id) => !isChatSkillId(id));
  if (unknownSkillIds.length > 0) {
    throw new HTTPException(400, {
      message: `Unknown skill_ids: ${unknownSkillIds.join(", ")}`,
    });
  }

  let messages: UIMessage[] | undefined;
  if (body.messages !== undefined) {
    const parsed = await safeValidateUIMessages({ messages: body.messages });
    if (!parsed.success) {
      throw new HTTPException(400, {
        message: `Invalid messages payload: ${parsed.error.message}`,
      });
    }
    validateChatMessageCount(parsed.data.length);
    messages = parsed.data;
  }

  if (!(messages || content)) {
    throw new HTTPException(400, {
      message: "Provide either messages or content",
    });
  }

  return { content, trigger, skillIds, messages };
}
