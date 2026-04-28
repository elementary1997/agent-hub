import { create } from "zustand";
import type { Agent } from "@/types/agent";
import type { AgentEvent } from "@/lib/api";

const EVENT_BUFFER = 50;

export interface RecordedEvent extends AgentEvent {
  at: number;
}

interface AgentState {
  agents: Record<string, Agent>;
  events: Record<string, RecordedEvent[]>;
  manifestDir: string | null;
  loaded: boolean;
  error: string | null;

  setAll: (list: Agent[]) => void;
  upsert: (agent: Agent) => void;
  remove: (id: string) => void;
  pushEvent: (event: AgentEvent) => void;
  setManifestDir: (dir: string) => void;
  setError: (err: string | null) => void;
  setLoaded: (loaded: boolean) => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  agents: {},
  events: {},
  manifestDir: null,
  loaded: false,
  error: null,

  setAll: (list) =>
    set(() => ({
      agents: Object.fromEntries(list.map((a) => [a.manifest.id, a])),
    })),
  upsert: (agent) =>
    set((s) => ({
      agents: { ...s.agents, [agent.manifest.id]: agent },
    })),
  remove: (id) =>
    set((s) => {
      if (!s.agents[id] && !s.events[id]) return s;
      const nextAgents = { ...s.agents };
      delete nextAgents[id];
      const nextEvents = { ...s.events };
      delete nextEvents[id];
      return { agents: nextAgents, events: nextEvents };
    }),
  pushEvent: (event) =>
    set((s) => {
      const prev = s.events[event.agentId] ?? [];
      const next = [...prev, { ...event, at: Date.now() }];
      if (next.length > EVENT_BUFFER) next.splice(0, next.length - EVENT_BUFFER);
      return { events: { ...s.events, [event.agentId]: next } };
    }),
  setManifestDir: (dir) => set(() => ({ manifestDir: dir })),
  setError: (err) => set(() => ({ error: err })),
  setLoaded: (loaded) => set(() => ({ loaded })),
}));
