import { Command, Moon, Sun } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export interface TopbarProps {
  title: string;
  subtitle?: string;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  onOpenPalette?: () => void;
}

export function Topbar({
  title,
  subtitle,
  theme,
  onToggleTheme,
  onOpenPalette,
}: TopbarProps) {
  const { t } = useI18n();
  const themeTitle = theme === "dark" ? t("topbar.themeLight") : t("topbar.themeDark");
  return (
    <header className="h-14 px-6 flex items-center justify-between border-b border-border-subtle bg-bg-base/40 backdrop-blur-md">
      <div className="min-w-0">
        <div className="font-semibold leading-tight truncate">{title}</div>
        {subtitle && <div className="text-xs text-muted truncate">{subtitle}</div>}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggleTheme}
          title={themeTitle}
          className="inline-flex items-center justify-center p-2 rounded-lg border border-border-subtle text-muted hover:text-slate-100 hover:border-border-default bg-bg-card/40 transition-colors"
        >
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <button
          type="button"
          onClick={onOpenPalette}
          title={t("topbar.paletteHint")}
          className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border border-border-subtle text-muted hover:text-slate-100 hover:border-border-default bg-bg-card/40 transition-colors"
        >
          <Command size={13} />
          <span className="hidden sm:inline">{t("topbar.commands")}</span>
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
