import { useEffect, useMemo, useState } from "react";
import type { AgentConfigProperty, AgentConfigSchema } from "@/lib/api";
import { cn } from "@/lib/cn";

interface SchemaFormProps {
  schema?: AgentConfigSchema;
  initial: Record<string, unknown>;
  onSubmit: (values: Record<string, unknown>) => void | Promise<void>;
  busy?: boolean;
  saveLabel?: string;
}

/**
 * Tiny JSON-Schema → form renderer. Covers the primitive shapes used by
 * Protocol v0.1 agents (string / number / boolean + `enum`). Anything more
 * exotic falls through to a raw JSON textarea so the user can still edit it.
 */
export function SchemaForm({ schema, initial, onSubmit, busy, saveLabel }: SchemaFormProps) {
  const properties = schema?.properties ?? {};
  const propertyKeys = useMemo(() => Object.keys(properties), [properties]);

  const [values, setValues] = useState<Record<string, unknown>>(initial);
  const [rawJson, setRawJson] = useState<string>(() =>
    JSON.stringify(initial, null, 2),
  );
  const [rawError, setRawError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!touched) {
      setValues(initial);
      setRawJson(JSON.stringify(initial, null, 2));
    }
  }, [initial, touched]);

  const useRaw = propertyKeys.length === 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (useRaw) {
      try {
        const parsed = JSON.parse(rawJson) as Record<string, unknown>;
        setRawError(null);
        await onSubmit(parsed);
      } catch (err) {
        setRawError(err instanceof Error ? err.message : String(err));
      }
      return;
    }
    await onSubmit(values);
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      {useRaw ? (
        <div className="space-y-2">
          <label className="text-xs uppercase tracking-wider text-muted">
            Config (raw JSON)
          </label>
          <textarea
            value={rawJson}
            onChange={(e) => {
              setRawJson(e.target.value);
              setTouched(true);
              setRawError(null);
            }}
            rows={12}
            className="w-full bg-bg-elev border border-border-subtle rounded-lg p-3 text-[12.5px] font-mono outline-none focus:border-border-default"
          />
          {rawError && <div className="text-xs text-danger">{rawError}</div>}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {propertyKeys.map((key) => (
            <Field
              key={key}
              name={key}
              property={properties[key]}
              value={values[key]}
              onChange={(v) => {
                setTouched(true);
                setValues((prev) => ({ ...prev, [key]: v }));
              }}
            />
          ))}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={busy}
          className={cn(
            "inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors",
            "border-border-default text-slate-100 hover:border-border-strong",
            "disabled:opacity-50",
          )}
        >
          {busy ? "Saving…" : (saveLabel ?? "Save config")}
        </button>
      </div>
    </form>
  );
}

interface FieldProps {
  name: string;
  property: AgentConfigProperty;
  value: unknown;
  onChange: (v: unknown) => void;
}

function Field({ name, property, value, onChange }: FieldProps) {
  const label = property.title ?? humanise(name);

  return (
    <div className="space-y-1.5">
      <label className="text-xs uppercase tracking-wider text-muted">
        {label}
      </label>
      <FieldInput property={property} value={value} onChange={onChange} />
      {property.description && (
        <p className="text-[11px] text-muted">{property.description}</p>
      )}
    </div>
  );
}

function FieldInput({ property, value, onChange }: Omit<FieldProps, "name">) {
  if (property.enum) {
    return (
      <select
        value={(value ?? "") as string}
        onChange={(e) => onChange(coerce(property.type, e.target.value))}
        className="w-full bg-bg-elev border border-border-subtle rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-border-default"
      >
        {property.enum.map((v) => (
          <option key={String(v)} value={String(v)}>
            {String(v)}
          </option>
        ))}
      </select>
    );
  }

  if (property.type === "boolean") {
    return (
      <label className="inline-flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          className="w-4 h-4"
        />
        <span className="text-muted">{value ? "enabled" : "disabled"}</span>
      </label>
    );
  }

  if (property.type === "integer" || property.type === "number") {
    return <NumericInput property={property} value={value} onChange={onChange} />;
  }

  // string / fallback
  const stringValue = typeof value === "string" ? value : value == null ? "" : String(value);
  if (property.format === "password") {
    return (
      <input
        type="password"
        autoComplete="off"
        value={stringValue}
        maxLength={property.maxLength}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-bg-elev border border-border-subtle rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-border-default"
      />
    );
  }
  if (property.maxLength && property.maxLength > 80) {
    return (
      <textarea
        value={stringValue}
        maxLength={property.maxLength}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className="w-full bg-bg-elev border border-border-subtle rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-border-default"
      />
    );
  }
  return (
    <input
      type="text"
      value={stringValue}
      maxLength={property.maxLength}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-bg-elev border border-border-subtle rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-border-default"
    />
  );
}

function NumericInput({
  property,
  value,
  onChange,
}: {
  property: AgentConfigProperty;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const [raw, setRaw] = useState(value == null ? "" : String(value));

  useEffect(() => {
    setRaw(value == null ? "" : String(value));
  }, [value]);

  const isInteger = property.type === "integer";

  return (
    <input
      type="text"
      inputMode="decimal"
      value={raw}
      onChange={(e) => {
        const nextRaw = e.target.value.replace(",", ".");
        setRaw(nextRaw);
        if (nextRaw.trim() === "") {
          onChange(null);
          return;
        }
        if (/^-?\d*\.?\d*$/.test(nextRaw)) {
          const parsed = isInteger ? parseInt(nextRaw, 10) : Number(nextRaw);
          if (Number.isFinite(parsed)) onChange(parsed);
        }
      }}
      className="w-full bg-bg-elev border border-border-subtle rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-border-default"
    />
  );
}

function coerce(type: string | undefined, raw: string): unknown {
  if (type === "integer" || type === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }
  if (type === "boolean") return raw === "true";
  return raw;
}

function humanise(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
