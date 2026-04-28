import type { Agent } from "@/types/agent";

/**
 * Placeholder data for v0.1.0 of the hub UI.
 * Replaced by the real registry HTTP client in v0.1.1.
 */
export const MOCK_AGENTS: Agent[] = [
  {
    manifest: {
      id: "easystt",
      name: "easySTT",
      version: "0.1.0",
      kind: "utility",
      endpoint: "http://127.0.0.1:8731",
      lifecycle: "standalone",
      tagline: "Voice-to-text injection",
      tags: ["productivity", "input"],
      accent: "#4c84ff",
    },
    runtime: {
      status: "running",
      busy: false,
      lastEventAt: new Date(Date.now() - 3 * 60_000).toISOString(),
      uptimeSec: 3421,
    },
  },
  {
    manifest: {
      id: "research",
      name: "Research AI",
      version: "0.1.0",
      kind: "ai",
      endpoint: "http://127.0.0.1:8732",
      lifecycle: "managed",
      executable: "research-ai",
      tagline: "Deep research with citations",
      tags: ["ai", "knowledge"],
      accent: "#9b6dff",
      ai: {
        supportsStreaming: true,
        supportsTools: true,
        models: ["claude-sonnet-4", "gpt-4o"],
        defaultModel: "claude-sonnet-4",
        systemPromptEditable: true,
      },
    },
    runtime: {
      status: "busy",
      busy: true,
      lastEventAt: new Date().toISOString(),
      uptimeSec: 482,
      message: "Generating answer…",
    },
  },
  {
    manifest: {
      id: "clipboard-history",
      name: "Clipboard History",
      version: "0.1.0",
      kind: "utility",
      endpoint: "http://127.0.0.1:8733",
      lifecycle: "managed",
      executable: "clipd",
      tagline: "Searchable clipboard archive",
      tags: ["productivity"],
      accent: "#3ddc97",
    },
    runtime: {
      status: "offline",
      busy: false,
      lastEventAt: null,
      uptimeSec: 0,
      message: "Not running",
    },
  },
];
