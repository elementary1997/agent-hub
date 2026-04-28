// Cloud Bridge — reference AI agent for Agent Hub.
//
// Implements the same Hub protocol as `examples/echo-agent`, but instead
// of bouncing the user's text it streams real LLM completions from
// OpenRouter. Designed to be the simplest possible "real" agent:
//   - one file of HTTP/WS plumbing
//   - one provider per file under ./providers/
//   - in-memory conversation store (the hub's SQLite cache survives
//     restarts on its side — see chatdb.rs)
//
// Run:
//   OPENROUTER_API_KEY=sk-or-... node src/server.js [--port 8742]
//
// Env knobs:
//   OPENROUTER_API_KEY   required for OpenRouter
//   CLOUD_BRIDGE_PROVIDER  "openrouter" (default) | "cloudru"
//   CLOUD_BRIDGE_DEFAULT_MODEL  e.g. anthropic/claude-3.5-sonnet
//   CLOUD_BRIDGE_PORT    overrides --port

import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir, platform } from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

import { streamOpenRouter } from "./providers/openrouter.js";
import { resolveCloudRuBearer, streamCloudRu } from "./providers/cloudru.js";

const __hub_dir = dirname(fileURLToPath(import.meta.url));
const CREDENTIALS_FILE = join(__hub_dir, "hub-credentials.json");

// ─── Configuration ──────────────────────────────────────────────────────────

const AGENT_ID = "cloud-bridge";
const HOST = "127.0.0.1";
const PORT = portFromArgs() ?? Number(process.env.CLOUD_BRIDGE_PORT) ?? 8742;
const VERSION = "0.1.0";
/** Patched per bundle in packaged agents: openrouter-only | cloudru-only | both. */
const HUB_PROVIDER_ENUM = ["openrouter", "cloudru"];
const SECRET_MASK = "********";
const DEFAULT_CLOUDRU_BASE = "https://foundation-models.api.cloud.ru/v1";

let secrets = {
  openrouter_api_key: "",
  cloudru_api_key: "",
  cloudru_key_id: "",
};

function loadSecretsFromDisk() {
  try {
    const raw = readFileSync(CREDENTIALS_FILE, "utf8");
    const j = JSON.parse(raw);
    if (typeof j.openrouter_api_key === "string") {
      secrets.openrouter_api_key = j.openrouter_api_key;
    }
    if (typeof j.cloudru_api_key === "string") {
      secrets.cloudru_api_key = j.cloudru_api_key;
    }
    if (typeof j.cloudru_key_id === "string") {
      secrets.cloudru_key_id = j.cloudru_key_id;
    }
  } catch {
    /* first run — no file yet */
  }
}

function saveSecretsToDisk() {
  writeFileSync(
    CREDENTIALS_FILE,
    JSON.stringify(
      {
        openrouter_api_key: secrets.openrouter_api_key,
        cloudru_api_key: secrets.cloudru_api_key,
        cloudru_key_id: secrets.cloudru_key_id,
      },
      null,
      2,
    ),
    "utf8",
  );
}

const DEFAULT_MODELS = [
  "anthropic/claude-sonnet-4.5",
  "anthropic/claude-3.5-sonnet",
  "openai/gpt-4o-mini",
  "openai/gpt-4o",
  "google/gemini-2.5-pro",
  "deepseek/deepseek-chat",
  "meta-llama/llama-3.3-70b-instruct",
];

loadSecretsFromDisk();

const config = {
  provider: process.env.CLOUD_BRIDGE_PROVIDER ?? "openrouter",
  default_model:
    process.env.CLOUD_BRIDGE_DEFAULT_MODEL ?? DEFAULT_MODELS[0],
  max_tokens: 0,
  temperature: 0.7,
  cloudru_base_url: DEFAULT_CLOUDRU_BASE,
};

const env = {
  openrouter_key: "",
  cloudru_key: "",
};

