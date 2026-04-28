import { Bell, Plus } from "lucide-react";

export interface TopbarProps {
  title: string;
  subtitle?: string;
}

export function Topbar({ title, subtitle }: TopbarProps) {
  return (
    <header className="h-14 px-6 flex items-center justify-between border-b border-border-subtle bg-bg-base/40 backdrop-blur-md">
      <div>
        <div className="font-semibold leading-tight">{title}</div>
        {subtitle && <div className="text-xs text-muted">{subtitle}</div>}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="text-xs px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors inline-flex items-center gap-1.5"
        >
          <Plus size={14} />
          Add agent
        </button>
        <button
          type="button"
          className="w-8 h-8 grid place-items-center rounded-lg text-muted hover:text-slate-200 hover:bg-bg-card/60 transition-colors"
          title="Notifications"
        >
          <Bell size={15} />
        </button>
      </div>
    </header>
  );
}
