import { useEffect, useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { AgentCard } from "@/components/AgentCard";
import { AgentDetail } from "@/components/AgentDetail";
import { ChatView } from "@/components/ChatView";
import { CommandPalette } from "@/components/CommandPalette";
import { Sidebar, type SidebarFilter } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { useAgentStore } from "@/store/agents";
import {
  agentsDir,
  listAgents,
  onAgentEvent,
  onAgentRemoved,
  onAgentUpserted,
  openNative,
  quitAgent,
  startManagedAgent,
  stopManagedAgent,
} from "@/lib/api";
import type { Agent } from "@/types/agent";

function applyFilter(agents: Agent[], f: SidebarFilter): Agent[] {
  if (f === "all") return agents;
  if (f === "running") {
    return agents.filter((a) => a.runtime.status === "running" || a.runtime.status === "busy");
  }
  if (f.startsWith("tag:")) {
    const tag = f.slice(4);
    return agents.filter((a) => (a.manifest.tags ?? []).includes(tag));
  }
  return agents.filter((a) => a.manifest.kind === f);
}

function sortAgents(list: Agent[]): Agent[] {
  return [...list].sort((a, b) =>
    a.manifest.name.localeCompare(b.manifest.name, undefined, { sensitivity: "base" }),
  );
}

export default function App() {
  const agentsMap = useAgentStore((s) => s.agents);
  const setAll = useAgentStore((s) => s.setAll);
  const upsert = useAgentStore((s) => s.upsert);
  const remove = useAgentStore((s) => s.remove);
  const pushEvent = useAgentStore((s) => s.pushEvent);
  const manifestDir = useAgentStore((s) => s.manifestDir);
  const setManifestDir = useAgentStore((s) => s.setManifestDir);
  const error = useAgentStore((s) => s.error);
  const setError = useAgentStore((s) => s.setError);
  const loaded = useAgentStore((s) => s.loaded);
  const setLoaded = useAgentStore((s) => s.setLoaded);

  const [filter, setFilter] = useState<SidebarFilter>("all");
  const [chatAgent, setChatAgent] = useState<string | null>(null);
  const [chatConversation, setChatConversation] = useState<string | null>(null);
  const [detailAgent, setDetailAgent] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // ⌘K / Ctrl+K opens the command palette from anywhere.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleOpenChat = (id: string, conversationId?: string | null) => {
    setDetailAgent(null);
    setChatConversation(conversationId ?? null);
    setChatAgent(id);
  };
  const handleOpenDetail = (id: string) => {
    setChatAgent(null);
    setDetailAgent(id);
  };

  useEffect(() => {
    let unlistenUp: (() => void) | null = null;
    let unlistenRm: (() => void) | null = null;
    let unlistenEv: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      try {
        const dir = await agentsDir();
        if (cancelled) return;
        setManifestDir(dir);

        unlistenUp = await onAgentUpserted((a) => upsert(a));
        unlistenRm = await onAgentRemoved((id) => remove(id));
        unlistenEv = await onAgentEvent((e) => pushEvent(e));

        const list = await listAgents();
        if (cancelled) return;
        setAll(list);
        setLoaded(true);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();

    return () => {
      cancelled = true;
      unlistenUp?.();
      unlistenRm?.();
      unlistenEv?.();
    };
  }, [setAll, upsert, remove, pushEvent, setManifestDir, setError, setLoaded]);

  const agents = useMemo(() => sortAgents(Object.values(agentsMap)), [agentsMap]);

  const counts = useMemo<Record<string, number>>(
    () => ({
      all: agents.length,
      running: agents.filter(
        (a) => a.runtime.status === "running" || a.runtime.status === "busy",
      ).length,
      ai: agents.filter((a) => a.manifest.kind === "ai").length,
      utility: agents.filter((a) => a.manifest.kind === "utility").length,
      service: agents.filter((a) => a.manifest.kind === "service").length,
    }),
    [agents],
  );

  const tagCounts = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const agent of agents) {
      for (const tag of agent.manifest.tags ?? []) {
        out[tag] = (out[tag] ?? 0) + 1;
      }
    }
    return out;
  }, [agents]);

  const visible = useMemo(() => applyFilter(agents, filter), [agents, filter]);

  const handleOpenPrimary = (id: string) => {
    const agent = agentsMap[id];
    if (!agent) return;
    if (agent.manifest.kind === "ai") {
      setChatAgent(id);
      return;
    }
    openNative(id).catch((e) => console.error("[hub] open-native-ui failed:", e));
  };
  const handleToggleRun = (id: string) => {
    const agent = agentsMap[id];
    if (!agent) return;
    if (agent.manifest.lifecycle !== "managed") return;
    const isAlive =
      agent.runtime.status === "running" || agent.runtime.status === "busy";
    if (isAlive) {
      // Prefer the supervisor stop path so we kill the child process even
      // when the agent is wedged and ignores POST /quit.
      stopManagedAgent(id).catch((e) => {
        console.warn("[hub] supervisor stop failed, falling back to /quit:", e);
        quitAgent(id).catch((qe) => console.error("[hub] quit failed:", qe));
      });
    } else {
      startManagedAgent(id).catch((e) =>
        console.error("[hub] start failed:", e),
      );
    }
  };

  const palette = (
    <CommandPalette
      open={paletteOpen}
      onClose={() => setPaletteOpen(false)}
      onOpenChat={handleOpenChat}
      onOpenDetail={handleOpenDetail}
    />
  );

  if (chatAgent) {
    return (
      <div className="h-screen w-screen overflow-hidden">
        <ChatView
          agentId={chatAgent}
          initialConversationId={chatConversation}
          onBack={() => {
            setChatAgent(null);
            setChatConversation(null);
          }}
        />
        {palette}
      </div>
    );
  }

  if (detailAgent) {
    return (
      <div className="h-screen w-screen overflow-hidden">
        <AgentDetail
          agentId={detailAgent}
          onBack={() => setDetailAgent(null)}
          onOpenChat={handleOpenChat}
        />
        {palette}
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {palette}
      <Sidebar
        filter={filter}
        onFilterChange={setFilter}
        counts={counts}
        tagCounts={tagCounts}
        onOpenPalette={() => setPaletteOpen(true)}
      />

      <main className="flex-1 flex flex-col min-w-0">
        <Topbar
          title={
            filter === "all"
              ? "All agents"
              : filter === "running"
                ? "Running"
                : filter === "ai"
                  ? "AI"
                  : filter.startsWith("tag:")
                    ? `#${filter.slice(4)}`
                    : "Utilities"
          }
          subtitle={
            !loaded && !error
              ? "Loading…"
              : `${visible.length} of ${agents.length} agent${agents.length === 1 ? "" : "s"}`
          }
          onOpenPalette={() => setPaletteOpen(true)}
        />

        <div className="flex-1 overflow-auto p-6">
          {error ? (
            <ErrorState message={error} />
          ) : visible.length === 0 ? (
            <EmptyState dir={manifestDir} loaded={loaded} />
          ) : (
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              <AnimatePresence mode="popLayout">
                {visible.map((agent) => (
                  <AgentCard
                    key={agent.manifest.id}
                    agent={agent}
                    onOpenNative={handleOpenPrimary}
                    onOpenSettings={(id) => setDetailAgent(id)}
                    onToggleRun={handleToggleRun}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function EmptyState({ dir, loaded }: { dir: string | null; loaded: boolean }) {
  return (
    <div className="h-full grid place-items-center text-center">
      <div className="max-w-md">
        <div className="text-lg font-semibold mb-1">
          {loaded ? "No agents yet" : "Looking for agents…"}
        </div>
        <p className="text-sm text-muted">
          Drop an agent manifest into{" "}
          <code className="font-mono text-xs px-1.5 py-0.5 rounded bg-bg-card border border-border-subtle break-all">
            {dir ?? "~/.config/agent-hub/agents/"}
          </code>{" "}
          and the hub will pick it up automatically.
        </p>
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="h-full grid place-items-center text-center">
      <div className="max-w-md">
        <div className="text-lg font-semibold text-red-300 mb-1">Failed to load agents</div>
        <p className="text-sm text-muted break-words">{message}</p>
      </div>
    </div>
  );
}