function syncEnvKeys() {
  env.openrouter_key =
    process.env.OPENROUTER_API_KEY || secrets.openrouter_api_key || "";
  env.cloudru_key = process.env.CLOUDRU_BEARER || secrets.cloudru_api_key || "";
}

syncEnvKeys();

// ─── In-memory state ────────────────────────────────────────────────────────

const startedAt = Date.now();
let busy = false;
const conversations = new Map();
const wsClients = new Set();

// ─── HTTP routing ───────────────────────────────────────────────────────────

const server = createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PATCH, DELETE, OPTIONS",
  );
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const route = `${req.method} ${url.pathname}`;

  if (route === "GET /status") return sendJson(res, status());
  if (route === "GET /config") return sendJson(res, getConfig());
  if (route === "PUT /config") {
    return readJson(req, (body) => sendJson(res, putConfig(body)));
  }
  if (route === "POST /test/openrouter") {
    readJsonAsync(req)
      .then((body) => handleTestOpenRouter(body))
      .then((out) => sendJson(res, out))
      .catch((e) =>
        sendJson(res, { ok: false, error: String(e?.message ?? e) }, 500),
      );
    return;
  }
  if (route === "POST /test/cloudru") {
    readJsonAsync(req)
      .then((body) => handleTestCloudRu(body))
      .then((out) => sendJson(res, out))
      .catch((e) =>
        sendJson(res, { ok: false, error: String(e?.message ?? e) }, 500),
      );
    return;
  }
  if (route === "GET /conversations") {
    return sendJson(res, listConversations());
  }
  if (route === "POST /conversations") {
    return readJson(req, (body) =>
      sendJson(res, createConversation(body), 201),
    );
  }
  if (route === "POST /open-native-ui") {
    return sendJson(res, { ok: false, message: "no native UI" }, 404);
  }
  if (route === "POST /quit") {
    sendJson(res, { ok: true });
    setTimeout(() => process.exit(0), 50);
    return;
  }

  const conv = url.pathname.match(/^\/conversations\/([^/]+)(\/messages)?$/);
  if (conv) {
    const [, id, sub] = conv;
    const c = conversations.get(id);
    if (!c) return sendJson(res, error("not_found", "conversation not found"), 404);
    if (req.method === "GET" && !sub) return sendJson(res, c);
    if (req.method === "DELETE" && !sub) {
      conversations.delete(id);
      return sendJson(res, { ok: true });
    }
    if (req.method === "PATCH" && !sub) {
      return readJson(req, (body) =>
        sendJson(res, patchConversation(c, body)),
      );
    }
    if (req.method === "POST" && sub === "/messages") {
      return streamMessage(req, res, c);
    }
  }

  sendJson(res, error("not_found", `${route} unhandled`), 404);
});

// ─── WebSocket events ───────────────────────────────────────────────────────

const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  if (new URL(req.url, `http://${req.headers.host}`).pathname !== "/events") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wsClients.add(ws);
    ws.send(JSON.stringify({ type: "hello", data: { agent: AGENT_ID } }));
    ws.on("close", () => wsClients.delete(ws));
  });
});

setInterval(() => broadcast({ type: "heartbeat", data: {} }), 30_000);

function broadcast(event) {
  const frame = JSON.stringify(event);
  for (const ws of wsClients) {
    try {
      ws.send(frame);
    } catch {
      /* socket closing */
    }
  }
}

function setBusy(next, reason) {
  if (busy === next) return;
  busy = next;
  broadcast({ type: "agent_busy", data: { busy, reason } });
}

// ─── Endpoint handlers ──────────────────────────────────────────────────────

function status() {
  return {
    alive: true,
    busy,
    version: VERSION,
    uptime_sec: Math.round((Date.now() - startedAt) / 1000),
    metrics: {
      conversations: conversations.size,
      provider: config.provider,
      keyed: hasKey(config.provider),
    },
  };
}

