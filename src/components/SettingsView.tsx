import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Database,
  FileText,
  FolderOpen,
  Github,
  Hash,
  Keyboard,
  Languages,
  Moon,
  Power,
  RefreshCw,
  Sun,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { useAgentStore } from "@/store/agents";
import {
  getAutoStart,
  getChatDbStats,
  setAutoStart,
  type AutoStartView,
  type ChatDbStats,
} from "@/lib/api";

type SettingsTab = "general" | "system" | "about";

interface SettingsViewProps {
  onBack: () => void;
  theme: "dark" | "light";
  onThemeChange: (next: "dark" | "light") => void;
}

interface AutoStartRow {
  agentId: string;
  name: string;
  accent: string;
  view: AutoStartView | null;
  managed: boolean;
}

const HOTKEY_ROWS: {
  combo: string;
  whatKey: string;
  noteKey?: string;
}[] = [
  { combo: "Ctrl+Shift+H", whatKey: "hk.1.what", noteKey: "hk.1.note" },
  { combo: "⌘K / Ctrl+K", whatKey: "hk.2.what" },
  { combo: "↑ ↓", whatKey: "hk.3.what" },
  { combo: "Enter", whatKey: "hk.4.what" },
  { combo: "Esc", whatKey: "hk.5.what" },
];

