import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  ExternalLink,
  MessageSquare,
  Play,
  RefreshCw,
  Square,
  Terminal,
  Settings2,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useAgentStore } from "@/store/agents";
import {
  fetchAgentLogs,
  getAgentConfig,
  onAgentLog,
  openNative,
  putAgentConfig,
  startManagedAgent,
  stopManagedAgent,
  type AgentConfigResponse,
  type AgentLogLine,
} from "@/lib/api";
import { SchemaForm } from "@/components/SchemaForm";

interface AgentDetailProps {
  agentId: string;
  onBack: () => void;
  onOpenChat?: (id: string) => void;
}

type Tab = "activity" | "logs" | "config";

const STREAM_COLOR: Record<AgentLogLine["stream"], string> = {
  stdout: "text-slate-200",
  stderr: "text-red-300",
  supervisor: "text-sky-300",
};

export function AgentDetail({ agentId, onBack, onOpenChat }: AgentDetailProps) {
  const agent = useAgentStore((s) => s.agents[agentId]);
  const events = useAgentStore((s) => s.events[agentId]) ?? [];

  const [tab, setTab] = useState<Tab>("activity");
  const [logs, setLogs] = useState<AgentLogLine[]>([]);
  const [config, setConfig] = useState<AgentConfigResponse | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [actionPending, setActionPending] = useState(false);

  const accent = agent?.manifest.accent ?? "#7c5cff";
  const isAi = agent?.manifest.kind === "ai";
  const isManaged = agent?.manifest.lifecycle === "managed";
  const isAlive =
    agent?.runtime.status === "running" || agent?.runtime.status === "busy";

  const refreshLogs = useCallback(async () => {
    if (!agent) return;
    try {
      setLogs(await fetchAgentLogs(agentId));
    } catch (e) {
      console.error("[detail] log fetch failed:", e);
    }
  }, [agent, agentId]);

  const refreshConfig = useCallback(async () => {
    if (!agent) return;
    try {
      const res = await getAgentConfig(agentId);
      setConfig(res);
      setConfigError(null);
    } catch (e) {
      setConfig(null);
      setConfigError(String(e));
    }
  }, [agent, agentId]);

  useEffect(() => {
    void refreshLogs();
    void refreshConfig();
  }, [agentId, refreshLogs, refreshConfig]);

  // Live tail for log lines emitted by the supervisor.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    onAgentLog((e) => {
      if (e.agentId !== agentId) return;
      setLogs((prev) => {
        const next = [...prev, e.line];
        if (next.length > 1000) next.splice(0, next.length - 1000);
        return next;
      });
    }).then((u) => (unlisten = u));
    return () => unlisten?.();
  }, [agentId]);

  const handleStart = useCallback(async () => {
    if (!agent || !isManaged) return;
    setActionPending(true);
    try {
      await startManagedAgent(agentId);
    } catch (e) {
      console.error("[detail] start failed:", e);
    } finally {
      setActionPending(false);
    }
  }, [agent, agentId, isManaged]);

  const handleStop = useCallback(async () => {
    if (!agent || !isManaged) return;
    setActionPending(true);
    try {
      await stopManagedAgent(agentId);
    } catch (e) {
      console.error("[detail] stop failed:", e);
    } finally {
      setActionPending(false);
    }
  }, [agent, agentId, isManaged]);

  const handleOpenNative = useCallback(async () => {
    try {
      await openNative(agentId);
    } catch (e) {
      console.error("[detail] open-native failed:", e);
    }
  }, [agentId]);

  const handleSaveConfig = useCallback(
    async (values: Record<string, unknown>) => {
      setSavingConfig(true);
      try {
        const next = await putAgentConfig(agentId, values);
        setConfig(next);
        setConfigError(null);
      } catch (e) {
        setConfigError(String(e));
      } finally {
        setSavingConfig(false);
      }
    },
    [agentId],
  );

  const initialConfig = useMemo(
    () => (config?.config as Record<string, unknown> | undefined) ?? {},
    [config],
  );

  if (!agent) {
    return (
      <div className="h-full grid place-items-center text-sm text-muted">
        Agent not found.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header
        className="px-5 py-4 border-b border-border-subtle bg-bg-card/30 flex items-start gap-4"
        style={{
          background: `linear-gradient(180deg, ${accent}15, transparent 60%), rgba(13,15,24,0.4)`,
        }}
      >
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-border-subtle hover:border-border-default text-muted hover:text-slate-100 transition-colors mt-1"
          aria-label="Back to hub"
        >
          <ArrowLeft size={14} />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="font-semibold text-base truncate" style={{ color: accent }}>
              {agent.manifest.name}
            </h1>
            <StatusPill status={agent.runtime.status} />
          </div>
          <div className="text-[12px] text-muted truncate">
            {agent.manifest.tagline ?? agent.manifest.id} ·{" "}
            <code className="font-mono">{agent.manifest.endpoint}</code> ·{" "}
            v{agent.manifest.version}
          </div>
          {agent.runtime.message && (
            <div className="text-[12px] text-amber-300/90 mt-1">
              {agent.runtime.message}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isAi && (
            <ActionButton onClick={() => onOpenChat?.(agentId)} accent={accent}>
              <MessageSquare size={13} /> Chat
            </ActionButton>
          )}
          {!isAi && (
            <ActionButton onClick={handleOpenNative}>
              <ExternalLink size={13} /> Open native
            </ActionButton>
          )}
          {isManaged && isAlive && (
            <ActionButton onClick={handleStop} disabled={actionPending} variant="danger">
              <Square size={13} /> Stop
            </ActionButton>
          )}
          {isManaged && !isAlive && (
            <ActionButton onClick={handleStart} disabled={actionPending}>
              <Play size={13} /> Start
            </ActionButton>
          )}
        </div>
      </header>

      {/* Tabs */}
      <nav className="px-5 border-b border-border-subtle flex items-center gap-1 bg-bg-card/20">
        <TabButton active={tab === "activity"} onClick={() => setTab("activity")}>
          <Activity size={13} /> Activity
        </TabButton>
        <TabButton active={tab === "logs"} onClick={() => setTab("logs")}>
          <Terminal size={13} /> Logs
        </TabButton>
        <TabButton active={tab === "config"} onClick={() => setTab("config")}>
          <Settings2 size={13} /> Config
        </TabButton>

        {tab === "logs" && (
          <button
            type="button"
            onClick={refreshLogs}
            className="ml-auto inline-flex items-center gap-1 text-xs text-muted hover:text-slate-100 px-2 py-1.5"
          >
            <RefreshCw size={12} /> Refresh
          </button>
        )}
        {tab === "config" && (
          <button
            type="button"
            onClick={refreshConfig}
            className="ml-auto inline-flex items-center gap-1 text-xs text-muted hover:text-slate-100 px-2 py-1.5"
          >
            <RefreshCw size={12} /> Reload
          </button>
        )}
      </nav>

      {/* Body */}
      <div className="flex-1 overflow-auto">
        {tab === "activity" && (
          <ActivityPane events={events} />
        )}
        {tab === "logs" && <LogsPane logs={logs} />}
        {tab === "config" && (
          <div className="max-w-3xl mx-auto p-6">
            {configError ? (
              <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-300">
                <div className="font-medium mb-1">Failed to load config</div>
                <div className="text-xs break-words opacity-80">{configError}</div>
                <p className="text-xs text-muted mt-2">
                  Agents can opt out of `GET /config` if they have nothing to expose —
                  in that case there's nothing to do here.
                </p>
              </div>
            ) : config ? (
              <SchemaForm
                schema={config.schema}
                initial={initialConfig}
                onSubmit={handleSaveConfig}
                busy={savingConfig}
              />
            ) : (
              <div className="text-sm text-muted">Loading…</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  accent,
  variant,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  accent?: string;
  variant?: "danger";
}) {
  const style: React.CSSProperties | undefined = accent
    ? { borderColor: `${accent}55`, color: accent, background: `${accent}1a` }
    : undefined;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={style}
      className={cn(
        "inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors",
        !accent && variant === "danger"
          ? "border-red-500/40 text-red-300 hover:border-red-500/70 bg-red-500/5"
          : !accent
            ? "border-border-subtle text-slate-200 hover:border-border-default bg-bg-elev/50"
            : "",
        "disabled:opacity-50 disabled:cursor-not-allowed",
      )}
    >
      {children}
    </button>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 text-xs px-3 py-2.5 border-b-2 transition-colors",
        active
          ? "border-slate-200 text-slate-100"
          : "border-transparent text-muted hover:text-slate-200",
      )}
    >
      {children}
    </button>
  );
}

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full",
        "bg-bg-elev border border-border-subtle text-muted",
      )}
    >
      <span className={cn("status-dot", `status-dot--${status}`)} />
      {status}
    </span>
  );
}

