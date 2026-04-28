import { motion } from "framer-motion";
import {
  Bot,
  ExternalLink,
  Globe,
  MessageSquare,
  Mic,
  Play,
  Settings,
  Square,
  Wrench,
} from "lucide-react";
import type { Agent, AgentKind } from "@/types/agent";
import { cn } from "@/lib/cn";

const KIND_ICON: Record<AgentKind, typeof Bot> = {
  ai: Bot,
  utility: Wrench,
  service: Mic,
};

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatUptime(s: number): string {
  if (s <= 0) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export interface AgentCardProps {
  agent: Agent;
  onOpenNative?: (id: string) => void;
  onOpenSettings?: (id: string) => void;
  onToggleRun?: (id: string) => void;
}

export function AgentCard({ agent, onOpenNative, onOpenSettings, onToggleRun }: AgentCardProps) {
  const { manifest, runtime } = agent;
  const Icon = KIND_ICON[manifest.kind];
  const accent = manifest.accent ?? "#7c5cff";
  const isRunning = runtime.status === "running" || runtime.status === "busy";
  const canToggle = manifest.lifecycle === "managed";
  const isAi = manifest.kind === "ai";
  const PrimaryIcon = isAi ? MessageSquare : ExternalLink;
  const primaryLabel = isAi ? "Chat" : "Open";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      whileHover={{ y: -2 }}
      className={cn(
        "group relative overflow-hidden rounded-2xl",
        "bg-bg-card border border-border-subtle",
        "shadow-card hover:border-border-default hover:shadow-glow",
        "transition-colors p-5 flex flex-col gap-4",
      )}
      style={{ ["--accent" as string]: accent }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-16 -right-16 w-44 h-44 rounded-full opacity-20 blur-3xl"
        style={{ background: accent }}
      />

      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="flex items-center justify-center w-10 h-10 rounded-xl border border-border-subtle"
            style={{
              background: `linear-gradient(135deg, ${accent}26, ${accent}0d)`,
              color: accent,
            }}
          >
            <AgentAvatar manifest={manifest} fallback={Icon} />
          </div>
          <div className="min-w-0">
            <div className="font-semibold leading-tight truncate">{manifest.name}</div>
            <div className="text-xs text-muted truncate">
              {manifest.tagline ?? manifest.id}
            </div>
          </div>
        </div>
        <span
          className={cn(
            "shrink-0 inline-flex items-center gap-1.5 text-[11px] font-medium",
            "px-2 py-1 rounded-full bg-bg-elev border border-border-subtle text-muted",
          )}
          title={`Lifecycle: ${manifest.lifecycle}`}
        >
          <span className={cn("status-dot", isRunning ? "status-dot--running" : "status-dot--offline")} />
          {isRunning ? "Running" : "Offline"}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <Metric label="Last event" value={formatRelative(runtime.lastEventAt)} />
        <Metric label="Uptime" value={formatUptime(runtime.uptimeSec)} />
        <Metric label="Version" value={manifest.version} mono />
      </div>

      {runtime.message && (
        <div className="text-xs text-muted truncate" title={runtime.message}>
          {runtime.message}
        </div>
      )}

      <div className="mt-auto flex items-center gap-2 pt-1">
        {canToggle && (
          <button
            type="button"
            onClick={() => onToggleRun?.(manifest.id)}
            className={cn(
              "inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg",
              "bg-bg-elev border border-border-subtle hover:border-border-default",
              "transition-colors",
            )}
          >
            {isRunning ? <Square size={12} /> : <Play size={12} />}
            {isRunning ? "Stop" : "Start"}
          </button>
        )}
        <button
          type="button"
          onClick={() => onOpenSettings?.(manifest.id)}
          className={cn(
            "inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg",
            "bg-bg-elev border border-border-subtle hover:border-border-default",
            "transition-colors",
          )}
        >
          <Settings size={12} />
          Settings
        </button>
        <button
          type="button"
          onClick={() => onOpenNative?.(manifest.id)}
          className={cn(
            "ml-auto inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg",
            "border transition-colors",
          )}
          style={{
            borderColor: `${accent}55`,
            color: accent,
            background: `${accent}11`,
          }}
        >
          <PrimaryIcon size={12} />
          {primaryLabel}
        </button>
      </div>
    </motion.div>
  );
}

function AgentAvatar({
  manifest,
  fallback: Fallback,
}: {
  manifest: Agent["manifest"];
  fallback: typeof Bot;
}) {
  const icon = (manifest.icon ?? "").trim();
  if (icon) {
    return (
      <img
        src={icon}
        alt={`${manifest.name} icon`}
        className="w-5 h-5 rounded object-cover"
        onError={(e) => {
          // Broken icon URLs should not break card rendering.
          e.currentTarget.style.display = "none";
        }}
      />
    );
  }

  // Built-in avatars for known agents until all manifests provide icons.
  if (manifest.id === "easystt") return <Mic size={18} strokeWidth={1.75} />;
  if (manifest.id === "openrouter-agent") return <Globe size={18} strokeWidth={1.75} />;
  return <Fallback size={18} strokeWidth={1.75} />;
}

function Metric({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-muted">{label}</span>
      <span className={cn("text-slate-200 truncate", mono && "font-mono")}>{value}</span>
    </div>
  );
}
