// Echo Agent — reference implementation of the Agent Hub protocol v0.1.
//
// Streams the user's text back word-by-word over SSE, persists conversations
// in memory, and writes its manifest to the standard discovery path so the
// hub picks it up without configuration.
//
// Run:
//   node server.js [--port 8741]
//
// Why this exists: lets you develop the hub UI without an LLM provider /
// API keys / network. Also doubles as a copy-paste starting point for real
// agents — the whole protocol fits in ~250 LoC.

import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";

// ─── Configuration ──────────────────────────────────────────────────────────

const AGENT_ID = "echo";
const HOST = "127.0.0.1";
const PORT = portFromArgs() ?? 8741;
const VERSION = "0.1.0";

// ─── In-memory state ────────────────────────────────────────────────────────

const startedAt = Date.now();
let busy = false;
const conversations = new Map(); // id -> { id, title, system_prompt, messages, updated_at }
const wsClients = new Set();

const config = {
  reply_speed_ms: 40, // delay between tokens
  prefix: "echo: ",   // prepended to every echo response
};

// ─── HTTP routing ───────────────────────────────────────────────────────────

const server = createServer((req, res) => {
  // Permissive CORS — hub talks to localhost only, no real cross-origin risk.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const route = `${req.method} ${url.pathname}`;

  if (route === "GET /status")             return sendJson(res, status());
  if (route === "GET /config")             return sendJson(res, getConfig());
  if (route === "PUT /config")             return readJson(req, (body) => sendJson(res, putConfig(body)));
  if (route === "GET /conversations")      return sendJson(res, listConversations());
  if (route === "POST /conversations")     return readJson(req, (body) => sendJson(res, createConversation(body), 201));
  if (route === "POST /open-native-ui")    return sendJson(res, { ok: false, message: "no native UI" }, 404);
  if (route === "POST /quit") {
    sendJson(res, { ok: true });
    setTimeout(() => process.exit(0), 50);
    return;
  }

  // Conversation-scoped
  const conv = url.pathname.match(/^\/conversations\/([^/]+)(\/messages)?$/);
  if (conv) {
    const [, id, sub] = conv;
    const c = conversations.get(id);
    if (!c) return sendJson(res, error("not_found", "conversation not found"), 404);
    if (req.method === "GET" && !sub)        return sendJson(res, c);
    if (req.method === "DELETE" && !sub)     { conversations.delete(id); return sendJson(res, { ok: true }); }
    if (req.method === "PATCH" && !sub)      return readJson(req, (body) => sendJson(res, patchConversation(c, body)));
    if (req.method === "POST" && sub === "/messages") return streamMessage(req, res, c);
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
    try { ws.send(frame); } catch { /* socket closing */ }
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
    metrics: { conversations: conversations.size },
  };
}

function getConfig() {
  return {
    config,
    schema: {
      type: "object",
      properties: {
        reply_speed_ms: {
          type: "integer", minimum: 0, maximum: 1000,
          description: "Delay between streamed tokens (ms)",
        },
        prefix: { type: "string", maxLength: 32 },
      },
    },
  };
}

function putConfig(body) {
  if (typeof body?.reply_speed_ms === "number") config.reply_speed_ms = clamp(body.reply_speed_ms, 0, 1000);
  if (typeof body?.prefix === "string") config.prefix = body.prefix.slice(0, 32);
  return { ok: true, config };
}

function listConversations() {
  return [...conversations.values()].map((c) => ({
    id: c.id, title: c.title, updated_at: c.updated_at, message_count: c.messages.length,
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
 * POST /conversations/{id}/messages — text/event-stream response.
 * Tokenises the user's text and streams it back with a configurable delay.
 */
async function streamMessage(req, res, c) {
  const body = await readJsonAsync(req);
  const userText = extractText(body?.content);
  c.messages.push({ id: randomUUID(), role: "user", content: body?.content ?? [], at: new Date().toISOString() });

  const messageId = randomUUID();
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });

  setBusy(true, "streaming");
  send("start", { message_id: messageId, model: "echo-1" });

  const reply = `${config.prefix}${userText}`;
  const tokens = reply.split(/(\s+)/);
  for (const tok of tokens) {
    if (res.writableEnded) break;
    send("delta", { text: tok });
    if (config.reply_speed_ms > 0) await sleep(config.reply_speed_ms);
  }

  send("end", { finish_reason: "stop", usage: { in: userText.length, out: reply.length } });
  res.end();
  setBusy(false);

  c.messages.push({ id: messageId, role: "assistant", content: [{ type: "text", text: reply }], at: new Date().toISOString() });
  c.updated_at = new Date().toISOString();

  function send(type, data) {
    res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
  }
}

function extractText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((p) => p?.type === "text").map((p) => p.text ?? "").join("\n").trim();
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sendJson(res, body, code = 200) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function error(code, message) { return { error: { code, message } }; }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function readJson(req, cb) {
  readJsonAsync(req).then(cb).catch(() => cb({}));
}

function readJsonAsync(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
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

function manifestDir() {
  if (platform() === "win32") {
    return join(process.env.APPDATA || homedir(), "agent-hub", "agents");
  }
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "agent-hub", "agents");
}

function writeManifest() {
  const dir = manifestDir();
  mkdirSync(dir, { recursive: true });
  const manifest = {
    id: AGENT_ID,
    name: "Echo Agent",
    version: VERSION,
    kind: "ai",
    endpoint: `http://${HOST}:${PORT}`,
    lifecycle: "managed",
    executable: "node",
    args: [new URL(import.meta.url).pathname, "--port", String(PORT)],
    tagline: "Streams text back token by token (reference impl)",
    tags: ["reference", "ai"],
    accent: "#3ddc97",
    protocol: "0.1",
    ai: {
      supports_streaming: true,
      supports_tools: false,
      models: ["echo-1"],
      default_model: "echo-1",
      system_prompt_editable: true,
    },
  };
  writeFileSync(join(dir, `${AGENT_ID}.json`), JSON.stringify(manifest, null, 2));
}

// ─── Boot ───────────────────────────────────────────────────────────────────

writeManifest();
server.listen(PORT, HOST, () => {
  console.log(`echo-agent ready on http://${HOST}:${PORT} — manifest at ${manifestDir()}/${AGENT_ID}.json`);
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