function publicConfigView() {
  return {
    ...config,
    openrouter_api_key: secrets.openrouter_api_key ? SECRET_MASK : "",
    cloudru_api_key: secrets.cloudru_api_key ? SECRET_MASK : "",
    cloudru_key_id: secrets.cloudru_key_id || "",
  };
}

function getConfig() {
  return {
    config: publicConfigView(),
    schema: {
      type: "object",
      properties: {
        provider: {
          type: "string",
          enum: HUB_PROVIDER_ENUM,
          description: "Upstream LLM provider",
        },
        default_model: {
          type: "string",
          description: "Model id used when a request omits `model`",
        },
        max_tokens: {
          type: "integer",
          minimum: 0,
          maximum: 32000,
          description: "Server-side cap on response tokens (0 = unlimited)",
        },
        temperature: {
          type: "number",
          minimum: 0,
          maximum: 2,
        },
        cloudru_base_url: {
          type: "string",
          title: "Cloud.ru API base URL",
          description: "Foundation Models OpenAI-compatible root (no trailing slash)",
        },
        openrouter_api_key: {
          type: "string",
          format: "password",
          title: "OpenRouter API key",
          description:
            "sk-or-… key (stored locally in hub-credentials.json). Leave mask unchanged to keep current key.",
        },
        cloudru_key_id: {
          type: "string",
          title: "Cloud.ru Key ID",
          description: "Optional. If empty, Key secret is used as Bearer token.",
        },
        cloudru_api_key: {
          type: "string",
          format: "password",
          title: "Cloud.ru Key secret",
          description:
            "API secret from Cloud.ru console (or Bearer). Leave mask unchanged to keep.",
        },
      },
    },
  };
}

function putConfig(body) {
  if (
    typeof body?.provider === "string" &&
    HUB_PROVIDER_ENUM.includes(body.provider)
  ) {
    config.provider = body.provider;
  }
  if (typeof body?.default_model === "string" && body.default_model.length > 0) {
    config.default_model = body.default_model;
  }
  if (typeof body?.max_tokens === "number") {
    config.max_tokens = clamp(body.max_tokens, 0, 32000);
  }
  if (typeof body?.temperature === "number") {
    config.temperature = clamp(body.temperature, 0, 2);
  }
  if (typeof body?.cloudru_base_url === "string" && body.cloudru_base_url.trim()) {
    config.cloudru_base_url = body.cloudru_base_url.trim().replace(/\/$/, "");
  }

  if (typeof body?.openrouter_api_key === "string") {
    if (body.openrouter_api_key === "") {
      secrets.openrouter_api_key = "";
    } else if (body.openrouter_api_key !== SECRET_MASK) {
      secrets.openrouter_api_key = body.openrouter_api_key;
    }
  }
  if (typeof body?.cloudru_api_key === "string") {
    if (body.cloudru_api_key === "") {
      secrets.cloudru_api_key = "";
    } else if (body.cloudru_api_key !== SECRET_MASK) {
      secrets.cloudru_api_key = body.cloudru_api_key;
    }
  }
  if (typeof body?.cloudru_key_id === "string") {
    secrets.cloudru_key_id = body.cloudru_key_id.trim();
  }

  syncEnvKeys();
  saveSecretsToDisk();
  const snapshot = getConfig();
  return { ok: true, config: snapshot.config, schema: snapshot.schema };
}

async function handleTestOpenRouter(body) {
  const override =
    typeof body?.api_key === "string" && body.api_key.trim()
      ? body.api_key.trim()
      : null;
  const key = override || env.openrouter_key;
  if (!key) {
    return { ok: false, error: "OpenRouter API key missing — save key first or pass api_key in body." };
  }
  const r = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Authorization: `Bearer ${key}` },
  });
  const text = await r.text();
  if (!r.ok) {
    return { ok: false, error: `HTTP ${r.status}: ${text.slice(0, 400)}` };
  }
  const data = JSON.parse(text);
  const models = (data.data ?? [])
    .map((m) => m.id)
    .filter(Boolean)
    .slice(0, 120);
  return { ok: true, models };
}

