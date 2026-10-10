"use client";
import { useCallback, useEffect, useState } from "react";

interface RunInfo {
  id: number;
  agent_name: string | null;
  surface: string;
  status: string;
  resume_count: number;
  error: string | null;
  started_at: string;
}

interface WatchdogInfo {
  enabled: boolean;
  maxResumes: number;
  runs: RunInfo[];
}

const STATUS_LABEL: Record<string, string> = {
  running: "● running",
  done: "✓ done",
  incomplete: "◐ incomplete",
  failed: "⚠ failed (will retry)",
  error: "✕ error",
  interrupted: "⏸ interrupted",
  resumed: "↻ resumed",
  superseded: "– superseded",
};

/** SQLite datetime('now') is UTC without a zone — show it in local time. */
function localTime(utc: string): string {
  const d = new Date(`${utc.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? utc : d.toLocaleString([], { dateStyle: "short", timeStyle: "short" });
}

/** Settings section: auto-resume toggle + recent agent runs. */
export default function RunWatchdogSettings() {
  const [info, setInfo] = useState<WatchdogInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const r = await fetch("/api/watchdog");
      if (!r.ok) throw new Error(`Server error: ${r.status}`);
      setInfo(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    try {
      const r = await fetch("/api/watchdog", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!r.ok) throw new Error(`Server error: ${r.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-section" id="auto-resume">
      <h2>Auto-resume</h2>
      <div className="hint mb-2">
        Keeps agents working until the task is done. During a run, an agent that stops early (open checklist items, a
        reply that announces work it did not do) is told to continue, and temporary AI errors are retried. A watchdog
        checks every minute for runs that died — app closed, crash, provider outage — and for stuck Manager tasks, and
        resumes them{info ? ` (at most ${info.maxResumes} times each)` : ""}.
      </div>
      {error && <div className="banner-danger mb-2">{error}</div>}
      {info && (
        <>
          <div className="row mb-2">
            <button className={`btn${info.enabled ? " btn-primary" : ""}`} disabled={busy} onClick={() => toggle(true)}>On</button>
            <button className={`btn${!info.enabled ? " btn-primary" : ""}`} disabled={busy} onClick={() => toggle(false)}>Off</button>
            <button className="btn" disabled={busy} onClick={load}>Refresh</button>
          </div>
          {info.runs.length > 0 && (
            <div className="table-wrap">
              <table className="usage-table">
                <thead>
                  <tr><th>Started</th><th>Agent</th><th>Where</th><th>Status</th><th style={{ textAlign: "right" }}>Resumes</th></tr>
                </thead>
                <tbody>
                  {info.runs.map((r) => (
                    <tr key={r.id} title={r.error ?? ""}>
                      <td className="mono small">{localTime(r.started_at)}</td>
                      <td>{r.agent_name ?? "—"}</td>
                      <td><span className="tag">{r.surface}</span></td>
                      <td className="small">{STATUS_LABEL[r.status] ?? r.status}</td>
                      <td style={{ textAlign: "right" }}>{r.resume_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
