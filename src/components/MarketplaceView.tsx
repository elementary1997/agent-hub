import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Download,
  Hash,
  Play,
  RefreshCw,
  Square,
  Sparkles,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { useAgentStore } from "@/store/agents";
import {
  easysttInstalled,
  installCloudRuAgent,
  installEasysttLatest,
  installOpenRouterAgent,
  isManagedRunning,
  startManagedAgent,
  stopManagedAgent,
  uninstallAgentLocal,
} from "@/lib/api";

export interface MarketplaceViewProps {
  onOpenAgentDetail?: (id: string) => void;
}

export function MarketplaceView({ onOpenAgentDetail }: MarketplaceViewProps) {
  const { t } = useI18n();
  const agentsMap = useAgentStore((s) => s.agents);
  const openRouterAgent = agentsMap["openrouter-agent"];
  const cloudRuAgent = agentsMap["cloudru-agent"];

  const [installingOpenRouter, setInstallingOpenRouter] = useState(false);
  const [orMsg, setOrMsg] = useState<string | null>(null);
  const [openRouterRunning, setOpenRouterRunning] = useState(false);
  const [openRouterBusy, setOpenRouterBusy] = useState(false);
  const [openRouterRemoving, setOpenRouterRemoving] = useState(false);

  const [installingCloudRu, setInstallingCloudRu] = useState(false);
  const [crMsg, setCrMsg] = useState<string | null>(null);
  const [cloudRuRunning, setCloudRuRunning] = useState(false);
  const [cloudRuBusy, setCloudRuBusy] = useState(false);
  const [cloudRuRemoving, setCloudRuRemoving] = useState(false);

  const [installingEasystt, setInstallingEasystt] = useState(false);
  const [easysttMsg, setEasysttMsg] = useState<string | null>(null);
  const [easysttDetected, setEasysttDetected] = useState(false);

  const easysttManifest = !!agentsMap["easystt"];
  const easysttOk = easysttManifest || easysttDetected;

  useEffect(() => {
    easysttInstalled()
      .then((v) => setEasysttDetected(v))
      .catch(() => setEasysttDetected(false));
  }, []);

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

  const onToggleOpenRouter = async () => {
    if (!openRouterAgent || openRouterBusy) return;
    setOpenRouterBusy(true);
    try {
      if (openRouterRunning) {
        await stopManagedAgent("openrouter-agent");
        setOpenRouterRunning(false);
        setOrMsg("OpenRouter Agent stopped.");
      } else {
        await startManagedAgent("openrouter-agent");
        setOpenRouterRunning(true);
        setOrMsg("OpenRouter Agent started.");
      }
    } catch (e) {
      setOrMsg(`Action failed: ${String(e)}`);
    } finally {
      setOpenRouterBusy(false);
    }
  };

  const onToggleCloudRu = async () => {
    if (!cloudRuAgent || cloudRuBusy) return;
    setCloudRuBusy(true);
    try {
      if (cloudRuRunning) {
        await stopManagedAgent("cloudru-agent");
        setCloudRuRunning(false);
        setCrMsg("Cloud.ru Agent stopped.");
      } else {
        await startManagedAgent("cloudru-agent");
        setCloudRuRunning(true);
        setCrMsg("Cloud.ru Agent started.");
      }
    } catch (e) {
      setCrMsg(`Action failed: ${String(e)}`);
    } finally {
      setCloudRuBusy(false);
    }
  };

  const onUninstallOpenRouter = async () => {
    if (!openRouterAgent || openRouterRemoving) return;
    const ok = window.confirm("Remove OpenRouter Agent from this computer?");
    if (!ok) return;
    setOpenRouterRemoving(true);
    setOrMsg(null);
    try {
      await uninstallAgentLocal("openrouter-agent");
      setOpenRouterRunning(false);
      setOrMsg("OpenRouter Agent removed from this computer.");
    } catch (e) {
      setOrMsg(`Uninstall failed: ${String(e)}`);
    } finally {
      setOpenRouterRemoving(false);
    }
  };

  const onUninstallCloudRu = async () => {
    if (!cloudRuAgent || cloudRuRemoving) return;
    const ok = window.confirm("Remove Cloud.ru Agent from this computer?");
    if (!ok) return;
    setCloudRuRemoving(true);
    setCrMsg(null);
    try {
      await uninstallAgentLocal("cloudru-agent");
      setCloudRuRunning(false);
      setCrMsg("Cloud.ru Agent removed from this computer.");
    } catch (e) {
      setCrMsg(`Uninstall failed: ${String(e)}`);
    } finally {
      setCloudRuRemoving(false);
    }
  };

  const onInstallEasystt = async () => {
    setInstallingEasystt(true);
    setEasysttMsg(null);
    try {
      const out = await installEasysttLatest();
      setEasysttMsg(`${out.assetName} → ${out.downloadedPath}`);
      void easysttInstalled().then(setEasysttDetected);
    } catch (e) {
      setEasysttMsg(String(e));
    } finally {
      setInstallingEasystt(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <Section icon={Sparkles} title={t("marketplace.section")}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="font-medium truncate">easySTT</div>
                  {easysttOk && (
                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-emerald-500/50 text-emerald-300 bg-emerald-500/10">
                      {t("marketplace.badge")}
                    </span>
                  )}
                </div>
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
                : easysttOk
                  ? t("marketplace.repair")
                  : t("marketplace.easystt.install")}
            </button>
            <div className="text-[11px]">
              <span className="text-muted">{t("ai.statusLabel")}: </span>
              <span
                className={cn(
                  easysttOk && "text-emerald-400",
                  !easysttOk && "text-muted",
                )}
              >
                {easysttOk
                  ? t("marketplace.easystt.status.ok")
                  : t("marketplace.easystt.status.missing")}
              </span>
            </div>
            {easysttMsg && (
              <div className="text-[11px] text-muted break-all">{easysttMsg}</div>
            )}
          </div>

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
                onClick={onToggleOpenRouter}
                disabled={!openRouterAgent || openRouterBusy}
                className={cn(
                  "inline-flex items-center gap-2 text-[12px] px-2.5 py-1.5 rounded-lg border transition-colors",
                  "border-border-subtle hover:border-border-default text-muted hover:text-slate-200",
                  (!openRouterAgent || openRouterBusy) && "opacity-60 cursor-not-allowed",
                )}
              >
                {openRouterRunning ? <Square size={12} /> : <Play size={12} />}
                {openRouterRunning ? t("marketplace.stop") : t("ai.openrouter.start")}
              </button>
              {openRouterAgent && (
                <button
                  type="button"
                  onClick={onUninstallOpenRouter}
                  disabled={openRouterRemoving}
                  className={cn(
                    "inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1.5 rounded-lg border transition-colors",
                    "border-red-500/30 text-red-300 hover:bg-red-500/10",
                    openRouterRemoving && "opacity-60 cursor-not-allowed",
                  )}
                >
                  <Trash2 size={12} />
                  {openRouterRemoving ? t("marketplace.uninstalling") : t("marketplace.remove")}
                </button>
              )}
              {openRouterAgent && (
                <button
                  type="button"
                  onClick={() => onOpenAgentDetail?.("openrouter-agent")}
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
                onClick={onToggleCloudRu}
                disabled={!cloudRuAgent || cloudRuBusy}
                className={cn(
                  "inline-flex items-center gap-2 text-[12px] px-2.5 py-1.5 rounded-lg border transition-colors",
                  "border-border-subtle hover:border-border-default text-muted hover:text-slate-200",
                  (!cloudRuAgent || cloudRuBusy) && "opacity-60 cursor-not-allowed",
                )}
              >
                {cloudRuRunning ? <Square size={12} /> : <Play size={12} />}
                {cloudRuRunning ? t("marketplace.stop") : t("ai.openrouter.start")}
              </button>
              {cloudRuAgent && (
                <button
                  type="button"
                  onClick={onUninstallCloudRu}
                  disabled={cloudRuRemoving}
                  className={cn(
                    "inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1.5 rounded-lg border transition-colors",
                    "border-red-500/30 text-red-300 hover:bg-red-500/10",
                    cloudRuRemoving && "opacity-60 cursor-not-allowed",
                  )}
                >
                  <Trash2 size={12} />
                  {cloudRuRemoving ? t("marketplace.uninstalling") : t("marketplace.remove")}
                </button>
              )}
              {cloudRuAgent && (
                <button
                  type="button"
                  onClick={() => onOpenAgentDetail?.("cloudru-agent")}
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
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Sparkles;
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