async function handleTestCloudRu(body) {
  const overrideKey =
    typeof body?.cloudru_api_key === "string" && body.cloudru_api_key.trim()
      ? body.cloudru_api_key.trim()
      : null;

  const secret = overrideKey || secrets.cloudru_api_key || env.cloudru_key;
  const keyId =
    typeof body?.cloudru_key_id === "string"
      ? body.cloudru_key_id.trim()
      : secrets.cloudru_key_id;

  if (!secret) {
    return {
      ok: false,
      error: "Cloud.ru key secret missing — save credentials first or pass in body.",
    };
  }

  const base = (
    (typeof body?.cloudru_base_url === "string" && body.cloudru_base_url.trim()) ||
    config.cloudru_base_url ||
    DEFAULT_CLOUDRU_BASE
  ).replace(/\/$/, "");

  const bearer = await resolveCloudRuBearer(keyId, secret);
  const r = await fetch(`${base}/models`, {
    headers: { Authorization: `Bearer ${bearer}` },
  });
  const text = await r.text();
  if (!r.ok) {
    return { ok: false, error: `HTTP ${r.status}: ${text.slice(0, 400)}` };
  }
  const data = JSON.parse(text);
  const models = (data.data ?? [])
    .map((m) => m.id)
    .filter(Boolean)
    .slice(0, 120);
  return { ok: true, models };
}

function listConversations() {
  return [...conversations.values()].map((c) => ({
    id: c.id,
    title: c.title,
    system_prompt: c.system_prompt,
    updated_at: c.updated_at,
    message_count: c.messages.length,
  }));
}

function createConversation(body) {
  const id = randomUUID();
  const c = {
    id,
    title: body?.title ?? "New conversation",
    system_prompt: body?.system_prompt ?? "",
    messages: [],
    updated_at: new Date().toISOString(),
  };
  conversations.set(id, c);
  return c;
}

function patchConversation(c, body) {
  if (typeof body?.title === "string") c.title = body.title;
  if (typeof body?.system_prompt === "string") c.system_prompt = body.system_prompt;
  c.updated_at = new Date().toISOString();
  return c;
}

/**
 * POST /conversations/:id/messages — text/event-stream response.
 *
 * Builds an OpenAI-style messages array from the conversation's history
 * + system prompt + the new user turn, hands it to the configured
 * provider, and forwards every delta as an SSE frame in the protocol
 * shape the hub expects.
 */
async function streamMessage(req, res, c) {
  const body = await readJsonAsync(req);
  const userText = extractText(body?.content);
  const userId = randomUUID();
  c.messages.push({
    id: userId,
    role: "user",
    content: body?.content ?? [{ type: "text", text: userText }],
    at: new Date().toISOString(),
  });
  c.updated_at = new Date().toISOString();

  const messageId = randomUUID();
  const model = body?.model || config.default_model;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  if (!hasKey(config.provider)) {
    send("error", {
      message: `${config.provider} API credentials missing — save keys in agent config (stored locally in hub-credentials.json), or set ${keyEnvName(config.provider)}.`,
    });
    res.end();
    return;
  }

  setBusy(true, "streaming");
  send("start", { message_id: messageId, model });

  const messages = buildMessages(c, userText);
  const upstream = streamFor(config.provider);

  let assistantText = "";
  let finishReason = "stop";
  try {
    const streamOpts = {
      apiKey: keyFor(config.provider),
      model,
      messages,
    };
    if (config.provider === "cloudru") {
      streamOpts.cloudruKeyId = secrets.cloudru_key_id;
      streamOpts.baseUrl = config.cloudru_base_url;
    }
    for await (const event of upstream(streamOpts)) {
      if (res.writableEnded) break;
      if (event.type === "delta") {
        assistantText += event.data?.text ?? "";
        send("delta", event.data);
      } else if (event.type === "end") {
        finishReason = event.data?.finish_reason ?? finishReason;
      }
    }
  } catch (e) {
    send("error", { message: String(e?.message ?? e) });
    res.end();
    setBusy(false);
    return;
  }

  send("end", {
    finish_reason: finishReason,
    usage: { in: userText.length, out: assistantText.length },
  });
  res.end();
  setBusy(false);

  c.messages.push({
    id: messageId,
    role: "assistant",
    content: [{ type: "text", text: assistantText }],
    at: new Date().toISOString(),
  });
  c.updated_at = new Date().toISOString();

  function send(type, data) {
    res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
  }
}

