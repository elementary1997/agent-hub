import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Agent } from "@/types/agent";

export function listAgents(): Promise<Agent[]> {
  return invoke<Agent[]>("list_agents");
}

export function openNative(id: string): Promise<void> {
  return invoke("agent_open_native", { id });
}

export function quitAgent(id: string): Promise<void> {
  return invoke("agent_quit", { id });
}

export function startManagedAgent(id: string): Promise<void> {
  return invoke("agent_start", { id });
}

export function stopManagedAgent(id: string): Promise<void> {
  return invoke("agent_stop_managed", { id });
}

export function isManagedRunning(id: string): Promise<boolean> {
  return invoke<boolean>("agent_is_managed_running", { id });
}

export interface AgentLogLine {
  at: number;
  stream: "stdout" | "stderr" | "supervisor";
  text: string;
}

export function fetchAgentLogs(id: string): Promise<AgentLogLine[]> {
  return invoke<AgentLogLine[]>("agent_logs", { id });
}

export interface AgentConfigResponse {
  config: Record<string, unknown>;
  schema?: AgentConfigSchema;
}

export interface AgentConfigSchema {
  type?: string;
  properties?: Record<string, AgentConfigProperty>;
  required?: string[];
  title?: string;
  description?: string;
}

export interface AgentConfigProperty {
  type?: string;
  title?: string;
  description?: string;
  enum?: (string | number)[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  format?: string;
}

export function getAgentConfig(id: string): Promise<AgentConfigResponse> {
  return invoke<AgentConfigResponse>("agent_get_config", { id });
}

export function putAgentConfig(
  id: string,
  config: Record<string, unknown>,
): Promise<AgentConfigResponse> {
  return invoke<AgentConfigResponse>("agent_put_config", { id, config });
}

export interface AgentLogEvent {
  agentId: string;
  line: AgentLogLine;
}

export function onAgentLog(cb: (e: AgentLogEvent) => void): Promise<UnlistenFn> {
  return listen<AgentLogEvent>("agent-log", (e) => cb(e.payload));
}

export function agentsDir(): Promise<string> {
  return invoke<string>("agents_dir");
}

export function onAgentUpserted(cb: (a: Agent) => void): Promise<UnlistenFn> {
  return listen<Agent>("agent-upserted", (e) => cb(e.payload));
}

export function onAgentRemoved(cb: (id: string) => void): Promise<UnlistenFn> {
  return listen<string>("agent-removed", (e) => cb(e.payload));
}

export interface AgentEvent {
  agentId: string;
  type: string;
  data: unknown;
}

export function onAgentEvent(cb: (e: AgentEvent) => void): Promise<UnlistenFn> {
  return listen<AgentEvent>("agent-event", (e) => cb(e.payload));
}
