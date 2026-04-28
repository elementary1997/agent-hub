import { Activity, Bot, Cog, Hash, Layers, Search, Wrench } from "lucide-react";
import { cn } from "@/lib/cn";
import type { AgentKind } from "@/types/agent";

export type SidebarFilter = "all" | "running" | AgentKind | `tag:${string}`;

interface FilterMeta {
  id: SidebarFilter;
  label: string;
  icon: typeof Layers;
}

const BASE_FILTERS: FilterMeta[] = [
  { id: "all", label: "All agents", icon: Layers },
  { id: "running", label: "Running", icon: Activity },
  { id: "ai", label: "AI", icon: Bot },
  { id: "utility", label: "Utilities", icon: Wrench },
];

export interface SidebarProps {
  filter: SidebarFilter;
  onFilterChange: (f: SidebarFilter) => void;
  counts: Record<string, number>;
  tagCounts?: Record<string, number>;
  onOpenPalette?: () => void;
  onOpenSettings?: () => void;
}

export function Sidebar({
  filter,
  onFilterChange,
  counts,
  tagCounts,
  onOpenPalette,
  onOpenSettings,
}: SidebarProps) {
  const tags = tagCounts
    ? Object.entries(tagCounts)
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    : [];

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
          <div className="text-[11px] text-muted">v{__APP_VERSION__} · local</div>
        </div>
      </div>

      <div className="px-3 pb-3">
        <button
          type="button"
          onClick={onOpenPalette}
          className={cn(
            "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg",
            "bg-bg-card/60 border border-border-subtle text-muted text-xs",
            "hover:border-border-default hover:text-slate-200 transition-colors",
          )}
          title="Command palette"
        >
          <Search size={13} />
          <span className="flex-1 text-left">Search…</span>
          <kbd className="text-[10px] px-1.5 py-0.5 rounded border border-border-default font-mono text-muted">
            ⌘K
          </kbd>
        </button>
      </div>

      <nav className="flex-1 overflow-auto px-2 py-1">
        {BASE_FILTERS.map(({ id, label, icon: Icon }) => {
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

        {tags.length > 0 && (
          <>
            <div className="mt-3 mb-1 px-2.5 text-[10px] uppercase tracking-wider text-muted">
              Tags
            </div>
            {tags.map(([tag, count]) => {
              const id: SidebarFilter = `tag:${tag}`;
              const active = filter === id;
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => onFilterChange(id)}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[13px]",
                    "transition-colors mb-0.5",
                    active
                      ? "bg-bg-card text-slate-100 border border-border-default"
                      : "text-muted hover:bg-bg-card/40 hover:text-slate-200 border border-transparent",
                  )}
                  title={`Filter by tag: ${tag}`}
                >
                  <Hash size={13} strokeWidth={1.75} />
                  <span className="flex-1 text-left truncate">{tag}</span>
                  <span className="text-[11px] tabular-nums text-muted">
                    {count}
                  </span>
                </button>
              );
            })}
          </>
        )}
      </nav>

      <div className="p-3 border-t border-border-subtle space-y-2">
        <div className="flex items-center justify-between px-2.5 text-[11px] text-muted">
          <span>Show hub</span>
          <kbd className="px-1.5 py-0.5 rounded border border-border-default font-mono text-[10px]">
            Ctrl+Shift+H
          </kbd>
        </div>
        <button
          type="button"
          onClick={onOpenSettings}
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
