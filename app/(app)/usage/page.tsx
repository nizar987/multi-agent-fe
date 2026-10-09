"use client";
import { useEffect, useState } from "react";

interface Totals { calls: number; input: number; output: number; total: number; cacheRead: number; cacheWrite: number }
interface ByModel extends Totals { provider: string; model: string }
interface Recent { at: string; provider: string; model: string; source: string; input_tokens: number; output_tokens: number; cache_read_tokens: number }
interface Daily { day: string; input: number; output: number; total: number }
interface ContextCfg { limitEnabled: boolean; maxTokens: number }
interface Trend { avgDaily: number; avgDays: number; pctVsAvg: number | null; pctVsYesterday: number | null }
interface UsageData {
  allTime: Totals; today: Totals; byModel: ByModel[]; recent: Recent[]; daily: Daily[]; trend: Trend; context: ContextCfg;
}

const fmt = (n: number) => n.toLocaleString("en-US");

/** Share of input tokens served from the provider's prompt cache. */
const cacheRate = (t: { input: number; cacheRead: number }) =>
  t.input > 0 ? `${((t.cacheRead / t.input) * 100).toFixed(1)}%` : "—";

/** +12.3% / −4.5% with a sign; null → em dash. */
const fmtPct = (p: number | null) =>
  p === null ? "—" : `${p >= 0 ? "+" : "−"}${Math.abs(p).toFixed(1)}%`;

/** Colored ▲/▼ percent — red when usage went up, green when it went down. */
function PctBadge({ pct, label }: { pct: number | null; label: string }) {
  if (pct === null) return <span className="muted small">{label}: —</span>;
  const up = pct >= 0;
  return (
    <span className="small" style={{ color: up ? "var(--danger, #e5534b)" : "var(--success, #4caf7d)" }} title={label}>
      {up ? "▲" : "▼"} {fmtPct(pct)} {label}
    </span>
  );
}

