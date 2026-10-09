"use client";
import { useEffect, useState, CSSProperties } from "react";

/** Used if no endpoint returns a model list (offline, gateway, etc.). */
const FALLBACK = ["claude-sonnet-5", "claude-opus-4.8", "claude-haiku-4.5"];

interface ModelGroup {
  name: string;
  active: boolean;
  models: string[];
}

let modelsCache: { flat: string[]; groups: ModelGroup[] } | null = null;

interface ModelSelectProps {
  value: string;
  onChange: (model: string) => void;
  /** Show a "Default model" option meaning empty/inherit. Default true. */
  allowDefault?: boolean;
  /** Label for the default option. */
  defaultLabel?: string;
  /** @deprecated All saved AI connections are now listed automatically. */
  includeHidden?: boolean;
  title?: string;
  style?: CSSProperties;
}

/**
 * Model picker fed by /api/models — aggregates ALL saved AI connections,
 * grouped per provider. Any listed model works: the backend routes the call
 * to the connection that serves it.
 */
export default function ModelSelect({
  value,
  onChange,
  allowDefault = true,
  defaultLabel = "Default model",
  includeHidden: _includeHidden,
  title,
  style,
}: ModelSelectProps) {
  const [refresh, setRefresh] = useState(0);
  const [flat, setFlat] = useState<string[]>(modelsCache?.flat ?? FALLBACK);
  const [allGroups, setAllGroups] = useState<ModelGroup[]>(modelsCache?.groups ?? []);

  useEffect(() => {
    const clear = () => { modelsCache = null; setRefresh(v => v + 1); };
    window.addEventListener("settings-changed", clear);
    return () => window.removeEventListener("settings-changed", clear);
  }, []);

  useEffect(() => {
    let alive = true;
    fetch("/api/models")
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        const f: string[] = d?.models?.length ? d.models : FALLBACK;
        const g: ModelGroup[] = Array.isArray(d?.groups) ? d.groups : [];
        modelsCache = { flat: f, groups: g };
        setFlat(f);
        setAllGroups(g);
      })
      .catch(() => setFlat(FALLBACK));
    return () => { alive = false; };
  }, [refresh]);

  const groups = allGroups;
  const grouped = groups.length > 0;
  const known = grouped ? groups.flatMap((g) => g.models) : flat;
  const customValue = value && !known.includes(value) ? value : null;

  return (
    <select
      className="input"
      title={title ?? "AI model"}
      style={{ width: 200, ...style }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {allowDefault && <option value="">{defaultLabel}</option>}
      {customValue && <option value={customValue}>{customValue}</option>}
      {grouped
        ? groups.map((g) => (
            <optgroup key={g.name} label={`${g.name}${g.active ? " (active)" : ""}`}>
              {g.models.map((m) => (
                <option key={`${g.name}:${m}`} value={m}>{m}</option>
              ))}
            </optgroup>
          ))
        : flat.map((m) => <option key={m} value={m}>{m}</option>)}
    </select>
  );
}
