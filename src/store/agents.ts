import { create } from "zustand";
import type { Agent } from "@/types/agent";

interface AgentState {
  agents: Record<string, Agent>;
  manifestDir: string | null;
  loaded: boolean;
  error: string | null;

  setAll: (list: Agent[]) => void;
  upsert: (agent: Agent) => void;
  remove: (id: string) => void;
  setManifestDir: (dir: string) => void;
  setError: (err: string | null) => void;
  setLoaded: (loaded: boolean) => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  agents: {},
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
      if (!s.agents[id]) return s;
      const next = { ...s.agents };
      delete next[id];
      return { agents: next };
    }),
  setManifestDir: (dir) => set(() => ({ manifestDir: dir })),
  setError: (err) => set(() => ({ error: err })),
  setLoaded: (loaded) => set(() => ({ loaded })),
}));
