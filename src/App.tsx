import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence } from "framer-motion";
import { AgentCard } from "@/components/AgentCard";
import { AgentDetail } from "@/components/AgentDetail";
import { ChatView } from "@/components/ChatView";
import { CommandPalette } from "@/components/CommandPalette";
import { MarketplaceView } from "@/components/MarketplaceView";
import { SettingsView } from "@/components/SettingsView";
import { Sidebar, type SidebarFilter } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { useI18n } from "@/lib/i18n";
import { useAgentStore } from "@/store/agents";
import {
  agentsDir,
  easysttInstalled,
  installEasysttLatest,
  installOpenRouterAgent,
  listAgents,
  onAgentEvent,
  getHotkeys,
  onHotkeysUpdated,
  onAgentRemoved,
  onAgentUpserted,
  onHotkeyNewChat,
  openNative,
  onTrayNewChat,
  quitAgent,
  startManagedAgent,
  stopManagedAgent,
} from "@/lib/api";
import type { Agent } from "@/types/agent";

class ChatErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: unknown) {
    return { hasError: true, message: String(error) };
  }

  componentDidCatch(error: unknown) {
    console.error("[chat] render crash:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-full grid place-items-center px-6 text-center">
          <div className="max-w-xl rounded-xl border border-red-500/30 bg-red-500/5 p-4">
            <div className="font-medium text-red-300 mb-1">Chat crashed while rendering.</div>
            <div className="text-xs text-muted break-words">{this.state.message}</div>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, message: "" })}
              className="mt-3 text-xs px-3 py-1.5 rounded-lg border border-border-subtle text-muted hover:text-slate-100 hover:border-border-default transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function applyFilter(agents: Agent[], f: SidebarFilter): Agent[] {
  if (f === "marketplace") return [];
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
  const LAST_AI_KEY = "hub.lastAiAgentId";
  const VOICE_AUTO_SEND_KEY = "hub.voice.autoSend";
  const { t } = useI18n();
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
  const [chatDraft, setChatDraft] = useState<string | null>(null);
  const [chatDraftToken, setChatDraftToken] = useState<number | null>(null);
  const [chatAutoSubmitToken, setChatAutoSubmitToken] = useState<number | null>(null);
  const [detailAgent, setDetailAgent] = useState<string | null>(null);
  const [voiceTranscript, setVoiceTranscript] = useState<{
    text: string;
    at: number;
  } | null>(null);
  const [voiceAutoSend, setVoiceAutoSend] = useState<boolean>(
    () => localStorage.getItem(VOICE_AUTO_SEND_KEY) === "1",
  );
  const agentsMapRef = useRef(agentsMap);
  const voiceAutoSendRef = useRef(voiceAutoSend);

  useEffect(() => {
    agentsMapRef.current = agentsMap;
  }, [agentsMap]);

  useEffect(() => {
    voiceAutoSendRef.current = voiceAutoSend;
  }, [voiceAutoSend]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const saved = localStorage.getItem("hub.theme");
    if (saved === "light" || saved === "dark") return saved;
    return "dark";
  });
  const [hotkeys, setHotkeys] = useState({ show_hub: "Ctrl+Shift+H", new_chat: "Ctrl+Shift+N" });
  const [onboardingDismissed, setOnboardingDismissed] = useState(
    () => localStorage.getItem("hub.onboarding.dismissed") === "1",
  );

  const toggleTheme = () => setTheme((x) => (x === "dark" ? "light" : "dark"));

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

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("hub.theme", theme);
  }, [theme]);

  const handleOpenChat = (
    id: string,
    conversationId?: string | null,
    draftText?: string | null,
    autoSubmit?: boolean,
  ) => {
    setDetailAgent(null);
    setSettingsOpen(false);
    setChatConversation(conversationId ?? null);
    if (draftText && draftText.trim()) {
      setChatDraft(draftText.trim());
      const token = Date.now();
      setChatDraftToken(token);
      setChatAutoSubmitToken(autoSubmit ? token : null);
    } else {
      setChatDraft(null);
      setChatDraftToken(null);
      setChatAutoSubmitToken(null);
    }
    setChatAgent(id);
    localStorage.setItem(LAST_AI_KEY, id);
  };

  const routeTranscriptToChat = (text: string, autoSubmit: boolean): boolean => {
    const clean = text.trim();
    if (!clean) return false;
    const last = localStorage.getItem(LAST_AI_KEY);
    const agents = agentsMapRef.current;
    const availableAi = Object.values(agents).filter((a) => a.manifest.kind === "ai");
    const target =
      (last && agents[last]?.manifest.kind === "ai" ? last : null) ??
      availableAi[0]?.manifest.id;
    if (!target) return false;
    handleOpenChat(target, null, clean, autoSubmit);
    return true;
  };
  const handleOpenDetail = (id: string) => {
    setChatAgent(null);
    setSettingsOpen(false);
    setDetailAgent(id);
  };
  const handleSwitchChatAgent = (id: string) => {
    setChatAgent(id);
    setChatConversation(null);
    setChatDraft(null);
    setChatDraftToken(null);
    setChatAutoSubmitToken(null);
    localStorage.setItem(LAST_AI_KEY, id);
  };
  const handleOpenSettings = () => {
    setChatAgent(null);
    setDetailAgent(null);
    setSettingsOpen(true);
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
        unlistenEv = await onAgentEvent((e) => {
          pushEvent(e);
          const transcript = extractVoiceTranscriptText(e);
          if (transcript) {
            if (voiceAutoSendRef.current && routeTranscriptToChat(transcript, true)) {
              setVoiceTranscript(null);
            } else {
              setVoiceTranscript({ text: transcript, at: Date.now() });
            }
          }
        });

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

  useEffect(() => {
    localStorage.setItem(VOICE_AUTO_SEND_KEY, voiceAutoSend ? "1" : "0");
  }, [voiceAutoSend]);

  useEffect(() => {
    getHotkeys().then(setHotkeys).catch(() => {});
    let unlisten: (() => void) | null = null;
    onHotkeysUpdated((prefs) => setHotkeys(prefs)).then((u) => (unlisten = u));
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    const openLastAi = () => {
      const last = localStorage.getItem(LAST_AI_KEY);
      const availableAi = Object.values(agentsMap).filter((a) => a.manifest.kind === "ai");
      const target =
        (last && agentsMap[last]?.manifest.kind === "ai" ? last : null) ??
        availableAi[0]?.manifest.id;
      if (!target) return;
      handleOpenChat(target, null);
    };

    let unlisten: (() => void) | null = null;
    let unlistenTray: (() => void) | null = null;
    onHotkeyNewChat(openLastAi).then((u) => (unlisten = u));
    onTrayNewChat(openLastAi).then((u) => (unlistenTray = u));
    return () => {
      unlisten?.();
      unlistenTray?.();
    };
  }, [agentsMap]);

  const agents = useMemo(() => sortAgents(Object.values(agentsMap)), [agentsMap]);
  const aiAgents = useMemo(
    () => agents.filter((a) => a.manifest.kind === "ai"),
    [agents],
  );

  const counts = useMemo<Record<string, number>>(() => {
    const marketplaceIds = ["easystt", "openrouter-agent", "cloudru-agent"];
    const marketplaceInstalled = marketplaceIds.filter((id) =>
      agents.some((a) => a.manifest.id === id),
    ).length;
    return {
      all: agents.length,
      running: agents.filter(
        (a) => a.runtime.status === "running" || a.runtime.status === "busy",
      ).length,
      ai: agents.filter((a) => a.manifest.kind === "ai").length,
      utility: agents.filter((a) => a.manifest.kind === "utility").length,
      service: agents.filter((a) => a.manifest.kind === "service").length,
      marketplace: marketplaceInstalled,
    };
  }, [agents]);

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
  const showOnboarding =
    loaded &&
    !error &&
    agents.length === 0 &&
    !onboardingDismissed &&
    !chatAgent &&
    !detailAgent &&
    !settingsOpen;
  const aiTabAgentId =
    (chatAgent && agentsMap[chatAgent]?.manifest.kind === "ai" ? chatAgent : null) ??
    aiAgents[0]?.manifest.id ??
    null;

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
      onOpenSettings={handleOpenSettings}
    />
  );
  const voiceBar = (
    <VoiceTranscriptBar
      value={voiceTranscript?.text ?? null}
      autoSend={voiceAutoSend}
      onToggleAutoSend={() => setVoiceAutoSend((v) => !v)}
      onDismiss={() => setVoiceTranscript(null)}
      onUseInChat={() => {
        const text = voiceTranscript?.text?.trim();
        if (!text) return;
        if (routeTranscriptToChat(text, false)) setVoiceTranscript(null);
      }}
    />
  );

  if (chatAgent && filter !== "ai") {
    return (
      <div className="h-screen w-screen overflow-hidden">
        <ChatErrorBoundary>
          <ChatView
            agentId={chatAgent}
            onSwitchAgent={handleSwitchChatAgent}
            onOpenProviderSettings={(id) => {
              setChatAgent(null);
              setChatConversation(null);
              setChatDraft(null);
              setChatDraftToken(null);
              setChatAutoSubmitToken(null);
              setDetailAgent(id);
            }}
            initialConversationId={chatConversation}
            initialDraft={chatDraft}
            initialDraftToken={chatDraftToken}
            initialAutoSubmitToken={chatAutoSubmitToken}
            onBack={() => {
              setChatAgent(null);
              setChatConversation(null);
              setChatDraft(null);
              setChatDraftToken(null);
              setChatAutoSubmitToken(null);
            }}
          />
        </ChatErrorBoundary>
        {palette}
        {voiceBar}
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
        {voiceBar}
      </div>
    );
  }

  if (settingsOpen) {
    return (
      <div className="h-screen w-screen overflow-hidden">
        <SettingsView onBack={() => setSettingsOpen(false)} />
        {palette}
        {voiceBar}
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {palette}
      {voiceBar}
      <Sidebar
        filter={filter}
        onFilterChange={setFilter}
        counts={counts}
        tagCounts={tagCounts}
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenSettings={handleOpenSettings}
        showHubHotkey={hotkeys.show_hub}
        newChatHotkey={hotkeys.new_chat}
      />

      <main className="flex-1 flex flex-col min-w-0">
        <Topbar
          theme={theme}
          onToggleTheme={toggleTheme}
          title={
            filter === "marketplace"
              ? t("sidebar.filter.marketplace")
              : filter === "all"
                ? t("grid.all")
                : filter === "running"
                  ? t("grid.running")
                  : filter === "ai"
                    ? t("grid.ai")
                    : filter.startsWith("tag:")
                      ? `${t("grid.tagPrefix")}${filter.slice(4)}`
                      : t("grid.utilities")
          }
          subtitle={
            filter === "marketplace"
              ? t("marketplace.pageSubtitle")
              : !loaded && !error
                ? t("grid.subtitle.loading")
                : t("grid.subtitle.count", {
                    visible: visible.length,
                    total: agents.length,
                  })
          }
          onOpenPalette={() => setPaletteOpen(true)}
        />

        <div className="flex-1 overflow-auto p-6">
          {filter === "marketplace" ? (
            <MarketplaceView onOpenAgentDetail={(id) => setDetailAgent(id)} />
          ) : filter === "ai" ? (
            aiTabAgentId ? (
              <div className="h-full min-h-[calc(100vh-9rem)] -m-6">
                <ChatErrorBoundary>
                  <ChatView
                    agentId={aiTabAgentId}
                    onSwitchAgent={handleSwitchChatAgent}
                    onOpenProviderSettings={(id) => setDetailAgent(id)}
                    onBack={() => setFilter("all")}
                  />
                </ChatErrorBoundary>
              </div>
            ) : (
              <div className="h-full grid place-items-center text-sm text-muted">
                No AI providers available.
              </div>
            )
          ) : error ? (
            <ErrorState message={error} />
          ) : visible.length === 0 ? (
            showOnboarding ? (
              <OnboardingState
                onSkip={() => {
                  setOnboardingDismissed(true);
                  localStorage.setItem("hub.onboarding.dismissed", "1");
                }}
              />
            ) : (
              <EmptyState dir={manifestDir ?? null} loaded={loaded} />
            )
          ) : (
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
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

function extractVoiceTranscriptText(event: { agentId: string; type: string; data: unknown }): string | null {
  if (event.agentId !== "easystt") return null;
  const acceptedTypes = new Set([
    "transcript_ready",
    "transcript",
    "speech_final",
    "voice_text",
    "text_ready",
  ]);
  if (!acceptedTypes.has(event.type)) return null;
  if (typeof event.data === "string" && event.data.trim()) return event.data.trim();
  if (!event.data || typeof event.data !== "object") return null;
  const payload = event.data as Record<string, unknown>;
  const textCandidate = payload.text ?? payload.transcript ?? payload.value ?? payload.message;
  return typeof textCandidate === "string" && textCandidate.trim() ? textCandidate.trim() : null;
}

function VoiceTranscriptBar({
  value,
  autoSend,
  onToggleAutoSend,
  onUseInChat,
  onDismiss,
}: {
  value: string | null;
  autoSend: boolean;
  onToggleAutoSend: () => void;
  onUseInChat: () => void;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  if (!value) return null;
  return (
    <div className="fixed bottom-4 right-4 z-40 w-[min(560px,calc(100vw-2rem))] rounded-xl border border-border-default bg-bg-card/95 backdrop-blur p-3 shadow-card">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-xs uppercase tracking-wider text-muted">
          {t("voicebar.title")} · {t("voicebar.fromEasyStt")}
        </div>
      </div>
      <div className="text-sm text-slate-100 bg-bg-elev/60 rounded-lg border border-border-subtle px-2.5 py-2 mb-2 max-h-28 overflow-auto whitespace-pre-wrap break-words">
        {value}
      </div>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onToggleAutoSend}
          className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg border border-border-subtle text-muted hover:text-slate-100 hover:border-border-default transition-colors"
          title={t("voicebar.autoSendHint")}
        >
          <span className={autoSend ? "text-emerald-300" : "text-muted"}>●</span>
          {t("voicebar.autoSend")} {autoSend ? t("voicebar.on") : t("voicebar.off")}
        </button>
        <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-border-subtle text-muted hover:text-slate-100 hover:border-border-default transition-colors"
        >
          {t("voicebar.dismiss")}
        </button>
        <button
          type="button"
          onClick={onUseInChat}
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-border-default text-slate-100 hover:border-border-strong transition-colors"
        >
          {t("voicebar.useInChat")}
        </button>
        </div>
      </div>
    </div>
  );
}

function OnboardingState({ onSkip }: { onSkip: () => void }) {
  const { t } = useI18n();
  const [installingStt, setInstallingStt] = useState(false);
  const [installingAi, setInstallingAi] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const handleInstallStt = async () => {
    setInstallingStt(true);
    setMsg(null);
    try {
      await installEasysttLatest();
      const ok = await easysttInstalled();
      setMsg(ok ? t("onboarding.sttDone") : t("onboarding.sttDone"));
    } catch (e) {
      setMsg(String(e));
    } finally {
      setInstallingStt(false);
    }
  };

  const handleInstallAi = async () => {
    setInstallingAi(true);
    setMsg(null);
    try {
      await installOpenRouterAgent();
      setMsg(t("onboarding.aiDone"));
    } catch (e) {
      setMsg(String(e));
    } finally {
      setInstallingAi(false);
    }
  };

  return (
    <div className="h-full grid place-items-center">
      <div className="max-w-2xl w-full rounded-2xl border border-border-subtle bg-bg-card/50 p-5 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">{t("onboarding.title")}</h2>
          <p className="text-sm text-muted mt-1">{t("onboarding.subtitle")}</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="rounded-xl border border-border-subtle bg-bg-elev/40 p-3 space-y-2">
            <div className="font-medium">{t("onboarding.sttTitle")}</div>
            <p className="text-xs text-muted">{t("onboarding.sttDesc")}</p>
            <button
              type="button"
              onClick={handleInstallStt}
              disabled={installingStt}
              className="text-xs px-3 py-1.5 rounded-lg border border-border-subtle hover:border-border-default text-muted hover:text-slate-100 transition-colors disabled:opacity-60"
            >
              {installingStt ? t("onboarding.installing") : t("onboarding.installStt")}
            </button>
          </div>
          <div className="rounded-xl border border-border-subtle bg-bg-elev/40 p-3 space-y-2">
            <div className="font-medium">{t("onboarding.aiTitle")}</div>
            <p className="text-xs text-muted">{t("onboarding.aiDesc")}</p>
            <button
              type="button"
              onClick={handleInstallAi}
              disabled={installingAi}
              className="text-xs px-3 py-1.5 rounded-lg border border-border-subtle hover:border-border-default text-muted hover:text-slate-100 transition-colors disabled:opacity-60"
            >
              {installingAi ? t("onboarding.installing") : t("onboarding.installAi")}
            </button>
          </div>
        </div>
        {msg && <div className="text-xs text-muted break-words">{msg}</div>}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onSkip}
            className="text-xs px-3 py-1.5 rounded-lg border border-border-subtle text-muted hover:text-slate-100 hover:border-border-default transition-colors"
          >
            {t("onboarding.skip")}
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ dir, loaded }: { dir: string | null; loaded: boolean }) {
  const { t } = useI18n();
  const path = dir ?? "~/.config/agent-hub/agents/";
  return (
    <div className="h-full grid place-items-center text-center">
      <div className="max-w-md">
        <div className="text-lg font-semibold mb-1">
          {loaded ? t("empty.title.none") : t("empty.title.wait")}
        </div>
        <p className="text-sm text-muted">
          {t("empty.intro")}{" "}
          <code className="font-mono text-xs px-1.5 py-0.5 rounded bg-bg-card border border-border-subtle break-all">
            {path}
          </code>{" "}
          {t("empty.outro")}
        </p>
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  const { t } = useI18n();
  return (
    <div className="h-full grid place-items-center text-center">
      <div className="max-w-md">
        <div className="text-lg font-semibold text-red-300 mb-1">{t("error.loadTitle")}</div>
        <p className="text-sm text-muted break-words">{message}</p>
      </div>
    </div>
  );
}