function ActivityPane({ events }: { events: { type: string; data: unknown; at: number }[] }) {
  if (events.length === 0) {
    return (
      <div className="h-[40vh] grid place-items-center text-center px-6">
        <div className="max-w-sm">
          <div className="font-semibold mb-1">Quiet so far</div>
          <p className="text-sm text-muted">
            Agent events stream over the live `/events` WebSocket. As soon as
            something happens it will show up here.
          </p>
        </div>
      </div>
    );
  }
  const reversed = [...events].reverse();
  return (
    <ol className="max-w-3xl mx-auto p-6 space-y-2">
      {reversed.map((e, i) => (
        <motion.li
          key={`${e.at}-${i}`}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.12 }}
          className="flex gap-3 text-[13px] border border-border-subtle rounded-lg p-3 bg-bg-card/40"
        >
          <div className="text-[11px] text-muted shrink-0 w-20 font-mono">
            {new Date(e.at).toLocaleTimeString()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium">{e.type}</div>
            <pre className="mt-1 text-[11.5px] text-muted whitespace-pre-wrap break-words font-mono">
              {JSON.stringify(e.data, null, 2)}
            </pre>
          </div>
        </motion.li>
      ))}
    </ol>
  );
}

function LogsPane({ logs }: { logs: AgentLogLine[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.scrollTop = ref.current.scrollHeight;
  }, [logs.length]);

  if (logs.length === 0) {
    return (
      <div className="h-[40vh] grid place-items-center text-center px-6">
        <div className="max-w-sm">
          <div className="font-semibold mb-1">No logs yet</div>
          <p className="text-sm text-muted">
            Logs appear here only for managed agents — the hub captures stdout
            and stderr from the spawned process. Standalone agents (like
            easySTT) keep their own logs.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} className="h-full overflow-auto px-5 py-3 font-mono text-[12px] leading-relaxed">
      {logs.map((l, i) => (
        <div key={`${l.at}-${i}`} className="flex gap-3 py-0.5">
          <span className="text-muted/70 shrink-0 w-20">
            {new Date(l.at).toLocaleTimeString()}
          </span>
          <span className={cn("shrink-0 w-16 uppercase tracking-wider text-[10px] mt-[2px]", STREAM_COLOR[l.stream])}>
            {l.stream}
          </span>
          <span className={cn("whitespace-pre-wrap break-words", STREAM_COLOR[l.stream])}>
            {l.text}
          </span>
        </div>
      ))}
    </div>
  );
}