function StatTile({ label, value, sub, extra }: { label: string; value: string; sub?: string; extra?: React.ReactNode }) {
  return (
    <div className="card" style={{ flex: "1 1 160px", minWidth: 140 }}>
      <div className="muted small" style={{ textTransform: "uppercase", letterSpacing: 0.4, fontSize: 11 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{value}</div>
      {sub && <div className="muted small" style={{ marginTop: 2 }}>{sub}</div>}
      {extra && <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>{extra}</div>}
    </div>
  );
}

export default function UsagePage() {
  const [data, setData] = useState<UsageData | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [maxTokens, setMaxTokens] = useState(100000);
  const [savingLimit, setSavingLimit] = useState(false);
  const [savedNote, setSavedNote] = useState("");

  const load = () =>
    fetch("/api/usage").then((r) => r.json()).then((d: UsageData) => {
      setData(d);
      setEnabled(d.context.limitEnabled);
      setMaxTokens(d.context.maxTokens);
    });

  useEffect(() => { load(); }, []);

  const saveLimit = async (nextEnabled: boolean, nextMax: number) => {
    setSavingLimit(true);
    setSavedNote("");
    try {
      const res = await fetch("/api/usage/limit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: nextEnabled, maxTokens: nextMax }),
      });
      const j = await res.json();
      if (res.ok) {
        setEnabled(j.context.limitEnabled);
        setMaxTokens(j.context.maxTokens);
        setSavedNote("Saved ✓");
        setTimeout(() => setSavedNote(""), 2000);
      } else {
        setSavedNote(j.error || "Could not save.");
      }
    } finally {
      setSavingLimit(false);
    }
  };

  const toggleLimit = () => saveLimit(!enabled, maxTokens);

  const resetUsage = async () => {
    if (!confirm("Reset all recorded token usage? This cannot be undone.")) return;
    await fetch("/api/usage", { method: "DELETE" });
    load();
  };

  if (!data) return <div className="skeleton" style={{ height: 120 }} />;

  const maxDaily = Math.max(1, ...data.daily.map((d) => d.total));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 900 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Usage</h1>
        <span className="muted small">token consumption across all AI calls</span>
        <span style={{ flex: 1 }} />
        <button className="btn btn-danger-ghost" onClick={resetUsage}>Reset</button>
      </div>

      {/* Stat tiles */}
      <div className="row" style={{ flexWrap: "wrap", gap: 10 }}>
        <StatTile label="Total tokens" value={fmt(data.allTime.total)} sub={`${fmt(data.allTime.calls)} calls`} />
        <StatTile label="Input" value={fmt(data.allTime.input)} />
        <StatTile label="Output" value={fmt(data.allTime.output)} />
        <StatTile
          label="Prompt cache"
          value={cacheRate(data.allTime)}
          sub={`${fmt(data.allTime.cacheRead)} input tokens read from cache`}
          extra={<span className="muted small">today: {cacheRate(data.today)} · written {fmt(data.allTime.cacheWrite)}</span>}
        />
        <StatTile
          label="Daily average"
          value={fmt(data.trend.avgDaily)}
          sub={data.trend.avgDays > 0 ? `over the last ${data.trend.avgDays} day${data.trend.avgDays > 1 ? "s" : ""}` : "no full days yet"}
        />
        <StatTile
          label="Today"
          value={fmt(data.today.total)}
          sub={`${fmt(data.today.calls)} calls`}
          extra={
            <>
              <PctBadge pct={data.trend.pctVsAvg} label="vs daily average" />
              <PctBadge pct={data.trend.pctVsYesterday} label="vs yesterday" />
            </>
          }
        />
      </div>

      {/* Context limit control */}
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div>
            <strong>Context limit</strong>
            <div className="muted small" style={{ marginTop: 2 }}>
              When on, the oldest messages are trimmed so each request stays under the token budget.
            </div>
          </div>
          <button
            className={`btn ${enabled ? "btn-primary" : ""}`}
            onClick={toggleLimit}
            disabled={savingLimit}
            style={{ minWidth: 88 }}
            title={enabled ? "Limit is ON — click to turn off" : "Limit is OFF — click to turn on"}
          >
            {enabled ? "● On" : "○ Off"}
          </button>
        </div>
        <div className="row" style={{ gap: 10, marginTop: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Max context tokens</label>
            <input
              className="input mono"
              type="number"
              min={1000}
              step={1000}
              value={maxTokens}
              disabled={!enabled}
              onChange={(e) => setMaxTokens(Number(e.target.value))}
              style={{ width: 180 }}
            />
          </div>
          <button className="btn" onClick={() => saveLimit(enabled, maxTokens)} disabled={savingLimit || !enabled}>
            Save budget
          </button>
          {savedNote && <span className="small" style={{ color: "var(--success)" }}>{savedNote}</span>}
        </div>
      </div>

      {/* Daily sparkbars */}
      {data.daily.length > 0 && (
        <div className="card">
          <strong>Last {data.daily.length} day{data.daily.length > 1 ? "s" : ""}</strong>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 104, marginTop: 12 }}>
            {[...data.daily].reverse().map((d, i, arr) => {
              const prev = i > 0 ? arr[i - 1].total : 0;
              const pct = prev > 0 ? ((d.total - prev) / prev) * 100 : null;
              return (
                <div
                  key={d.day}
                  style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}
                  title={`${d.day}: ${fmt(d.total)} tokens${pct !== null ? ` (${fmtPct(pct)} vs previous day)` : ""}`}
                >
                  <span style={{ fontSize: 9, color: pct === null ? "transparent" : pct >= 0 ? "var(--danger, #e5534b)" : "var(--success, #4caf7d)" }}>
                    {pct === null ? "·" : `${pct >= 0 ? "▲" : "▼"}${Math.abs(pct) >= 100 ? Math.round(Math.abs(pct)) : Math.abs(pct).toFixed(0)}%`}
                  </span>
                  <div style={{ width: "100%", display: "flex", flexDirection: "column-reverse", height: 64 }}>
                    <div style={{ height: `${(d.total / maxDaily) * 100}%`, background: "var(--accent)", borderRadius: "3px 3px 0 0", minHeight: 2 }} />
                  </div>
                  <span className="muted" style={{ fontSize: 9 }}>{d.day.slice(5)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* By model */}
      <div className="card">
        <strong>By model</strong>
        {data.byModel.length === 0 ? (
          <div className="muted small" style={{ marginTop: 8 }}>No usage recorded yet.</div>
        ) : (
          <div className="table-wrap">
            <table className="usage-table">
              <thead>
                <tr><th>Provider</th><th>Model</th><th style={{ textAlign: "right" }}>Calls</th><th style={{ textAlign: "right" }}>Input</th><th style={{ textAlign: "right" }}>Cached</th><th style={{ textAlign: "right" }}>Output</th><th style={{ textAlign: "right" }}>Total</th></tr>
              </thead>
              <tbody>
                {data.byModel.map((m, i) => (
                  <tr key={i}>
                    <td>{m.provider || "—"}</td>
                    <td className="mono">{m.model || "—"}</td>
                    <td style={{ textAlign: "right" }}>{fmt(m.calls)}</td>
                    <td style={{ textAlign: "right" }}>{fmt(m.input)}</td>
                    <td style={{ textAlign: "right" }} title={`${fmt(m.cacheRead)} tokens`}>{cacheRate(m)}</td>
                    <td style={{ textAlign: "right" }}>{fmt(m.output)}</td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>{fmt(m.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent calls */}
      {data.recent.length > 0 && (
        <div className="card">
          <strong>Recent calls</strong>
          <div className="table-wrap">
            <table className="usage-table">
              <thead>
                <tr><th>Time</th><th>Source</th><th>Model</th><th style={{ textAlign: "right" }}>In</th><th style={{ textAlign: "right" }}>Cached</th><th style={{ textAlign: "right" }}>Out</th></tr>
              </thead>
              <tbody>
                {data.recent.map((r, i) => (
                  <tr key={i}>
                    <td className="mono small">{r.at.replace("T", " ").slice(0, 19)}</td>
                    <td><span className="tag">{r.source}</span></td>
                    <td className="mono small">{r.model || "—"}</td>
                    <td style={{ textAlign: "right" }}>{fmt(r.input_tokens)}</td>
                    <td style={{ textAlign: "right" }}>{r.cache_read_tokens ? fmt(r.cache_read_tokens) : "—"}</td>
                    <td style={{ textAlign: "right" }}>{fmt(r.output_tokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
