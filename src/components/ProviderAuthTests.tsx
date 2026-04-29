import { useState } from "react";
import { FlaskConical } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ProviderTestResult } from "@/lib/api";

async function postTest(url: string): Promise<ProviderTestResult> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 15_000);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: ctrl.signal,
    });
    return r.json() as Promise<ProviderTestResult>;
  } finally {
    window.clearTimeout(timer);
  }
}

export function ProviderAuthTests({
  agentId,
  endpoint,
  config,
}: {
  agentId: string;
  endpoint: string;
  config: Record<string, unknown>;
}) {
  const base = endpoint.replace(/\/$/, "");
  const showOpenRouter = agentId === "openrouter-agent";
  const showCloudRu = agentId === "cloudru-agent";
  const hasOpenRouterKey = hasSecret(config.openrouter_api_key);
  const hasCloudRuKey = hasSecret(config.cloudru_api_key);

  const [orLoading, setOrLoading] = useState(false);
  const [crLoading, setCrLoading] = useState(false);
  const [orOut, setOrOut] = useState<ProviderTestResult | null>(null);
  const [crOut, setCrOut] = useState<ProviderTestResult | null>(null);

  if (!showOpenRouter && !showCloudRu) return null;

  return (
    <div className="rounded-xl border border-border-subtle bg-bg-card/40 p-4 space-y-3">
      <div className="text-xs uppercase tracking-wider text-muted flex items-center gap-2">
        <FlaskConical size={14} />
        Provider checks
      </div>
      <p className="text-[11px] text-muted">
        Uses credentials saved in config (or env). On success, lists model ids from the vendor
        API.
      </p>

      {showOpenRouter && (
        <div className="space-y-2">
          <button
            type="button"
            disabled={orLoading || !hasOpenRouterKey}
            onClick={() => {
              setOrLoading(true);
              setOrOut(null);
              postTest(`${base}/test/openrouter`)
                .then(setOrOut)
                .catch((e) => setOrOut({ ok: false, error: String(e) }))
                .finally(() => setOrLoading(false));
            }}
            className={cn(
              "inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border transition-colors",
              "border-border-subtle hover:border-border-default text-muted hover:text-slate-100",
              (orLoading || !hasOpenRouterKey) && "opacity-60 cursor-not-allowed",
            )}
          >
            {orLoading ? "Testing…" : "Test OpenRouter authorization"}
          </button>
          {!hasOpenRouterKey && (
            <div className="text-[11px] text-amber-400">
              Enter and save `OPENROUTER_API_KEY` first.
            </div>
          )}
          <TestResultView result={orOut} />
        </div>
      )}

      {showCloudRu && (
        <div className="space-y-2">
          <button
            type="button"
            disabled={crLoading || !hasCloudRuKey}
            onClick={() => {
              setCrLoading(true);
              setCrOut(null);
              postTest(`${base}/test/cloudru`)
                .then(setCrOut)
                .catch((e) => setCrOut({ ok: false, error: String(e) }))
                .finally(() => setCrLoading(false));
            }}
            className={cn(
              "inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border transition-colors",
              "border-border-subtle hover:border-border-default text-muted hover:text-slate-100",
              (crLoading || !hasCloudRuKey) && "opacity-60 cursor-not-allowed",
            )}
          >
            {crLoading ? "Testing…" : "Test Cloud.ru authorization"}
          </button>
          {!hasCloudRuKey && (
            <div className="text-[11px] text-amber-400">
              Enter and save `CLOUDRU_BEARER` first.
            </div>
          )}
          <TestResultView result={crOut} />
        </div>
      )}
    </div>
  );
}

function TestResultView({ result }: { result: ProviderTestResult | null }) {
  if (!result) return null;
  if (!result.ok) {
    return (
      <div className="text-xs text-red-300 rounded-lg border border-red-500/30 bg-red-500/5 p-2">
        {result.error ?? "Unknown error"}
      </div>
    );
  }
  const models = result.models ?? [];
  if (models.length === 0) {
    return <div className="text-xs text-muted">OK, but no models in response.</div>;
  }
  return (
    <ul className="max-h-40 overflow-auto rounded-lg border border-border-subtle bg-bg-elev/50 p-2 text-[11px] font-mono space-y-0.5">
      {models.map((m) => (
        <li key={m} className="text-slate-200">
          {m}
        </li>
      ))}
    </ul>
  );
}

function hasSecret(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
