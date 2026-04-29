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
  Paperclip,
  Loader2,
  MessageSquarePlus,
  X,
  Send,
  Settings2,
  Download,
  Trash2,
  User,
  Pencil,
} from "lucide-react";
import {
  createConversation,
  deleteConversation,
  exportConversation,
  getConversation,
  listConversations,
  onChatStream,
  patchConversation,
  sendMessage,
  storeAttachment,
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
import { useI18n } from "@/lib/i18n";

interface ChatViewProps {
  agentId: string;
  onBack: () => void;
  onSwitchAgent?: (agentId: string) => void;
  onOpenProviderSettings?: (agentId: string) => void;
  /**
   * If set, the chat opens with this conversation pre-selected — used when
   * the command palette deep-links into a search hit. Honored once on mount
   * and whenever the value changes.
   */
  initialConversationId?: string | null;
  initialDraft?: string | null;
  initialDraftToken?: number | null;
  initialAutoSubmitToken?: number | null;
}

interface StreamState {
  requestId: string;
  conversationId: string;
  buffer: string;
  finished: boolean;
  error: string | null;
}

function partsToText(content: ChatMessage["content"] | unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) =>
        p && typeof p === "object" && "type" in p && (p as { type?: string }).type === "text"
          ? String((p as { text?: unknown }).text ?? "")
          : `[${String((p as { type?: unknown })?.type ?? "attachment")} attachment]`,
      )
      .join("\n")
      .trim();
  }
  if (content && typeof content === "object") {
    const obj = content as Record<string, unknown>;
    if (typeof obj.text === "string") return obj.text;
    if (typeof obj.content === "string") return obj.content;
    if (Array.isArray(obj.content)) return partsToText(obj.content);
    if (typeof obj.delta === "string") return obj.delta;
  }
  return String(content ?? "").trim();
}

function asTextPart(text: string): ContentPart[] {
  return [{ type: "text", text }];
}

