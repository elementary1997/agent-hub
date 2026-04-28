// Cloud.ru Foundation Models — placeholder provider.
//
// Cloud.ru exposes Whisper-large-v3 for speech (already used by easySTT),
// and a separate chat / completion API for LLMs (GigaChat-family). The
// chat surface is OpenAI-compatible at the JSON schema level but the
// auth flow uses an OAuth2 token exchange that depends on the user's
// service-account credentials — out of scope for a reference adapter
// that should be one `npm start` away from running.
//
// We keep the file as a contract so anyone who needs Cloud.ru can plug
// it in without touching `server.js`. Set CLOUDRU_BEARER + CLOUDRU_BASE
// to enable.

export async function* streamCloudRu({ apiKey: _apiKey, model: _model, messages: _messages }) {
  throw new Error(
    "Cloud.ru chat provider is not implemented yet. Plug your fetch loop " +
    "into examples/cloud-bridge/src/providers/cloudru.js — it just needs " +
    "to yield { type: 'delta', data: { text } } and a final { type: 'end' }.",
  );
  // eslint-disable-next-line no-unreachable
  yield;
}
