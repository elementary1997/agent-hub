import { Command } from "lucide-react";

export interface TopbarProps {
  title: string;
  subtitle?: string;
  onOpenPalette?: () => void;
}

export function Topbar({ title, subtitle, onOpenPalette }: TopbarProps) {
  return (
    <header className="h-14 px-6 flex items-center justify-between border-b border-border-subtle bg-bg-base/40 backdrop-blur-md">
      <div className="min-w-0">
        <div className="font-semibold leading-tight truncate">{title}</div>
        {subtitle && <div className="text-xs text-muted truncate">{subtitle}</div>}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenPalette}
          title="Command palette (⌘K / Ctrl+K)"
          className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border border-border-subtle text-muted hover:text-slate-100 hover:border-border-default bg-bg-card/40 transition-colors"
        >
          <Command size={13} />
          <span className="hidden sm:inline">Commands</span>
          <kbd className="font-mono text-[10px] px-1 py-0.5 rounded border border-border-subtle bg-bg-elev/70 text-muted">
            ⌘K
          </kbd>
        </button>
        <BuildBadge />
      </div>
    </header>
  );
}

function BuildBadge() {
  const version = __APP_VERSION__;
  const hash = __GIT_HASH__;
  return (
    <div
      className="text-[10px] uppercase tracking-wider px-2 py-1 rounded-md border border-border-subtle text-muted/80 font-mono select-text"
      title={`Built ${__BUILD_AT__}`}
    >
      v{version} · {hash}
    </div>
  );
}
