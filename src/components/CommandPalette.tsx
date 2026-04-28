import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bot,
  ExternalLink,
  Mic,
  MessageSquare,
  Play,
  Search,
  Settings2,
  Square,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useAgentStore } from "@/store/agents";
import {
  openNative,
  searchChats,
  startManagedAgent,
  stopManagedAgent,
  type ChatSearchHit,
} from "@/lib/api";
import type { Agent, AgentKind } from "@/types/agent";
import { cn } from "@/lib/cn";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onOpenChat: (id: string, conversationId?: string | null) => void;
  onOpenDetail: (id: string) => void;
}

interface PaletteAction {
  id: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  agentId: string;
  agentName: string;
  agentKind: AgentKind;
  accent: string;
  run: () => void;
  /** Used to break ties — actions get sorted descending by score. */
  weight: number;
  searchable: string;
}

const KIND_ICON: Record<AgentKind, LucideIcon> = {
  ai: Bot,
  utility: Wrench,
  service: Mic,
};

export function CommandPalette({
  open,
  onClose,
  onOpenChat,
  onOpenDetail,
}: CommandPaletteProps) {
  const agentsMap = useAgentStore((s) => s.agents);
  const agents = useMemo(() => Object.values(agentsMap), [agentsMap]);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [chatHits, setChatHits] = useState<ChatSearchHit[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const actions = useMemo(
    () => buildActions(agents, { onOpenChat, onOpenDetail }),
    [agents, onOpenChat, onOpenDetail],
  );

  // Debounced FTS over the local chat cache. Only fires for non-trivial
  // queries — single-character searches just produce too much noise to
  // be useful and would beat on the agent list ordering.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setChatHits([]);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      searchChats(q, 8)
        .then((hits) => {
          if (!cancelled) setChatHits(hits);
        })
        .catch((e) => {
          if (!cancelled) {
            console.warn("[palette] chat search failed:", e);
            setChatHits([]);
          }
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [query]);

  // Map FTS hits to palette actions so they share keyboard navigation,
  // run handler, and accent-coloured rows with the rest of the palette.
  const hitActions = useMemo(
    () => buildHitActions(chatHits, agents, { onOpenChat }),
    [chatHits, agents, onOpenChat],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return [...actions]
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 20);
    }
    const scored = actions
      .map((a) => ({ a, score: scoreMatch(a.searchable, q) }))
      .filter((x) => x.score > 0);
    scored.sort((x, y) => y.score - x.score || y.a.weight - x.a.weight);
    // Agent actions first (they're more "verb-like" and exact), then FTS
    // hits — capped together at a sane size for keyboard nav.
    const agentActions = scored.slice(0, 12).map((x) => x.a);
    return [...agentActions, ...hitActions].slice(0, 20);
  }, [actions, hitActions, query]);

  // Reset state when the palette opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Clamp cursor when results change.
  useEffect(() => {
    setCursor((c) => Math.max(0, Math.min(c, filtered.length - 1)));
  }, [filtered.length]);

  // Keep the active row in view as the cursor moves.
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-index="${cursor}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const run = useCallback(
    (action: PaletteAction) => {
      action.run();
      onClose();
    },
    [onClose],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, Math.max(0, filtered.length - 1)));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => Math.max(0, c - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const action = filtered[cursor];
        if (action) run(action);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [cursor, filtered, onClose, run],
  );

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            onClick={(e) => e.stopPropagation()}
            className="w-[640px] max-w-[92vw] rounded-2xl border border-border-default bg-bg-card shadow-card overflow-hidden"
          >
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle">
              <Search size={16} className="text-muted" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setCursor(0);
                }}
                onKeyDown={onKeyDown}
                placeholder="Type a command — chat, start, open settings…"
                className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted/70"
              />
              <kbd className="hidden sm:inline-flex text-[10px] font-mono px-1.5 py-0.5 rounded border border-border-subtle text-muted">
                Esc
              </kbd>
            </div>

            <div ref={listRef} className="max-h-[60vh] overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted">
                  No matches. Try the agent's name or “chat”, “start”, “open”.
                </div>
              ) : (
                <ul>
                  {filtered.map((action, i) => (
                    <li key={action.id}>
                      <button
                        type="button"
                        data-index={i}
                        onMouseEnter={() => setCursor(i)}
                        onClick={() => run(action)}
                        className={cn(
                          "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors",
                          i === cursor
                            ? "bg-bg-elev/80 text-slate-100"
                            : "text-slate-200 hover:bg-bg-elev/50",
                        )}
                      >
                        <ActionIcon action={action} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm truncate">{action.label}</div>
                          <div className="text-[11px] text-muted truncate">
                            {action.hint}
                          </div>
                        </div>
                        <span
                          className="hidden md:inline-flex text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-border-subtle text-muted shrink-0"
                          style={{ color: action.accent, borderColor: `${action.accent}55` }}
                        >
                          {action.agentName}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex items-center gap-3 px-4 py-2 border-t border-border-subtle text-[11px] text-muted">
              <Hint k="↑↓" label="navigate" />
              <Hint k="↵" label="run" />
              <Hint k="Esc" label="close" />
              <span className="ml-auto opacity-60">⌘K · Ctrl+K</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ActionIcon({ action }: { action: PaletteAction }) {
  const { icon: Icon, agentKind, accent } = action;
  const KindIcon = KIND_ICON[agentKind];
  return (
    <div className="relative shrink-0">
      <div
        className="w-8 h-8 rounded-lg grid place-items-center"
        style={{
          background: `linear-gradient(135deg, ${accent}26, ${accent}0d)`,
          color: accent,
        }}
      >
        <Icon size={14} />
      </div>
      <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-bg-card border border-border-subtle grid place-items-center text-muted">
        <KindIcon size={9} />
      </div>
    </div>
  );
}

function Hint({ k, label }: { k: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <kbd className="font-mono px-1 py-0.5 rounded border border-border-subtle text-muted text-[10px]">
        {k}
      </kbd>
      <span>{label}</span>
    </span>
  );
}

interface BuildOpts {
  onOpenChat: (id: string) => void;
  onOpenDetail: (id: string) => void;
}

function buildActions(agents: Agent[], opts: BuildOpts): PaletteAction[] {
  const out: PaletteAction[] = [];
  for (const agent of agents) {
    const { manifest, runtime } = agent;
    const accent = manifest.accent ?? "#7c5cff";
    const isAlive = runtime.status === "running" || runtime.status === "busy";
    const isManaged = manifest.lifecycle === "managed";
    const isAi = manifest.kind === "ai";

    const tagBlob = (manifest.tags ?? []).join(" ");
    const base = `${manifest.name} ${manifest.id} ${manifest.tagline ?? ""} ${tagBlob}`.toLowerCase();

    if (isAi) {
      out.push({
        id: `chat:${manifest.id}`,
        label: `Chat with ${manifest.name}`,
        hint: manifest.tagline ?? "Open chat view",
        icon: MessageSquare,
        agentId: manifest.id,
        agentName: manifest.name,
        agentKind: manifest.kind,
        accent,
        weight: isAlive ? 100 : 60,
        searchable: `chat with ${base}`,
        run: () => opts.onOpenChat(manifest.id),
      });
    }

    out.push({
      id: `details:${manifest.id}`,
      label: `Open details: ${manifest.name}`,
      hint: "Status, logs, config",
      icon: Settings2,
      agentId: manifest.id,
      agentName: manifest.name,
      agentKind: manifest.kind,
      accent,
      weight: 50,
      searchable: `open details settings ${base}`,
      run: () => opts.onOpenDetail(manifest.id),
    });

    if (!isAi) {
      out.push({
        id: `native:${manifest.id}`,
        label: `Open native UI: ${manifest.name}`,
        hint: "POST /open-native-ui",
        icon: ExternalLink,
        agentId: manifest.id,
        agentName: manifest.name,
        agentKind: manifest.kind,
        accent,
        weight: isAlive ? 80 : 30,
        searchable: `open native ui ${base}`,
        run: () => {
          openNative(manifest.id).catch((e) =>
            console.error("[palette] open native failed:", e),
          );
        },
      });
    }

    if (isManaged && !isAlive) {
      out.push({
        id: `start:${manifest.id}`,
        label: `Start ${manifest.name}`,
        hint: "Spawn the executable from the manifest",
        icon: Play,
        agentId: manifest.id,
        agentName: manifest.name,
        agentKind: manifest.kind,
        accent,
        weight: 40,
        searchable: `start run launch ${base}`,
        run: () => {
          startManagedAgent(manifest.id).catch((e) =>
            console.error("[palette] start failed:", e),
          );
        },
      });
    }
    if (isManaged && isAlive) {
      out.push({
        id: `stop:${manifest.id}`,
        label: `Stop ${manifest.name}`,
        hint: "Graceful POST /quit, then SIGTERM/SIGKILL",
        icon: Square,
        agentId: manifest.id,
        agentName: manifest.name,
        agentKind: manifest.kind,
        accent,
        weight: 35,
        searchable: `stop kill quit ${base}`,
        run: () => {
          stopManagedAgent(manifest.id).catch((e) =>
            console.error("[palette] stop failed:", e),
          );
        },
      });
    }
  }
  return out;
}

interface HitOpts {
  onOpenChat: (id: string, conversationId?: string | null) => void;
}

/**
 * Renders FTS hits as palette actions. Snippet comes back from SQLite
 * already wrapped in `[...]` markers around match terms — we leave them
 * in: they're tiny visual highlight cues even without rich formatting.
 */
function buildHitActions(
  hits: ChatSearchHit[],
  agents: Agent[],
  opts: HitOpts,
): PaletteAction[] {
  const byId = new Map(agents.map((a) => [a.manifest.id, a]));
  return hits.map((h) => {
    const agent = byId.get(h.agent_id);
    const accent = agent?.manifest.accent ?? "#7c5cff";
    const agentName = agent?.manifest.name ?? h.agent_id;
    const kind = (agent?.manifest.kind ?? "ai") as AgentKind;
    const title = h.conversation_title?.trim() || "Untitled";
    const role = h.role === "assistant" ? "AI" : "You";
    return {
      id: `hit:${h.message_id}`,
      label: h.snippet,
      hint: `${role} · ${title}`,
      icon: MessageSquare,
      agentId: h.agent_id,
      agentName,
      agentKind: kind,
      accent,
      weight: 75,
      searchable: h.snippet.toLowerCase(),
      run: () => opts.onOpenChat(h.agent_id, h.conversation_id),
    };
  });
}

/**
 * Tiny case-insensitive scorer:
 *  - 100 for full prefix match (whole haystack starts with the query)
 *  - 60 for word-boundary prefix (any word of the haystack starts with the query)
 *  - 30 for any substring match
 *  - 0 otherwise
 *
 * Anything fancier than this hurts more than it helps — there are at most a
 * couple dozen actions in a hub.
 */
function scoreMatch(haystack: string, query: string): number {
  if (haystack.startsWith(query)) return 100 + Math.max(0, 30 - haystack.length);
  for (const word of haystack.split(/\s+/)) {
    if (word.startsWith(query)) return 60;
  }
  if (haystack.includes(query)) return 30;
  // graceful subsequence match (chars in order, not necessarily adjacent)
  let i = 0;
  for (const ch of haystack) {
    if (ch === query[i]) i++;
    if (i === query.length) return 10;
  }
  return 0;
}
