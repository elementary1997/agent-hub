/**
 * Mirrors PROTOCOL.md §4 — AI conversation shapes.
 *
 * The hub is a passthrough — agents own canonical state, the hub just
 * caches it locally for snappy navigation.
 */

export interface ContentPartText {
  type: "text";
  text: string;
}

export interface ContentPartImage {
  type: "image";
  data: string; // data: URI
}

export interface ContentPartAttachmentRef {
  type: "image" | "audio" | "pdf";
  attachment_id: string;
  name: string;
  mime: string;
  size_bytes: number;
}

export type ContentPart = ContentPartText | ContentPartImage | ContentPartAttachmentRef;

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: ContentPart[] | string;
  at?: string;
}

export interface ChatConversation {
  id: string;
  title?: string | null;
  system_prompt?: string | null;
  messages: ChatMessage[];
  updated_at?: string | null;
  message_count?: number | null;
}

export type ChatStreamEventType =
  | "start"
  | "delta"
  | "tool_call"
  | "tool_result"
  | "end"
  | "error";

export interface ChatStreamEvent {
  requestId: string;
  type: ChatStreamEventType | string;
  data: unknown;
}