function makeRequestId(): string {
  return `req_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

export function ChatView({
  agentId,
  onBack,
  onSwitchAgent,
  onOpenProviderSettings,
  initialConversationId,
  initialDraft,
  initialDraftToken,
  initialAutoSubmitToken,
}: ChatViewProps) {
  const { t } = useI18n();
  const modelStorageKey = `hub.chat.selectedModel.${agentId}`;
  const fontSizeStorageKey = "hub.chat.fontSizePx";
  const agent = useAgentStore((s) => s.agents[agentId]);
  const agentsMap = useAgentStore((s) => s.agents);
  const aiAgents = useMemo(
    () =>
      Object.values(agentsMap)
        .filter((a) => a?.manifest?.kind === "ai")
        .sort((a, b) =>
          String(a.manifest.name ?? a.manifest.id).localeCompare(
            String(b.manifest.name ?? b.manifest.id),
            undefined,
            { sensitivity: "base" },
          ),
        ),
    [agentsMap],
  );

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
  const [attachments, setAttachments] = useState<ContentPart[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [renamingTitle, setRenamingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [chatFontSizePx, setChatFontSizePx] = useState<number>(() => {
    const raw = Number(localStorage.getItem("hub.chat.fontSizePx"));
    if (Number.isFinite(raw)) return Math.min(22, Math.max(12, raw));
    return 14;
  });

  const streamRef = useRef<StreamState | null>(null);
  const autoSubmitTokenRef = useRef<number | null>(null);
  const sendLockRef = useRef(false);
  streamRef.current = stream;

  const accent = agent?.manifest.accent ?? "#7c5cff";
  const ai = agent?.manifest.ai;
  const attachmentKinds = Array.isArray(ai?.supports_attachments)
    ? ai.supports_attachments
    : [];
  const cachedProviderModels = useMemo(() => {
    if (!agent) return [] as string[];
    try {
      const raw = localStorage.getItem(`hub.providerModels.${agent.manifest.id}`);
      if (!raw) return [] as string[];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [] as string[];
      return parsed.filter((m): m is string => typeof m === "string" && m.trim().length > 0);
    } catch {
      return [] as string[];
    }
  }, [agent]);
  const models = useMemo(
    () =>
      (cachedProviderModels.length > 0 ? cachedProviderModels : ai?.models)?.filter(
        (m): m is string => typeof m === "string" && m.trim().length > 0,
      ) ?? [],
    [cachedProviderModels, ai?.models],
  );

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
        // Honour the deep-link target if it's actually in this agent's
        // conversation list, otherwise fall back to most-recent.
        const target =
          initialConversationId &&
          sorted.some((c) => c.id === initialConversationId)
            ? initialConversationId
            : sorted[0].id;
        setActiveId(target);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setConversationsLoading(false);
    }
  }, [agentId, activeId, initialConversationId]);

  // If a new deep-link arrives while the chat is already mounted (palette
  // jump-to-message between two open conversations), switch to it.
  useEffect(() => {
    if (initialConversationId && initialConversationId !== activeId) {
      setActiveId(initialConversationId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialConversationId]);

  useEffect(() => {
    if (!initialDraftToken || !initialDraft?.trim()) return;
    const text = initialDraft.trim();
    setDraft((prev) => (prev.trim().length > 0 ? `${prev}\n${text}` : text));
  }, [initialDraft, initialDraftToken]);

  useEffect(() => {
    if (!initialAutoSubmitToken) return;
    autoSubmitTokenRef.current = initialAutoSubmitToken;
  }, [initialAutoSubmitToken]);

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
          setTitleDraft(c.title ?? "");
          setRenamingTitle(false);
          if (!model && ai?.default_model && models.includes(ai.default_model)) {
            setModel(ai.default_model);
          }
          const messageCount = Array.isArray(c.messages) ? c.messages.length : 0;
          if (!model && messageCount === 0 && models[0]) setModel(models[0]);
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
        sendLockRef.current = false;
        getConversation(agentId, cur.conversationId)
          .then((c) => setActive(c))
          .catch(() => {});
        refreshList();
        setStream(null);
      } else if (e.type === "error") {
        const msg = (e.data as { message?: string } | undefined)?.message ?? "stream error";
        if (!/read sse chunk/i.test(msg)) {
          setError(msg);
        }
        setStream(null);
        sendLockRef.current = false;
      } else if (e.type === "start") {
        // hub already accepts deltas without start; keep for tools / metadata
      }
    }).then((u) => (unlisten = u));
    return () => unlisten?.();
  }, [agentId, refreshList]);

  useEffect(() => {
    if (!model) return;
    if (models.length === 0) return;
    if (!models.includes(model)) {
      setModel(models[0] ?? null);
    }
  }, [model, models]);

  useEffect(() => {
    if (models.length === 0) return;
    const stored = localStorage.getItem(modelStorageKey);
    if (stored && models.includes(stored)) {
      setModel(stored);
      return;
    }
    if (!model && models[0]) setModel(models[0]);
  }, [models, modelStorageKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!model) return;
    localStorage.setItem(modelStorageKey, model);
  }, [model, modelStorageKey]);

  useEffect(() => {
    localStorage.setItem(fontSizeStorageKey, String(chatFontSizePx));
  }, [chatFontSizePx, fontSizeStorageKey]);

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
    if ((!draft.trim() && attachments.length === 0) || stream || !active) return;
    if (sendLockRef.current) return;
    sendLockRef.current = true;
    let convId = active.id;
    if (!convId) {
      sendLockRef.current = false;
      return;
    }
    const requestId = makeRequestId();
    const outgoingParts: ContentPart[] = [
      ...(draft.trim() ? asTextPart(draft.trim()) : []),
      ...attachments,
    ];

    const userMsg: ChatMessage = {
      id: `local_${requestId}_user`,
      role: "user",
      content: outgoingParts,
      at: new Date().toISOString(),
    };
    const existingMessages = Array.isArray(active.messages) ? active.messages : [];
    setActive({ ...active, messages: [...existingMessages, userMsg] });
    setStream({
      requestId,
      conversationId: convId,
      buffer: "",
      finished: false,
      error: null,
    });
    setDraft("");
    setAttachments([]);
    setError(null);

    try {
      await sendMessage({
        agentId,
        conversationId: convId,
        requestId,
        content: outgoingParts,
        model: model && models.includes(model) ? model : undefined,
      });
      const cur = streamRef.current;
      // Some providers close stream without explicit `end`. Finalize locally.
      if (cur && cur.requestId === requestId) {
        setStream(null);
        sendLockRef.current = false;
        getConversation(agentId, convId)
          .then((c) => setActive(c))
          .catch(() => {});
        refreshList();
      }
    } catch (e) {
      const msg = String(e ?? "");
      if (/read sse chunk/i.test(msg)) {
        const cur = streamRef.current;
        // If we already received some tokens, treat this as a benign stream tear-down.
        // Also suppress when stream already rotated/finished (race between "end" and catch).
        if (cur && cur.requestId === requestId && cur.buffer.length === 0) {
          setError(t("chat.streamInterrupted"));
        }
        setStream(null);
        sendLockRef.current = false;
        return;
      }
      sendLockRef.current = false;
      setStream(null);
      setError(msg);
    }
  }, [agentId, active, attachments, draft, model, stream, refreshList, t]);

  useEffect(() => {
    if (!autoSubmitTokenRef.current) return;
    if (!active || stream) return;
    if (!draft.trim()) return;
    autoSubmitTokenRef.current = null;
    void handleSend();
  }, [active, draft, stream, handleSend]);
  const supportsAttachments = attachmentKinds.length > 0;

  const handlePickAttachment = useCallback(async () => {
    if (!supportsAttachments || attaching) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = [
      attachmentKinds.includes("image") ? "image/*" : "",
      attachmentKinds.includes("audio") ? "audio/*" : "",
      attachmentKinds.includes("pdf") ? "application/pdf" : "",
    ]
      .filter(Boolean)
      .join(",");
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const kind: "image" | "audio" | "pdf" = file.type.startsWith("image/")
        ? "image"
        : file.type.startsWith("audio/")
          ? "audio"
          : "pdf";
      if (!attachmentKinds.includes(kind)) {
        setError(t("chat.attachmentKindNotSupported", { kind }));
        return;
      }
      setAttaching(true);
      try {
        const dataUrl = await fileToDataUrl(file);
        const stored = await storeAttachment({
          agentId,
          kind,
          name: file.name,
          mime: file.type || (kind === "pdf" ? "application/pdf" : "application/octet-stream"),
          dataUrl,
        });
        setAttachments((prev) => [
          ...prev,
          {
            type: kind,
            attachment_id: stored.attachment_id,
            name: stored.name,
            mime: stored.mime,
            size_bytes: stored.size_bytes,
          },
        ]);
      } catch (e) {
        setError(String(e));
      } finally {
        setAttaching(false);
      }
    };
    input.click();
  }, [agentId, attachmentKinds, attaching, supportsAttachments]);


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

  const handleRenameTitle = useCallback(async () => {
    if (!active) return;
    const nextTitle = titleDraft.trim();
    if (!nextTitle) {
      setRenamingTitle(false);
      setTitleDraft(active.title ?? "");
      return;
    }
    try {
      const updated = await patchConversation(agentId, active.id, { title: nextTitle });
      setActive(updated);
      setConversations((prev) =>
        prev.map((c) => (c.id === active.id ? { ...c, title: updated.title } : c)),
      );
      setRenamingTitle(false);
    } catch (e) {
      setError(String(e));
    }
  }, [active, agentId, titleDraft]);

  const messagesForDisplay = useMemo(() => {
    if (!active) return [] as ChatMessage[];
    const safeMessages = Array.isArray(active.messages) ? active.messages : [];
    if (!stream) return safeMessages;
    const ghost: ChatMessage = {
      id: `streaming_${stream.requestId}`,
      role: "assistant",
      content: asTextPart(stream.buffer || (stream.error ? `⚠ ${stream.error}` : "")),
      at: new Date().toISOString(),
    };
    return [...safeMessages, ghost];
  }, [active, stream]);

  if (!agent) {
    return (
      <div className="h-full grid place-items-center text-sm text-muted">
        {t("chat.agentNotFound")}
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
            aria-label={t("chat.backToHub")}
            title={t("chat.backToHub")}
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
          <MessageSquarePlus size={14} /> {t("chat.newConversation")}
        </button>

        <div className="flex-1 overflow-auto px-2 pb-2 space-y-1">
          {conversationsLoading && conversations.length === 0 ? (
            <div className="px-2 py-1 text-xs text-muted">{t("chat.loading")}</div>
          ) : conversations.length === 0 ? (
            <div className="px-2 py-1 text-xs text-muted">{t("chat.noConversations")}</div>
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
                    <div className="text-[13px] truncate">{c.title || t("chat.untitled")}</div>
                    <div className="text-[10px] text-muted truncate">
                      {c.message_count ?? (Array.isArray(c.messages) ? c.messages.length : 0)} {t("chat.messages")}
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={t("chat.deleteConversation")}
                    title={t("chat.deleteConversation")}
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
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              {active && renamingTitle ? (
                <input
                  autoFocus
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={() => void handleRenameTitle()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleRenameTitle();
                    } else if (e.key === "Escape") {
                      setRenamingTitle(false);
                      setTitleDraft(active.title ?? "");
                    }
                  }}
                  className="w-full max-w-md text-sm bg-bg-elev border border-border-subtle rounded-lg px-2 py-1 outline-none focus:border-border-default"
                />
              ) : (
                <div className="font-medium text-sm truncate">
                  {active?.title || (active ? t("chat.untitled") : t("chat.pickConversation"))}
                </div>
              )}
              {active && !renamingTitle && (
                <button
                  type="button"
                  onClick={() => {
                    setTitleDraft(active.title || t("chat.untitled"));
                    setRenamingTitle(true);
                  }}
                  className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-md border border-border-subtle text-muted hover:text-slate-100 hover:border-border-default transition-colors"
                  title={t("chat.renameConversation")}
                >
                  <Pencil size={12} />
                </button>
              )}
            </div>
            <div className="text-[11px] text-muted">
              {active
                ? `${Array.isArray(active.messages) ? active.messages.length : 0} ${t("chat.messages")} · ${agent.manifest.kind === "ai" ? "AI" : agent.manifest.kind}`
                : t("chat.orStartNew")}
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-2 rounded-lg border border-border-subtle px-2 py-1 bg-bg-elev/40">
              <span className="text-[10px] text-muted">{t("chat.font")}</span>
              <input
                type="range"
                min={12}
                max={22}
                step={1}
                value={chatFontSizePx}
                onChange={(e) => setChatFontSizePx(Number(e.target.value))}
                className="w-20 accent-indigo-500"
                title={t("chat.fontSize")}
              />
              <span className="text-[10px] text-muted tabular-nums">{chatFontSizePx}px</span>
            </div>
            {aiAgents.length > 1 && (
              <select
                value={agentId}
                onChange={(e) => {
                  setError(null);
                  setShowSettings(false);
                  onSwitchAgent?.(e.target.value);
                }}
                disabled={Boolean(stream)}
                className="text-xs bg-bg-elev border border-border-subtle hover:border-border-default rounded-lg px-2 py-1 outline-none disabled:opacity-60"
                title={t("chat.provider")}
              >
                {aiAgents.map((a) => (
                  <option key={a.manifest.id} value={a.manifest.id}>
                    {a.manifest.name}
                  </option>
                ))}
              </select>
            )}
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
            {onOpenProviderSettings && (
              <button
                type="button"
                onClick={() => onOpenProviderSettings(agentId)}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-border-subtle text-muted hover:text-slate-100 hover:border-border-default transition-colors"
                title={t("chat.providerSettings")}
              >
                <Settings2 size={12} /> {t("chat.provider")}
              </button>
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
                title={t("chat.systemPrompt")}
              >
                <Settings2 size={12} /> {t("chat.system")}
              </button>
            )}
            {active && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    const out = await exportConversation(agentId, active.id);
                    setError(`${t("chat.exported")}:\n${out.markdown_path}\n${out.json_path}`);
                  } catch (e) {
                    setError(String(e));
                  }
                }}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-border-subtle text-muted hover:text-slate-100 hover:border-border-default transition-colors"
                title={t("chat.exportConversation")}
              >
                <Download size={12} /> {t("chat.export")}
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
                  {t("chat.systemPrompt")}
                </label>
                <textarea
                  value={systemDraft}
                  onChange={(e) => setSystemDraft(e.target.value)}
                  rows={4}
                  placeholder={t("chat.systemPromptPlaceholder")}
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
                    {t("chat.cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={handleSavePrompt}
                    className="text-xs px-3 py-1.5 rounded-lg border border-border-default text-slate-100 hover:border-border-strong"
                  >
                    {t("chat.save")}
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
              {t("chat.dismiss")}
            </button>
          </div>
        )}

        <MessageList
          messages={messagesForDisplay}
          accent={accent}
          isStreaming={!!stream && !stream.finished}
          empty={!active}
          fontSizePx={chatFontSizePx}
          t={t}
        />

        <Composer
          disabled={!active || !!stream}
          value={draft}
          onChange={setDraft}
          onSubmit={handleSend}
          supportsAttachments={supportsAttachments}
          attachments={attachments}
          onPickAttachment={() => void handlePickAttachment()}
          onRemoveAttachment={(idx) =>
            setAttachments((prev) => prev.filter((_, i) => i !== idx))
          }
          attaching={attaching}
          accent={accent}
          fontSizePx={chatFontSizePx}
          t={t}
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
  fontSizePx: number;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

function MessageList({ messages, accent, isStreaming, empty, fontSizePx, t }: MessageListProps) {
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
            {t("chat.pickLeftOrStart")}
          </div>
        ) : messages.length === 0 ? (
          <div className="h-[40vh] grid place-items-center text-center">
            <div className="max-w-sm">
              <div className="font-semibold mb-1">{t("chat.sendFirstMessage")}</div>
              <p className="text-sm text-muted">
                {t("chat.emptyHint")}
              </p>
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <Bubble key={m.id} message={m} accent={accent} fontSizePx={fontSizePx} t={t} />
          ))
        )}
      </div>
    </div>
  );
}

function Bubble({
  message,
  accent,
  fontSizePx,
  t,
}: {
  message: ChatMessage;
  accent: string;
  fontSizePx: number;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
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
          "max-w-[78%] rounded-2xl px-4 py-2.5 border",
          isUser
            ? "bg-bg-elev/70 border-border-subtle"
            : "bg-bg-card/80 border-border-subtle",
        )}
        style={{ fontSize: `${fontSizePx}px` }}
      >
        {text ? (
          <Markdown>{text}</Markdown>
        ) : (
          <span className="inline-flex items-center gap-1 text-muted text-xs">
            <Loader2 size={12} className="animate-spin" /> {t("chat.thinking")}
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
  supportsAttachments: boolean;
  attachments: ContentPart[];
  onPickAttachment: () => void;
  onRemoveAttachment: (idx: number) => void;
  attaching: boolean;
  accent: string;
  fontSizePx: number;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

function Composer({
  disabled,
  value,
  onChange,
  onSubmit,
  supportsAttachments,
  attachments,
  onPickAttachment,
  onRemoveAttachment,
  attaching,
  accent,
  fontSizePx,
  t,
}: ComposerProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!taRef.current) return;
    taRef.current.style.height = "auto";
    taRef.current.style.height = `${Math.min(taRef.current.scrollHeight, 220)}px`;
  }, [value]);

  return (
    <div className="border-t border-border-subtle bg-bg-card/30 px-5 py-3">
      <div className="max-w-3xl mx-auto flex items-end gap-2">
        <button
          type="button"
          disabled={disabled || !supportsAttachments || attaching}
          onClick={onPickAttachment}
          className="inline-flex items-center justify-center w-10 h-10 rounded-xl border border-border-subtle text-muted hover:text-slate-100 hover:border-border-default transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label={t("chat.attachFile")}
          title={supportsAttachments ? t("chat.attachFile") : t("chat.attachmentsNotSupported")}
        >
          {attaching ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} />}
        </button>
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
          placeholder={disabled ? t("chat.streaming") : t("chat.placeholder")}
          rows={1}
          disabled={disabled}
          className="flex-1 resize-none bg-bg-elev border border-border-subtle rounded-2xl px-4 py-2.5 text-sm outline-none focus:border-border-default placeholder:text-muted/70 disabled:opacity-50"
          style={{ fontSize: `${fontSizePx}px` }}
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled || (!value.trim() && attachments.length === 0)}
          className="inline-flex items-center justify-center w-10 h-10 rounded-xl border transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            borderColor: `${accent}66`,
            background: `${accent}1a`,
            color: accent,
          }}
          aria-label={t("chat.send")}
          title={t("chat.send")}
        >
          <Send size={16} />
        </button>
      </div>
      {attachments.length > 0 && (
        <div className="max-w-3xl mx-auto mt-2 flex flex-wrap gap-1.5">
          {attachments.map((p, i) => (
            <span
              key={`${"attachment_id" in p ? p.attachment_id : i}`}
              className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md border border-border-subtle bg-bg-elev/70"
            >
              {"name" in p ? p.name : t("chat.attachment")}
              <button
                type="button"
                onClick={() => onRemoveAttachment(i)}
                className="text-muted hover:text-slate-100"
                aria-label={t("chat.removeAttachment")}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
}
