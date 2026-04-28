import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Database,
  Download,
  FileText,
  FolderOpen,
  Github,
  Hash,
  Keyboard,
  Languages,
  Moon,
  Power,
  RefreshCw,
  Sparkles,
  Sun,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { useAgentStore } from "@/store/agents";
import {
  getAutoStart,
  getChatDbStats,
  installCloudRuAgent,
  installEasysttLatest,
  installOpenRouterAgent,
  isManagedRunning,
  setAutoStart,
  startManagedAgent,
  type AutoStartView,
  type ChatDbStats,
} from "@/lib/api";

export type SettingsTab = "general" | "marketplace" | "system" | "about";

interface SettingsViewProps {
  onBack: () => void;
  theme: "dark" | "light";
  onThemeChange: (next: "dark" | "light") => void;
  onOpenAgentSettings?: (id: string) => void;
  /** Sidebar Marketplace opens with this tab (default: general). */
  initialTab?: SettingsTab;
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
  onOpenAgentSettings,
  initialTab = "general",
}: SettingsViewProps) {
  const { t, locale, setLocale } = useI18n();
  const agentsMap = useAgentStore((s) => s.agents);
  const manifestDir = useAgentStore((s) => s.manifestDir);
  const openRouterAgent = agentsMap["openrouter-agent"];
  const cloudRuAgent = agentsMap["cloudru-agent"];

  const [tab, setTab] = useState<SettingsTab>(initialTab);

  const [stats, setStats] = useState<ChatDbStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [autoStartRows, setAutoStartRows] = useState<AutoStartRow[]>([]);
  const [autoStartLoading, setAutoStartLoading] = useState(true);

  const [installingOpenRouter, setInstallingOpenRouter] = useState(false);
  const [orMsg, setOrMsg] = useState<string | null>(null);
  const [openRouterRunning, setOpenRouterRunning] = useState(false);

  const [installingCloudRu, setInstallingCloudRu] = useState(false);
  const [crMsg, setCrMsg] = useState<string | null>(null);
  const [cloudRuRunning, setCloudRuRunning] = useState(false);

  const [installingEasystt, setInstallingEasystt] = useState(false);
  const [easysttMsg, setEasysttMsg] = useState<string | null>(null);

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
    if (!openRouterAgent) {
      setOpenRouterRunning(false);
      return;
    }
    isManagedRunning("openrouter-agent")
      .then((v) => setOpenRouterRunning(v))
      .catch(() => setOpenRouterRunning(false));
  }, [openRouterAgent]);

  useEffect(() => {
    if (!cloudRuAgent) {
      setCloudRuRunning(false);
      return;
    }
    isManagedRunning("cloudru-agent")
      .then((v) => setCloudRuRunning(v))
      .catch(() => setCloudRuRunning(false));
  }, [cloudRuAgent]);

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

  const onInstallOpenRouter = async () => {
    setInstallingOpenRouter(true);
    setOrMsg(null);
    try {
      const out = await installOpenRouterAgent();
      setOrMsg(`Installed to ${out.projectDir}. Manifest: ${out.manifestPath}`);
    } catch (e) {
      setOrMsg(`Install failed: ${String(e)}`);
    } finally {
      setInstallingOpenRouter(false);
    }
  };

  const onInstallCloudRu = async () => {
    setInstallingCloudRu(true);
    setCrMsg(null);
    try {
      const out = await installCloudRuAgent();
      setCrMsg(`Installed to ${out.projectDir}. Manifest: ${out.manifestPath}`);
    } catch (e) {
      setCrMsg(`Install failed: ${String(e)}`);
    } finally {
      setInstallingCloudRu(false);
    }
  };

  const onStartOpenRouter = async () => {
    try {
      await startManagedAgent("openrouter-agent");
      setOpenRouterRunning(true);
      setOrMsg("OpenRouter Agent started.");
    } catch (e) {
      setOrMsg(`Start failed: ${String(e)}`);
    }
  };

  const onStartCloudRu = async () => {
    try {
      await startManagedAgent("cloudru-agent");
      setCloudRuRunning(true);
      setCrMsg("Cloud.ru Agent started.");
    } catch (e) {
      setCrMsg(`Start failed: ${String(e)}`);
    }
  };

  const onInstallEasystt = async () => {
    setInstallingEasystt(true);
    setEasysttMsg(null);
    try {
      const out = await installEasysttLatest();
      setEasysttMsg(`${out.assetName} → ${out.downloadedPath}`);
    } catch (e) {
      setEasysttMsg(String(e));
    } finally {
      setInstallingEasystt(false);
    }
  };

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: "general", label: t("tab.general") },
    { id: "marketplace", label: t("tab.marketplace") },
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

          {tab === "marketplace" && (
            <>
              <Section icon={Sparkles} title={t("marketplace.section")}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* easySTT */}
                  <div className="rounded-xl border border-border-subtle bg-bg-card/50 p-3 space-y-3 md:col-span-2">
                    <div className="flex items-start gap-2">
                      <div
                        className="w-8 h-8 rounded-lg grid place-items-center text-white text-xs font-semibold"
                        style={{
                          background: "linear-gradient(135deg, #4f8cff, #4f8cff99)",
                        }}
                      >
                        {t("marketplace.kind.utility")}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">easySTT</div>
                        <div className="text-[11px] text-muted">
                          {t("marketplace.easystt.desc")}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void onInstallEasystt()}
                      disabled={installingEasystt}
                      className={cn(
                        "inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1.5 rounded-lg border transition-colors",
                        "border-border-subtle hover:border-border-default text-muted hover:text-slate-200",
                        installingEasystt && "opacity-60 cursor-not-allowed",
                      )}
                    >
                      <Download size={12} className={installingEasystt ? "animate-pulse" : ""} />
                      {installingEasystt
                        ? t("marketplace.easystt.installing")
                        : t("marketplace.easystt.install")}
                    </button>
                    {easysttMsg && (
                      <div className="text-[11px] text-muted break-all">{easysttMsg}</div>
                    )}
                  </div>

                  {/* OpenRouter */}
                  <div className="rounded-xl border border-border-subtle bg-bg-card/50 p-3 space-y-3">
                    <div className="flex items-start gap-2">
                      <div
                        className="w-8 h-8 rounded-lg grid place-items-center text-white text-xs font-semibold"
                        style={{
                          background: "linear-gradient(135deg, #5b8def, #5b8def99)",
                        }}
                      >
                        {t("marketplace.kind.ai")}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="font-medium truncate">{t("ai.openrouter.title")}</div>
                          {openRouterAgent && (
                            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-emerald-500/50 text-emerald-300 bg-emerald-500/10">
                              {t("marketplace.badge")}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-muted">
                          {t("marketplace.openrouter.desc")}
                        </div>
                      </div>
                    </div>
                    <p className="text-[11px] text-muted">{t("ai.openrouter.blurb")}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={onInstallOpenRouter}
                        disabled={installingOpenRouter}
                        className={cn(
                          "inline-flex items-center gap-2 text-[12px] px-2.5 py-1.5 rounded-lg border transition-colors",
                          "border-border-subtle hover:border-border-default text-muted hover:text-slate-200",
                          installingOpenRouter && "opacity-60 cursor-not-allowed",
                        )}
                      >
                        <RefreshCw size={12} className={installingOpenRouter ? "animate-spin" : ""} />
                        {openRouterAgent ? t("marketplace.repair") : t("marketplace.install")}
                      </button>
                      <button
                        type="button"
                        onClick={onStartOpenRouter}
                        disabled={!openRouterAgent}
                        className={cn(
                          "inline-flex items-center gap-2 text-[12px] px-2.5 py-1.5 rounded-lg border transition-colors",
                          "border-border-subtle hover:border-border-default text-muted hover:text-slate-200",
                          !openRouterAgent && "opacity-60 cursor-not-allowed",
                        )}
                      >
                        <Power size={12} />
                        {openRouterRunning ? t("ai.openrouter.running") : t("ai.openrouter.start")}
                      </button>
                      {openRouterAgent && (
                        <button
                          type="button"
                          onClick={() => onOpenAgentSettings?.("openrouter-agent")}
                          className="inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1.5 rounded-lg border border-border-subtle hover:border-border-default text-muted hover:text-slate-200 transition-colors"
                        >
                          <Hash size={12} />
                          {t("marketplace.agentSettings")}
                        </button>
                      )}
                    </div>
                    <div className="text-[11px]">
                      <span className="text-muted">{t("ai.statusLabel")}: </span>
                      <span
                        className={cn(
                          openRouterAgent && openRouterRunning && "text-emerald-400",
                          openRouterAgent && !openRouterRunning && "text-amber-400",
                          !openRouterAgent && "text-muted",
                        )}
                      >
                        {openRouterAgent
                          ? openRouterRunning
                            ? t("ai.openrouter.status.installedRun")
                            : t("ai.openrouter.status.installedStop")
                          : t("ai.openrouter.status.missing")}
                      </span>
                    </div>
                    {orMsg && <div className="text-[11px] text-muted break-all">{orMsg}</div>}
                  </div>

                  {/* Cloud.ru */}
                  <div className="rounded-xl border border-border-subtle bg-bg-card/50 p-3 space-y-3">
                    <div className="flex items-start gap-2">
                      <div
                        className="w-8 h-8 rounded-lg grid place-items-center text-white text-xs font-semibold"
                        style={{
                          background: "linear-gradient(135deg, #f59e0b, #f59e0b99)",
                        }}
                      >
                        {t("marketplace.kind.ai")}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="font-medium truncate">{t("ai.cloudru.title")}</div>
                          {cloudRuAgent && (
                            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-emerald-500/50 text-emerald-300 bg-emerald-500/10">
                              {t("marketplace.badge")}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-muted">
                          {t("marketplace.cloudru.desc")}
                        </div>
                      </div>
                    </div>
                    <p className="text-[11px] text-muted">{t("ai.cloudru.blurb")}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={onInstallCloudRu}
                        disabled={installingCloudRu}
                        className={cn(
                          "inline-flex items-center gap-2 text-[12px] px-2.5 py-1.5 rounded-lg border transition-colors",
                          "border-border-subtle hover:border-border-default text-muted hover:text-slate-200",
                          installingCloudRu && "opacity-60 cursor-not-allowed",
                        )}
                      >
                        <RefreshCw size={12} className={installingCloudRu ? "animate-spin" : ""} />
                        {cloudRuAgent ? t("marketplace.repair") : t("marketplace.install")}
                      </button>
                      <button
                        type="button"
                        onClick={onStartCloudRu}
                        disabled={!cloudRuAgent}
                        className={cn(
                          "inline-flex items-center gap-2 text-[12px] px-2.5 py-1.5 rounded-lg border transition-colors",
                          "border-border-subtle hover:border-border-default text-muted hover:text-slate-200",
                          !cloudRuAgent && "opacity-60 cursor-not-allowed",
                        )}
                      >
                        <Power size={12} />
                        {cloudRuRunning ? t("ai.openrouter.running") : t("ai.openrouter.start")}
                      </button>
                      {cloudRuAgent && (
                        <button
                          type="button"
                          onClick={() => onOpenAgentSettings?.("cloudru-agent")}
                          className="inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1.5 rounded-lg border border-border-subtle hover:border-border-default text-muted hover:text-slate-200 transition-colors"
                        >
                          <Hash size={12} />
                          {t("marketplace.agentSettings")}
                        </button>
                      )}
                    </div>
                    <div className="text-[11px]">
                      <span className="text-muted">{t("ai.statusLabel")}: </span>
                      <span
                        className={cn(
                          cloudRuAgent && cloudRuRunning && "text-emerald-400",
                          cloudRuAgent && !cloudRuRunning && "text-amber-400",
                          !cloudRuAgent && "text-muted",
                        )}
                      >
                        {cloudRuAgent
                          ? cloudRuRunning
                            ? t("ai.openrouter.status.installedRun")
                            : t("ai.openrouter.status.installedStop")
                          : t("ai.openrouter.status.missing")}
                      </span>
                    </div>
                    {crMsg && <div className="text-[11px] text-muted break-all">{crMsg}</div>}
                  </div>
                </div>
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
