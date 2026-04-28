import { useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { AgentCard } from "@/components/AgentCard";
import { Sidebar, type SidebarFilter } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { MOCK_AGENTS } from "@/lib/mockAgents";
import type { Agent } from "@/types/agent";

function applyFilter(agents: Agent[], f: SidebarFilter): Agent[] {
  if (f === "all") return agents;
  if (f === "running") {
    return agents.filter((a) => a.runtime.status === "running" || a.runtime.status === "busy");
  }
  return agents.filter((a) => a.manifest.kind === f);
}

export default function App() {
  // v0.1.0 uses static mock data; the real registry lives in the Rust core
  // and will hydrate this list via Tauri events in a follow-up commit.
  const [agents] = useState<Agent[]>(MOCK_AGENTS);
  const [filter, setFilter] = useState<SidebarFilter>("all");

  const counts = useMemo(() => {
    return {
      all: agents.length,
      running: agents.filter((a) => a.runtime.status === "running" || a.runtime.status === "busy")
        .length,
      ai: agents.filter((a) => a.manifest.kind === "ai").length,
      utility: agents.filter((a) => a.manifest.kind === "utility").length,
      service: agents.filter((a) => a.manifest.kind === "service").length,
    } as Record<SidebarFilter, number>;
  }, [agents]);

  const visible = useMemo(() => applyFilter(agents, filter), [agents, filter]);

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar filter={filter} onFilterChange={setFilter} counts={counts} />

      <main className="flex-1 flex flex-col min-w-0">
        <Topbar
          title={
            filter === "all"
              ? "All agents"
              : filter === "running"
                ? "Running"
                : filter === "ai"
                  ? "AI"
                  : "Utilities"
          }
          subtitle={`${visible.length} of ${agents.length} agent${agents.length === 1 ? "" : "s"}`}
        />

        <div className="flex-1 overflow-auto p-6">
          {visible.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              <AnimatePresence mode="popLayout">
                {visible.map((agent) => (
                  <AgentCard
                    key={agent.manifest.id}
                    agent={agent}
                    onOpenNative={(id) => console.log("open native", id)}
                    onOpenSettings={(id) => console.log("open settings", id)}
                    onToggleRun={(id) => console.log("toggle run", id)}
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

function EmptyState() {
  return (
    <div className="h-full grid place-items-center text-center">
      <div className="max-w-sm">
        <div className="text-lg font-semibold mb-1">Nothing here yet</div>
        <p className="text-sm text-muted">
          Drop an agent manifest into{" "}
          <code className="font-mono text-xs px-1.5 py-0.5 rounded bg-bg-card border border-border-subtle">
            ~/.config/agent-hub/agents/
          </code>{" "}
          and the hub will pick it up automatically.
        </p>
      </div>
    </div>
  );
}