export function SettingsView({
  onBack,
  theme,
  onThemeChange,
}: SettingsViewProps) {
  const { t, locale, setLocale } = useI18n();
  const agentsMap = useAgentStore((s) => s.agents);
  const manifestDir = useAgentStore((s) => s.manifestDir);

  const [tab, setTab] = useState<SettingsTab>("general");

  const [stats, setStats] = useState<ChatDbStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [autoStartRows, setAutoStartRows] = useState<AutoStartRow[]>([]);
  const [autoStartLoading, setAutoStartLoading] = useState(true);

  const agents = useMemo(() => Object.values(agentsMap), [agentsMap]);

  const refreshStats = () => {
    setStatsLoading(true);
    setStatsError(null);
    getChatDbStats()
      .then((s) => setStats(s))
      .catch((e) => setStatsError(String(e)))
      .finally(() => setStatsLoading(false));
  };

  useEffect(() => {
    refreshStats();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setAutoStartLoading(true);
    Promise.all(
      agents.map(async (a) => {
        const view = await getAutoStart(a.manifest.id).catch(() => null);
        const row: AutoStartRow = {
          agentId: a.manifest.id,
          name: a.manifest.name,
          accent: a.manifest.accent ?? "#7c5cff",
          managed: a.manifest.lifecycle === "managed",
          view,
        };
        return row;
      }),
    )
      .then((rows) => {
        if (!cancelled) {
          setAutoStartRows(
            rows.sort((a, b) =>
              a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
            ),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setAutoStartLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agentsMap]);

  const onToggleAutoStart = async (id: string, next: boolean) => {
    try {
      await setAutoStart(id, next);
      const view = await getAutoStart(id).catch(() => null);
      setAutoStartRows((rows) =>
        rows.map((r) => (r.agentId === id ? { ...r, view } : r)),
      );
    } catch (e) {
      console.error("[settings] auto-start toggle failed:", e);
    }
  };

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: "general", label: t("tab.general") },
    { id: "system", label: t("tab.system") },
    { id: "about", label: t("tab.about") },
  ];

  return (
    <div className="h-full w-full flex flex-col bg-bg-base text-slate-200">
      <header className="shrink-0 z-10 backdrop-blur bg-bg-base/80 border-b border-border-subtle">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="p-2 rounded-lg hover:bg-bg-card/60 text-muted hover:text-slate-200 transition-colors"
            title={t("settings.back")}
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <div className="text-lg font-semibold">{t("settings.title")}</div>
            <div className="text-xs text-muted">{t("settings.subtitle")}</div>
          </div>
        </div>
        <div className="max-w-3xl mx-auto px-6 flex gap-1 border-t border-border-subtle/40 overflow-x-auto">
          {tabs.map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => setTab(x.id)}
              className={cn(
                "shrink-0 px-3 py-2.5 text-sm border-b-2 -mb-px transition-colors",
                tab === x.id
                  ? "border-accent text-slate-100"
                  : "border-transparent text-muted hover:text-slate-300",
              )}
            >
              {x.label}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
          {tab === "general" && (
            <>
              <Section icon={Hash} title={t("build.section")}>
                <Row label={t("build.version")} value={`v${__APP_VERSION__}`} />
                <Row label={t("build.git")} value={__GIT_HASH__ || "unknown"} mono />
                <Row label={t("build.builtAt")} value={formatBuildAt(__BUILD_AT__)} />
              </Section>

              <Section icon={Keyboard} title={t("hotkeys.section")}>
                <div className="divide-y divide-border-subtle/60">
                  {HOTKEY_ROWS.map((h) => (
                    <div key={h.combo} className="flex items-center gap-3 py-2 text-sm">
                      <kbd className="font-mono text-[11px] px-2 py-0.5 rounded border border-border-default text-slate-100 bg-bg-card">
                        {h.combo}
                      </kbd>
                      <span className="flex-1">{t(h.whatKey)}</span>
                      {h.noteKey && (
                        <span className="text-[10px] uppercase tracking-wider text-muted">
                          {t(h.noteKey)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-3 text-[11px] text-muted">{t("hotkeys.future")}</div>
              </Section>

              <Section icon={Languages} title={t("lang.section")}>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setLocale("en")}
                    className={cn(
                      "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm transition-colors",
                      locale === "en"
                        ? "border-border-default bg-bg-elev text-slate-100"
                        : "border-border-subtle text-muted hover:text-slate-200",
                    )}
                  >
                    {t("lang.en")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setLocale("ru")}
                    className={cn(
                      "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm transition-colors",
                      locale === "ru"
                        ? "border-border-default bg-bg-elev text-slate-100"
                        : "border-border-subtle text-muted hover:text-slate-200",
                    )}
                  >
                    {t("lang.ru")}
                  </button>
                </div>
                <div className="text-[11px] text-muted">{t("lang.hint")}</div>
              </Section>

              <Section icon={theme === "dark" ? Moon : Sun} title={t("theme.section")}>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onThemeChange("dark")}
                    className={cn(
                      "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm transition-colors",
                      theme === "dark"
                        ? "border-border-default bg-bg-elev text-slate-100"
                        : "border-border-subtle text-muted hover:text-slate-200",
                    )}
                  >
                    <Moon size={13} />
                    {t("theme.dark")}
                  </button>
                  <button
                    type="button"
                    onClick={() => onThemeChange("light")}
                    className={cn(
                      "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm transition-colors",
                      theme === "light"
                        ? "border-border-default bg-bg-elev text-slate-100"
                        : "border-border-subtle text-muted hover:text-slate-200",
                    )}
                  >
                    <Sun size={13} />
                    {t("theme.light")}
                  </button>
                </div>
                <div className="text-[11px] text-muted">{t("theme.hint")}</div>
              </Section>
            </>
          )}

          {tab === "system" && (
            <>
              <Section icon={FolderOpen} title={t("storage.section")}>
                <Row
                  label={t("storage.manifestDir")}
                  value={manifestDir ?? "~/.config/agent-hub/agents/"}
                  mono
                />
                {statsError ? (
                  <div className="text-xs text-red-300">
                    {t("storage.statsFailed")}: {statsError}
                  </div>
                ) : statsLoading ? (
                  <div className="text-xs text-muted">{t("storage.statsLoading")}</div>
                ) : stats ? (
                  <>
                    <Row label={t("storage.chatDb")} value={stats.path} mono />
                    <Row label={t("storage.dbSize")} value={formatBytes(stats.size_bytes)} />
                    <Row label={t("storage.conv")} value={String(stats.conversations)} />
                    <Row
                      label={t("storage.msg")}
                      value={`${stats.messages} (${stats.fts_indexed} indexed)`}
                    />
                  </>
                ) : (
                  <div className="text-xs text-muted">{t("storage.cacheOff")}</div>
                )}
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={refreshStats}
                    className="inline-flex items-center gap-2 text-[12px] px-2.5 py-1.5 rounded-lg border border-border-subtle hover:border-border-default text-muted hover:text-slate-200 transition-colors"
                  >
                    <RefreshCw size={12} />
                    {t("storage.refresh")}
                  </button>
                </div>
              </Section>

              <Section icon={Power} title={t("autostart.section")}>
                {autoStartLoading ? (
                  <div className="text-xs text-muted">{t("autostart.loading")}</div>
                ) : autoStartRows.length === 0 ? (
                  <div className="text-xs text-muted">{t("autostart.empty")}</div>
                ) : (
                  <div className="divide-y divide-border-subtle/60">
                    {autoStartRows.map((r) => (
                      <AutoStartRowView key={r.agentId} row={r} onToggle={onToggleAutoStart} />
                    ))}
                  </div>
                )}
              </Section>

              <Section icon={Database} title={t("chat.section")}>
                <p className="text-xs text-muted">{t("chat.blurb1")}</p>
                <p className="text-xs text-muted">{t("chat.blurb2")}</p>
              </Section>
            </>
          )}

          {tab === "about" && (
            <Section icon={FileText} title={t("about.section")}>
              <Row label={t("about.app")} value="Agent Hub" />
              <Row label={t("about.license")} value="MIT" />
              <a
                href="https://github.com/elementary1997/agent-hub"
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-2 text-[12px] px-2.5 py-1.5 rounded-lg border border-border-subtle hover:border-border-default text-muted hover:text-slate-200 transition-colors"
              >
                <Github size={12} />
                {t("about.github")}
              </a>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Hash;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="rounded-2xl border border-border-subtle bg-bg-card/60 overflow-hidden"
    >
      <div className="px-4 py-3 border-b border-border-subtle/60 flex items-center gap-2 text-sm">
        <Icon size={14} className="text-muted" />
        <span className="font-medium">{title}</span>
      </div>
      <div className="px-4 py-3 space-y-2">{children}</div>
    </motion.section>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-3 text-sm">
      <span className="w-44 shrink-0 text-[12px] uppercase tracking-wider text-muted">
        {label}
      </span>
      <span
        className={cn(
          "min-w-0 break-all",
          mono ? "font-mono text-[12px]" : "text-slate-100",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function AutoStartRowView({
  row,
  onToggle,
}: {
  row: AutoStartRow;
  onToggle: (id: string, next: boolean) => void;
}) {
  const enabled = row.view?.enabled ?? false;
  const status = !row.managed
    ? "not managed"
    : row.view
      ? row.view.user_override === null
        ? `default · ${row.view.manifest_default ? "on" : "off"}`
        : `override · ${row.view.user_override ? "on" : "off"}`
      : "—";

  return (
    <div className="flex items-center gap-3 py-2.5 text-sm">
      <div
        className="w-2 h-2 rounded-full shrink-0"
        style={{ background: row.accent }}
      />
      <div className="flex-1 min-w-0">
        <div className="truncate text-slate-100">{row.name}</div>
        <div className="text-[11px] text-muted">{status}</div>
      </div>
      <button
        type="button"
        disabled={!row.managed}
        onClick={() => onToggle(row.agentId, !enabled)}
        className={cn(
          "relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0",
          enabled
            ? "bg-sky-500/80"
            : "bg-bg-elev border border-border-default",
          !row.managed && "opacity-40 cursor-not-allowed",
        )}
        title={
          row.managed
            ? `Toggle auto-start for ${row.name}`
            : "Auto-start only applies to managed agents"
        }
      >
        <span
          className={cn(
            "inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform",
            enabled ? "translate-x-[18px]" : "translate-x-[3px]",
          )}
        />
      </button>
    </div>
  );
}

function formatBuildAt(iso: string): string {
  if (!iso) return "unknown";
  try {
    const d = new Date(iso);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
  } catch {
    return iso;
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
