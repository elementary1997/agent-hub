import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Bot,
  Loader2,
  MessageSquarePlus,
  Send,
  Settings2,
  Trash2,
  User,
} from "lucide-react";
import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  onChatStream,
  patchConversation,
  sendMessage,
} from "@/lib/chat";
import type {
  ChatConversation,
  ChatMessage,
  ChatStreamEvent,
  ContentPart,
} from "@/types/chat";
import { useAgentStore } from "@/store/agents";
import { Markdown } from "@/components/Markdown";
import { cn } from "@/lib/cn";

interface ChatViewProps {
  agentId: string;
  onBack: () => void;
}

interface StreamState {
  requestId: string;
  conversationId: string;
  buffer: string;
  finished: boolean;
  error: string | null;
}

function partsToText(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .map((p) => (p.type === "text" ? p.text : `[${p.type} attachment]`))
    .join("\n")
    .trim();
}

function asTextPart(text: string): ContentPart[] {
  return [{ type: "text", text }];
}

function makeRequestId(): string {
  return `req_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

export function ChatView({ agentId, onBack }: ChatViewProps) {
  const agent = useAgentStore((s) => s.agents[agentId]);

  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [active, setActive] = useState<ChatConversation | null>(null);

  const [draft, setDraft] = useState("");
  const [stream, setStream] = useState<StreamState | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [systemDraft, setSystemDraft] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<StreamState | null>(null);
  streamRef.current = stream;

  const accent = agent?.manifest.accent ?? "#7c5cff";
  const ai = agent?.manifest.ai;
  const models = ai?.models ?? [];

  const refreshList = useCallback(async () => {
    setConversationsLoading(true);
    try {
      const list = await listConversations(agentId);
      const sorted = [...list].sort(
        (a, b) =>
          new Date(b.updated_at ?? 0).getTime() -
          new Date(a.updated_at ?? 0).getTime(),
      );
      setConversations(sorted);
      if (!activeId && sorted.length > 0) {
        setActiveId(sorted[0].id);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setConversationsLoading(false);
    }
  }, [agentId, activeId]);

  useEffect(() => {
    setActiveId(null);
    setActive(null);
    refreshList();
  }, [agentId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!activeId) {
      setActive(null);
      return;
    }
    let cancelled = false;
    getConversation(agentId, activeId)
      .then((c) => {
        if (!cancelled) {
          setActive(c);
          setSystemDraft(c.system_prompt ?? "");
          if (!model && ai?.default_model) setModel(ai.default_model);
          if (!model && c.messages.length === 0 && models[0]) setModel(models[0]);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [agentId, activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    onChatStream((e: ChatStreamEvent) => {
      const cur = streamRef.current;
      if (!cur || cur.requestId !== e.requestId) return;
      if (e.type === "delta") {
        const data = e.data as { text?: string } | undefined;
        const text = data?.text ?? "";
        setStream({ ...cur, buffer: cur.buffer + text });
      } else if (e.type === "end") {
        setStream({ ...cur, finished: true });
        getConversation(agentId, cur.conversationId)
          .then((c) => setActive(c))
          .catch(() => {});
        refreshList();
        setStream(null);
      } else if (e.type === "error") {
        const msg = (e.data as { message?: string } | undefined)?.message ?? "stream error";
        setStream({ ...cur, error: msg, finished: true });
      } else if (e.type === "start") {
        // hub already accepts deltas without start; keep for tools / metadata
      }
    }).then((u) => (unlisten = u));
    return () => unlisten?.();
  }, [agentId, refreshList]);

  const handleNew = useCallback(async () => {
    try {
      const c = await createConversation(agentId, {});
      setConversations((prev) => [c, ...prev]);
      setActiveId(c.id);
    } catch (e) {
      setError(String(e));
    }
  }, [agentId]);

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await deleteConversation(agentId, id);
        setConversations((prev) => prev.filter((c) => c.id !== id));
        if (activeId === id) setActiveId(null);
      } catch (e) {
        setError(String(e));
      }
    },
    [agentId, activeId],
  );

  const handleSend = useCallback(async () => {
    if (!draft.trim() || stream || !active) return;
    let convId = active.id;
    if (!convId) return;
    const requestId = makeRequestId();

    const userMsg: ChatMessage = {
      id: `local_${requestId}_user`,
      role: "user",
      content: asTextPart(draft.trim()),
      at: new Date().toISOString(),
    };
    setActive({ ...active, messages: [...active.messages, userMsg] });
    setStream({
      requestId,
      conversationId: convId,
      buffer: "",
      finished: false,
      error: null,
    });
    const text = draft.trim();
    setDraft("");

    try {
      await sendMessage({
        agentId,
        conversationId: convId,
        requestId,
        content: asTextPart(text),
        model: model ?? undefined,
      });
    } catch (e) {
      setStream(null);
      setError(String(e));
    }
  }, [agentId, active, draft, model, stream]);

  const handleSavePrompt = useCallback(async () => {
    if (!active) return;
    try {
      const updated = await patchConversation(agentId, active.id, {
        system_prompt: systemDraft,
      });
      setActive(updated);
      setShowSettings(false);
    } catch (e) {
      setError(String(e));
    }
  }, [agentId, active, systemDraft]);

  const messagesForDisplay = useMemo(() => {
    if (!active) return [] as ChatMessage[];
    if (!stream) return active.messages;
    const ghost: ChatMessage = {
      id: `streaming_${stream.requestId}`,
      role: "assistant",
      content: asTextPart(stream.buffer || (stream.error ? `⚠ ${stream.error}` : "")),
      at: new Date().toISOString(),
    };
    return [...active.messages, ghost];
  }, [active, stream]);

  if (!agent) {
    return (
      <div className="h-full grid place-items-center text-sm text-muted">
        Agent not found.
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Conversation rail */}
      <aside className="w-64 shrink-0 border-r border-border-subtle bg-bg-card/40 flex flex-col">
        <div className="p-3 border-b border-border-subtle flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-border-subtle hover:border-border-default text-muted hover:text-slate-100 transition-colors"
            aria-label="Back to hub"
            title="Back to hub"
          >
            <ArrowLeft size={14} />
          </button>
          <div className="min-w-0">
            <div className="font-semibold text-sm truncate" style={{ color: accent }}>
              {agent.manifest.name}
            </div>
            <div className="text-[11px] text-muted truncate">{agent.manifest.tagline}</div>
          </div>
        </div>

        <button
          type="button"
          onClick={handleNew}
          className="m-3 inline-flex items-center justify-center gap-2 text-xs px-3 py-2 rounded-lg border border-dashed border-border-default text-muted hover:text-slate-100 hover:border-border-strong transition-colors"
        >
          <MessageSquarePlus size={14} /> New conversation
        </button>

        <div className="flex-1 overflow-auto px-2 pb-2 space-y-1">
          {conversationsLoading && conversations.length === 0 ? (
            <div className="px-2 py-1 text-xs text-muted">Loading…</div>
          ) : conversations.length === 0 ? (
            <div className="px-2 py-1 text-xs text-muted">No conversations yet.</div>
          ) : (
            conversations.map((c) => {
              const isActive = c.id === activeId;
              return (
                <div
                  key={c.id}
                  className={cn(
                    "group flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors",
                    isActive
                      ? "bg-bg-elev text-slate-100"
                      : "text-muted hover:text-slate-200 hover:bg-bg-elev/60",
                  )}
                  onClick={() => setActiveId(c.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] truncate">{c.title || "Untitled"}</div>
                    <div className="text-[10px] text-muted truncate">
                      {c.message_count ?? c.messages.length} messages
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label="Delete conversation"
                    title="Delete conversation"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDelete(c.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-muted hover:text-danger transition-opacity"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* Chat panel */}
      <section className="flex-1 flex flex-col min-w-0">
        <header className="px-5 py-3 border-b border-border-subtle flex items-center gap-3 bg-bg-card/30">
          <div className="min-w-0">
            <div className="font-medium text-sm truncate">
              {active?.title || (active ? "Untitled" : "Pick a conversation")}
            </div>
            <div className="text-[11px] text-muted">
              {active
                ? `${active.messages.length} messages · ${agent.manifest.kind === "ai" ? "AI" : agent.manifest.kind}`
                : "or start a new one →"}
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {models.length > 1 && (
              <select
                value={model ?? ""}
                onChange={(e) => setModel(e.target.value)}
                className="text-xs bg-bg-elev border border-border-subtle hover:border-border-default rounded-lg px-2 py-1 outline-none"
              >
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            )}
            {active && ai?.system_prompt_editable && (
              <button
                type="button"
                onClick={() => setShowSettings((v) => !v)}
                className={cn(
                  "inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors",
                  showSettings
                    ? "border-border-strong text-slate-100"
                    : "border-border-subtle text-muted hover:text-slate-100 hover:border-border-default",
                )}
                title="System prompt"
              >
                <Settings2 size={12} /> System
              </button>
            )}
          </div>
        </header>

        <AnimatePresence>
          {showSettings && active && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden border-b border-border-subtle bg-bg-card/40"
            >
              <div className="p-4 space-y-3">
                <label className="text-xs uppercase tracking-wider text-muted">
                  System prompt
                </label>
                <textarea
                  value={systemDraft}
                  onChange={(e) => setSystemDraft(e.target.value)}
                  rows={4}
                  placeholder="You are a helpful assistant…"
                  className="w-full bg-bg-elev border border-border-subtle rounded-lg p-2 text-sm font-mono outline-none focus:border-border-default"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSystemDraft(active.system_prompt ?? "");
                      setShowSettings(false);
                    }}
                    className="text-xs px-3 py-1.5 rounded-lg border border-border-subtle text-muted hover:text-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSavePrompt}
                    className="text-xs px-3 py-1.5 rounded-lg border border-border-default text-slate-100 hover:border-border-strong"
                  >
                    Save
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {error && (
          <div className="px-4 py-2 text-xs text-red-300 bg-red-500/5 border-b border-red-500/20">
            {error}
            <button
              type="button"
              onClick={() => setError(null)}
              className="ml-2 underline opacity-70 hover:opacity-100"
            >
              dismiss
            </button>
          </div>
        )}

        <MessageList
          messages={messagesForDisplay}
          accent={accent}
          isStreaming={!!stream && !stream.finished}
          empty={!active}
        />

        <Composer
          disabled={!active || !!stream}
          value={draft}
          onChange={setDraft}
          onSubmit={handleSend}
          accent={accent}
        />
      </section>
    </div>
  );
}

interface MessageListProps {
  messages: ChatMessage[];
  accent: string;
  isStreaming: boolean;
  empty: boolean;
}

function MessageList({ messages, accent, isStreaming, empty }: MessageListProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, isStreaming, messages[messages.length - 1]?.content]);

  return (
    <div ref={ref} className="flex-1 overflow-auto">
      <div className="max-w-3xl mx-auto px-5 py-6 space-y-5">
        {empty ? (
          <div className="h-[40vh] grid place-items-center text-sm text-muted">
            Pick a conversation on the left or start a new one.
          </div>
        ) : messages.length === 0 ? (
          <div className="h-[40vh] grid place-items-center text-center">
            <div className="max-w-sm">
              <div className="font-semibold mb-1">Send the first message</div>
              <p className="text-sm text-muted">
                The agent will respond with streaming tokens. You can change the
                system prompt and model from the header.
              </p>
            </div>
          </div>
        ) : (
          messages.map((m) => <Bubble key={m.id} message={m} accent={accent} />)
        )}
      </div>
    </div>
  );
}

function Bubble({ message, accent }: { message: ChatMessage; accent: string }) {
  const isUser = message.role === "user";
  const text = partsToText(message.content);
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className={cn("flex gap-3", isUser ? "flex-row-reverse" : "flex-row")}
    >
      <div
        className="shrink-0 w-7 h-7 rounded-full grid place-items-center border border-border-subtle"
        style={{
          background: isUser
            ? "rgba(255,255,255,0.04)"
            : `linear-gradient(135deg, ${accent}33, ${accent}11)`,
          color: isUser ? "#cbd5e1" : accent,
        }}
      >
        {isUser ? <User size={13} /> : <Bot size={13} />}
      </div>
      <div
        className={cn(
          "max-w-[78%] rounded-2xl px-4 py-2.5 text-[14px] border",
          isUser
            ? "bg-bg-elev/70 border-border-subtle"
            : "bg-bg-card/80 border-border-subtle",
        )}
      >
        {text ? (
          <Markdown>{text}</Markdown>
        ) : (
          <span className="inline-flex items-center gap-1 text-muted text-xs">
            <Loader2 size={12} className="animate-spin" /> thinking…
          </span>
        )}
      </div>
    </motion.div>
  );
}

interface ComposerProps {
  disabled: boolean;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  accent: string;
}

function Composer({ disabled, value, onChange, onSubmit, accent }: ComposerProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!taRef.current) return;
    taRef.current.style.height = "auto";
    taRef.current.style.height = `${Math.min(taRef.current.scrollHeight, 220)}px`;
  }, [value]);

  return (
    <div className="border-t border-border-subtle bg-bg-card/30 px-5 py-3">
      <div className="max-w-3xl mx-auto flex items-end gap-2">
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!disabled) onSubmit();
            }
          }}
          placeholder={disabled ? "Streaming…" : "Send a message — Enter to submit, Shift+Enter for newline"}
          rows={1}
          disabled={disabled}
          className="flex-1 resize-none bg-bg-elev border border-border-subtle rounded-2xl px-4 py-2.5 text-sm outline-none focus:border-border-default placeholder:text-muted/70 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled || !value.trim()}
          className="inline-flex items-center justify-center w-10 h-10 rounded-xl border transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            borderColor: `${accent}66`,
            background: `${accent}1a`,
            color: accent,
          }}
          aria-label="Send"
          title="Send"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