// ─── Provider plumbing ──────────────────────────────────────────────────────

function streamFor(provider) {
  if (provider === "cloudru") {
    return async function* cloudWrapped(opts) {
      yield* streamCloudRu(opts);
    };
  }
  return streamOpenRouter;
}

function keyFor(provider) {
  return provider === "cloudru" ? env.cloudru_key : env.openrouter_key;
}

function keyEnvName(provider) {
  return provider === "cloudru" ? "CLOUDRU_BEARER" : "OPENROUTER_API_KEY";
}

function hasKey(provider) {
  return Boolean(keyFor(provider));
}

/**
 * Project the conversation into a raw OpenAI-style messages array,
 * dropping any non-text parts (the real adapter handles tool / image
 * attachments — keeping the reference small).
 */
function buildMessages(c, latestUserText) {
  const arr = [];
  if (c.system_prompt && c.system_prompt.trim()) {
    arr.push({ role: "system", content: c.system_prompt });
  }
  for (const m of c.messages) {
    // The new user turn was already pushed onto `c.messages`; skip it
    // here so we don't double-send.
    if (m.id === c.messages[c.messages.length - 1].id && m.role === "user") {
      continue;
    }
    const text = extractText(m.content);
    if (!text) continue;
    arr.push({ role: m.role, content: text });
  }
  arr.push({ role: "user", content: latestUserText });
  return arr;
}

function extractText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((p) => p?.type === "text")
    .map((p) => p.text ?? "")
    .join("\n")
    .trim();
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sendJson(res, body, code = 200) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function error(code, message) {
  return { error: { code, message } };
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function readJson(req, cb) {
  readJsonAsync(req)
    .then(cb)
    .catch(() => cb({}));
}

function readJsonAsync(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function portFromArgs() {
  const i = process.argv.indexOf("--port");
  if (i === -1) return null;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) ? n : null;
}

// ─── Manifest publishing ────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function manifestDir() {
  if (platform() === "win32") {
    return join(process.env.APPDATA || homedir(), "agent-hub", "agents");
  }
  return join(
    process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
    "agent-hub",
    "agents",
  );
}

function writeManifest() {
  const dir = manifestDir();
  mkdirSync(dir, { recursive: true });
  const manifest = {
    id: AGENT_ID,
    name: "Cloud Bridge",
    version: VERSION,
    kind: "ai",
    endpoint: `http://${HOST}:${PORT}`,
    lifecycle: "managed",
    executable: process.execPath,
    args: [__filename, "--port", String(PORT)],
    tagline: "Streams Claude / GPT / Gemini through OpenRouter",
    tags: ["ai", "reference", "openrouter"],
    accent: "#5b8def",
    protocol: "0.1",
    auto_start_on_hub_launch: true,
    ai: {
      supports_streaming: true,
      supports_tools: false,
      supports_attachments: false,
      models: DEFAULT_MODELS,
      default_model: config.default_model,
      system_prompt_editable: true,
    },
  };
  writeFileSync(
    join(dir, `${AGENT_ID}.json`),
    JSON.stringify(manifest, null, 2),
  );
}

// ─── Boot ───────────────────────────────────────────────────────────────────

writeManifest();
server.listen(PORT, HOST, () => {
  const keyed = hasKey(config.provider) ? "ok" : `missing ${keyEnvName(config.provider)}`;
  console.log(
    `cloud-bridge ready on http://${HOST}:${PORT} (provider=${config.provider}, key=${keyed})`,
  );
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
