import { Activity, Bot, Layers, Search, Wrench, Cog } from "lucide-react";
import { cn } from "@/lib/cn";
import type { AgentKind } from "@/types/agent";

export type SidebarFilter = "all" | "running" | AgentKind;

const FILTERS: { id: SidebarFilter; label: string; icon: typeof Layers }[] = [
  { id: "all", label: "All agents", icon: Layers },
  { id: "running", label: "Running", icon: Activity },
  { id: "ai", label: "AI", icon: Bot },
  { id: "utility", label: "Utilities", icon: Wrench },
];

export interface SidebarProps {
  filter: SidebarFilter;
  onFilterChange: (f: SidebarFilter) => void;
  counts: Record<SidebarFilter, number>;
}

export function Sidebar({ filter, onFilterChange, counts }: SidebarProps) {
  return (
    <aside className="w-60 shrink-0 h-full flex flex-col border-r border-border-subtle bg-bg-base/40">
      <div className="px-4 pt-5 pb-3 flex items-center gap-2.5">
        <div
          className="w-8 h-8 rounded-lg grid place-items-center text-white font-bold"
          style={{ background: "linear-gradient(135deg,#7c5cff,#3ddcff)" }}
        >
          A
        </div>
        <div className="leading-tight">
          <div className="font-semibold">Agent Hub</div>
          <div className="text-[11px] text-muted">v0.1.0 · local</div>
        </div>
      </div>

      <div className="px-3 pb-3">
        <div
          className={cn(
            "flex items-center gap-2 px-2.5 py-1.5 rounded-lg",
            "bg-bg-card/60 border border-border-subtle text-muted text-xs",
            "hover:border-border-default cursor-pointer transition-colors",
          )}
          title="Coming in v0.4"
        >
          <Search size={13} />
          <span className="flex-1">Search…</span>
          <kbd className="text-[10px] px-1.5 py-0.5 rounded border border-border-default font-mono text-muted">
            ⌘K
          </kbd>
        </div>
      </div>

      <nav className="flex-1 overflow-auto px-2 py-1">
        {FILTERS.map(({ id, label, icon: Icon }) => {
          const active = filter === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onFilterChange(id)}
              className={cn(
                "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm",
                "transition-colors mb-0.5",
                active
                  ? "bg-bg-card text-slate-100 border border-border-default"
                  : "text-muted hover:bg-bg-card/40 hover:text-slate-200 border border-transparent",
              )}
            >
              <Icon size={15} strokeWidth={1.75} />
              <span className="flex-1 text-left">{label}</span>
              <span className="text-[11px] tabular-nums text-muted">
                {counts[id] ?? 0}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="p-3 border-t border-border-subtle">
        <button
          type="button"
          className={cn(
            "w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm",
            "text-muted hover:text-slate-200 hover:bg-bg-card/40 transition-colors",
          )}
        >
          <Cog size={15} />
          Settings
        </button>
      </div>
    </aside>
  );
}
