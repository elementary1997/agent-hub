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
  Power,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useAgentStore } from "@/store/agents";
import {
  getAutoStart,
  getChatDbStats,
  setAutoStart,
  type AutoStartView,
  type ChatDbStats,
} from "@/lib/api";

interface SettingsViewProps {
  onBack: () => void;
}

interface AutoStartRow {
  agentId: string;
  name: string;
  accent: string;
  view: AutoStartView | null;
  managed: boolean;
}

const HOTKEYS: { combo: string; what: string; note?: string }[] = [
  { combo: "Ctrl+Shift+H", what: "Show / focus hub", note: "global" },
  { combo: "⌘K / Ctrl+K", what: "Open command palette" },
  { combo: "↑ ↓", what: "Navigate palette / lists" },
  { combo: "Enter", what: "Run selected action" },
  { combo: "Esc", what: "Close palette / dialog" },
];

export function SettingsView({ onBack }: SettingsViewProps) {
  const agentsMap = useAgentStore((s) => s.agents);
  const manifestDir = useAgentStore((s) => s.manifestDir);

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

  return (
    <div className="h-full w-full overflow-auto bg-bg-base text-slate-200">
      <header className="sticky top-0 z-10 backdrop-blur bg-bg-base/80 border-b border-border-subtle">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="p-2 rounded-lg hover:bg-bg-card/60 text-muted hover:text-slate-200 transition-colors"
            title="Back"
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <div className="text-lg font-semibold">Settings</div>
            <div className="text-xs text-muted">Hub-wide configuration</div>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
        <Section icon={Hash} title="Build">
          <Row label="Version" value={`v${__APP_VERSION__}`} />
          <Row label="Git" value={__GIT_HASH__ || "unknown"} mono />
          <Row label="Built at" value={formatBuildAt(__BUILD_AT__)} />
        </Section>

        <Section icon={Keyboard} title="Hotkeys">
          <div className="divide-y divide-border-subtle/60">
            {HOTKEYS.map((h) => (
              <div
                key={h.combo}
                className="flex items-center gap-3 py-2 text-sm"
              >
                <kbd className="font-mono text-[11px] px-2 py-0.5 rounded border border-border-default text-slate-100 bg-bg-card">
                  {h.combo}
                </kbd>
                <span className="flex-1">{h.what}</span>
                {h.note && (
                  <span className="text-[10px] uppercase tracking-wider text-muted">
                    {h.note}
                  </span>
                )}
              </div>
            ))}
          </div>
          <div className="mt-3 text-[11px] text-muted">
            Custom bindings land in v0.4.2 — for now the global hotkey is
            best-effort: if another app already owns the combo, the rest of
            the hub still boots.
          </div>
        </Section>

        <Section icon={FolderOpen} title="Storage">
          <Row
            label="Manifest directory"
            value={manifestDir ?? "~/.config/agent-hub/agents/"}
            mono
          />
          {statsError ? (
            <div className="text-xs text-red-300">
              chat database stats failed: {statsError}
            </div>
          ) : statsLoading ? (
            <div className="text-xs text-muted">Loading chat stats…</div>
          ) : stats ? (
            <>
              <Row label="Chat database" value={stats.path} mono />
              <Row label="Database size" value={formatBytes(stats.size_bytes)} />
              <Row
                label="Conversations cached"
                value={String(stats.conversations)}
              />
              <Row
                label="Messages cached"
                value={`${stats.messages} (${stats.fts_indexed} indexed)`}
              />
            </>
          ) : (
            <div className="text-xs text-muted">
              Chat cache disabled (database failed to open at startup).
            </div>
          )}
          <div className="pt-2">
            <button
              type="button"
              onClick={refreshStats}
              className="inline-flex items-center gap-2 text-[12px] px-2.5 py-1.5 rounded-lg border border-border-subtle hover:border-border-default text-muted hover:text-slate-200 transition-colors"
            >
              <RefreshCw size={12} />
              Refresh
            </button>
          </div>
        </Section>

        <Section icon={Power} title="Auto-start with hub">
          {autoStartLoading ? (
            <div className="text-xs text-muted">Loading agents…</div>
          ) : autoStartRows.length === 0 ? (
            <div className="text-xs text-muted">
              No agents discovered yet. Drop a manifest into the directory
              above and the list will populate.
            </div>
          ) : (
            <div className="divide-y divide-border-subtle/60">
              {autoStartRows.map((r) => (
                <AutoStartRowView
                  key={r.agentId}
                  row={r}
                  onToggle={onToggleAutoStart}
                />
              ))}
            </div>
          )}
        </Section>

        <Section icon={Database} title="Chat history">
          <p className="text-xs text-muted">
            Every message you send to an AI agent is mirrored into the
            local SQLite cache so chat history survives agent crashes,
            reinstalls, and offline opens. The agent stays canonical for
            whatever it remembers — the hub just keeps a durable copy.
          </p>
          <p className="text-xs text-muted">
            Search uses SQLite FTS5 with diacritic folding and prefix
            search on the last typed token. Type ≥ 2 characters in the
            command palette to scan all cached conversations.
          </p>
        </Section>

        <Section icon={FileText} title="About">
          <Row label="App" value="Agent Hub" />
          <Row label="License" value="MIT" />
          <a
            href="https://github.com/elementary1997/agent-hub"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-2 text-[12px] px-2.5 py-1.5 rounded-lg border border-border-subtle hover:border-border-default text-muted hover:text-slate-200 transition-colors"
          >
            <Github size={12} />
            Source on GitHub
          </a>
        </Section>
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
