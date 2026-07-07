"use client";
import { useEffect, useState, CSSProperties } from "react";

/** Used if the endpoint's /v1/models is unavailable (offline, gateway, etc.). */
const FALLBACK = ["claude-sonnet-5", "claude-opus-4.8", "claude-haiku-4.5"];

let modelsCache: string[] | null = null;

interface ModelSelectProps {
  value: string;
  onChange: (model: string) => void;
  /** Show a "Default model" option meaning empty/inherit. Default true. */
  allowDefault?: boolean;
  /** Label for the default option. */
  defaultLabel?: string;
  title?: string;
  style?: CSSProperties;
}

/** Model picker that fetches available models from the configured AI endpoint. */
export default function ModelSelect({
  value,
  onChange,
  allowDefault = true,
  defaultLabel = "Default model",
  title,
  style,
}: ModelSelectProps) {
  const [models, setModels] = useState<string[]>(modelsCache ?? FALLBACK);

  useEffect(() => {
    let alive = true;
    fetch("/api/models")
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        const m: string[] = d?.models?.length ? d.models : FALLBACK;
        modelsCache = m;
        setModels(m);
      })
      .catch(() => setModels(FALLBACK));
    return () => { alive = false; };
  }, []);

  const options = [...models];
  if (value && !options.includes(value)) options.unshift(value); // keep a custom saved value visible

  return (
    <select
      className="input"
      title={title ?? "AI model"}
      style={{ width: 200, ...style }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {allowDefault && <option value="">{defaultLabel}</option>}
      {options.map((m) => (
        <option key={m} value={m}>{m}</option>
      ))}
    </select>
  );
}
