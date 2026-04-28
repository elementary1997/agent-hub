// Cloud.ru Foundation Models — OpenAI-compatible chat streaming.

const DEFAULT_BASE = "https://foundation-models.api.cloud.ru/v1";
const IAM_TOKEN_URL = "https://iam.api.cloud.ru/api/v1/auth/token";

/**
 * Key ID + Secret → IAM access_token; Secret-only → use as Bearer directly.
 */
export async function resolveCloudRuBearer(keyId, secret) {
  const s = secret?.trim() ?? "";
  if (!s) throw new Error("Cloud.ru API secret missing");
  const kid = keyId?.trim() ?? "";
  if (!kid) return s;

  const resp = await fetch(IAM_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keyId: kid, secret: s }),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`IAM ${resp.status}: ${text}`);
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("IAM: invalid JSON");
  }
  const tok =
    data?.access_token ??
    data?.accessToken ??
    data?.result?.access_token ??
    data?.result?.accessToken;
  if (typeof tok !== "string" || !tok) {
    throw new Error("IAM: no access_token in response");
  }
  return tok;
}

function findSeparator(buf) {
  const a = buf.indexOf("\r\n\r\n");
  if (a !== -1) return { index: a, length: 4 };
  const b = buf.indexOf("\n\n");
  if (b !== -1) return { index: b, length: 2 };
  return -1;
}

function parseFrame(frame) {
  const lines = frame.split(/\r?\n/);
  const dataLines = lines
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).replace(/^\s/, ""));
  if (dataLines.length === 0) return null;
  const data = dataLines.join("\n");
  if (data === "[DONE]") return "DONE";
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * @param {object} args
 * @param {string} args.apiKey — Key Secret (or raw bearer if no key id)
 * @param {string} [args.cloudruKeyId]
 * @param {string} args.model
 * @param {Array<{role: string, content: string}>} args.messages
 * @param {AbortSignal} [args.signal]
 * @param {string} [args.baseUrl]
 */
export async function* streamCloudRu({
  apiKey,
  cloudruKeyId,
  model,
  messages,
  signal,
  baseUrl,
}) {
  const bearer = await resolveCloudRuBearer(cloudruKeyId, apiKey);
  const base = (baseUrl || DEFAULT_BASE).replace(/\/$/, "");
  const endpoint = `${base}/chat/completions`;

  const resp = await fetch(endpoint, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      temperature: 0.7,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Cloud.ru ${resp.status}: ${text || resp.statusText}`);
  }
  if (!resp.body) throw new Error("Cloud.ru returned an empty body");

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let endedWithReason = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let sep;
      while ((sep = findSeparator(buf)) !== -1) {
        const frame = buf.slice(0, sep.index);
        buf = buf.slice(sep.index + sep.length);
        const event = parseFrame(frame);
        if (!event) continue;
        if (event === "DONE") return;
        const delta = event.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta.length > 0) {
          yield { type: "delta", data: { text: delta } };
        }
        const finish = event.choices?.[0]?.finish_reason;
        if (finish && !endedWithReason) {
          endedWithReason = finish;
          yield { type: "end", data: { finish_reason: finish } };
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* noop */
    }
  }

  if (!endedWithReason) {
    yield { type: "end", data: { finish_reason: "stop" } };
  }
}
