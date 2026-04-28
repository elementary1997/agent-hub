import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  ChatConversation,
  ChatStreamEvent,
  ContentPart,
} from "@/types/chat";

export function listConversations(agentId: string): Promise<ChatConversation[]> {
  return invoke<ChatConversation[]>("chat_list_conversations", { agentId });
}

export function createConversation(
  agentId: string,
  body: { title?: string; system_prompt?: string } = {},
): Promise<ChatConversation> {
  return invoke<ChatConversation>("chat_create_conversation", { agentId, body });
}

export function getConversation(
  agentId: string,
  id: string,
): Promise<ChatConversation> {
  return invoke<ChatConversation>("chat_get_conversation", { agentId, id });
}

export function deleteConversation(agentId: string, id: string): Promise<void> {
  return invoke("chat_delete_conversation", { agentId, id });
}

export function patchConversation(
  agentId: string,
  id: string,
  body: { title?: string; system_prompt?: string },
): Promise<ChatConversation> {
  return invoke<ChatConversation>("chat_patch_conversation", { agentId, id, body });
}

export function sendMessage(opts: {
  agentId: string;
  conversationId: string;
  requestId: string;
  content: ContentPart[];
  model?: string;
}): Promise<void> {
  return invoke("chat_send_message", {
    agentId: opts.agentId,
    conversationId: opts.conversationId,
    requestId: opts.requestId,
    body: { content: opts.content, model: opts.model },
  });
}

export function onChatStream(
  cb: (e: ChatStreamEvent) => void,
): Promise<UnlistenFn> {
  return listen<ChatStreamEvent>("chat-stream", (e) => cb(e.payload));
}
