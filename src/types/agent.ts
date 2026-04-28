/**
 * Mirrors PROTOCOL.md v0.1. Mocked for v0.1.0 of the hub —
 * real registry / HTTP client lands in a follow-up commit.
 */

export type AgentKind = "ai" | "utility" | "service";
export type AgentLifecycle = "managed" | "standalone";
export type AgentStatus = "running" | "busy" | "idle" | "error" | "offline";

export interface AgentManifest {
  id: string;
  name: string;
  version: string;
  kind: AgentKind;
  endpoint: string;
  lifecycle: AgentLifecycle;
  executable?: string;
  icon?: string;
  tagline?: string;
  tags?: string[];
  accent?: string;
  ai?: {
    supports_streaming?: boolean;
    supports_tools?: boolean;
    supports_attachments?: ("image" | "audio" | "pdf")[];
    models?: string[];
    default_model?: string;
    system_prompt_editable?: boolean;
    max_input_tokens?: number;
  };
}

export interface AgentRuntime {
  status: AgentStatus;
  busy: boolean;
  lastEventAt: string | null;
  uptimeSec: number;
  message?: string;
}

export interface Agent {
  manifest: AgentManifest;
  runtime: AgentRuntime;
}
