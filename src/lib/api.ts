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
