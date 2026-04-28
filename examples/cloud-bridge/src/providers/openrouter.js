// OpenRouter provider — streams chat completions over SSE.
//
// Why OpenRouter and not the model vendors directly: one API key gives us
// access to every popular frontier model (Claude, GPT, Gemini, Llama,
// Mistral, DeepSeek, …) plus the smaller niche ones, with a single
// OpenAI-compatible schema. That's exactly what an Agent Hub reference
// adapter wants — minimal vendor coupling, maximum coverage.

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Streams an OpenRouter chat completion as protocol-shaped events.
 *
 * Yields:
 *  - `{ type: "delta", data: { text } }` for each non-empty content chunk
 *  - `{ type: "end",   data: { finish_reason } }` exactly once
 *  - throws on transport / API errors (caller turns those into `error`
 *    events on the SSE channel)
 *
 * @param {object} args
 * @param {string} args.apiKey
 * @param {string} args.model
 * @param {Array<{role: string, content: string}>} args.messages
 * @param {AbortSignal} [args.signal]
 */
export async function* streamOpenRouter({ apiKey, model, messages, signal }) {
  const resp = await fetch(ENDPOINT, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      // Optional but encouraged by OpenRouter for analytics.
      "HTTP-Referer": "https://github.com/elementary1997/agent-hub",
      "X-Title": "Agent Hub",
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`OpenRouter ${resp.status}: ${text || resp.statusText}`);
  }
  if (!resp.body) {
    throw new Error("OpenRouter returned an empty body");
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let endedWithReason = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line. Walk every complete
      // frame in the buffer and leave the partial tail for the next read.
      let sep;
      while ((sep = findSeparator(buf)) !== -1) {
        const frame = buf.slice(0, sep.index);
        buf = buf.slice(sep.index + sep.length);
        const event = parseFrame(frame);
        if (!event) continue;
        if (event === "DONE") {
          return;
        }
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
      /* already released */
    }
  }

  if (!endedWithReason) {
    yield { type: "end", data: { finish_reason: "stop" } };
  }
}

function findSeparator(buf) {
  const a = buf.indexOf("\r\n\r\n");
  if (a !== -1) return { index: a, length: 4 };
  const b = buf.indexOf("\n\n");
  if (b !== -1) return { index: b, length: 2 };
  return -1;
}

function parseFrame(frame) {
  // Frames may carry multiple `data:` lines; OpenRouter currently uses
  // one per frame, but we concatenate to be spec-compliant.
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
