"use client";
import { useCallback, useEffect, useState } from "react";

type Backend = "memory" | "redis";

interface CacheInfo {
  backend: Backend;
  degraded: boolean;
  entries: number | null;
  stats: { hits: number; misses: number; shared: number; dedupTokensSaved: number };
}

const fmt = (n: number) => n.toLocaleString("en-US");

/** Settings section: shared tool-result cache backend, stats and a clear button. */
export default function ToolCacheSettings() {
  const [info, setInfo] = useState<CacheInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      setError(null);
      const r = await fetch("/api/tool-cache");
      if (!r.ok) throw new Error(`Server error: ${r.status}`);
      setInfo(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const setBackend = async (backend: Backend) => {
    setBusy(true);
    setNote("");
    try {
      const r = await fetch("/api/tool-cache", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ backend }),
      });
      if (!r.ok) throw new Error(`Server error: ${r.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    setNote("");
    try {
      const r = await fetch("/api/tool-cache", { method: "DELETE" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `Server error: ${r.status}`);
      setNote(`✓ Cleared ${fmt(j.removed)} entr${j.removed === 1 ? "y" : "ies"}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to clear");
    } finally {
      setBusy(false);
    }
  };

  const lookups = info ? info.stats.hits + info.stats.misses + info.stats.shared : 0;
  const hitRate = info && lookups > 0 ? `${(((info.stats.hits + info.stats.shared) / lookups) * 100).toFixed(1)}%` : "—";

  return (
    <section className="settings-section" id="tool-cache">
      <h2>Tool cache</h2>
      <div className="hint mb-2">
        Results of read-only tools (web search, GitHub/GitLab reads, file reads) are shared between all agents, so
        parallel agents don&apos;t repeat the same work. File results are keyed by modification time, so edited files
        are never served stale. Repeated identical results within a run are replaced by a short note to save tokens.
      </div>
      {error && <div className="banner-danger mb-2">{error}</div>}
      {info && (
        <>
          <div className="field">
            <label>Storage</label>
            <div className="row">
              <button className={`btn${info.backend === "memory" ? " btn-primary" : ""}`} disabled={busy}
                onClick={() => setBackend("memory")}>In-memory</button>
              <button className={`btn${info.backend === "redis" ? " btn-primary" : ""}`} disabled={busy}
                onClick={() => setBackend("redis")}>Redis</button>
            </div>
            <div className="hint" style={{ marginTop: 6 }}>
              {info.backend === "redis"
                ? "Uses the Redis connection from Connections (keys prefixed ap:toolcache:). Survives app restarts."
                : "Kept in the app's memory — cleared when the app restarts. No setup needed."}
            </div>
            {info.degraded && (
              <div className="hint" style={{ color: "var(--danger)", marginTop: 4 }}>
                Redis is unreachable — temporarily using the in-memory cache.
              </div>
            )}
          </div>
          <div className="hint mb-2">
            {info.entries === null ? "Entries: —" : `Entries: ${fmt(info.entries)}`} · hit rate {hitRate} (
            {fmt(info.stats.hits)} cache hits, {fmt(info.stats.shared)} shared with a parallel agent, {fmt(info.stats.misses)} misses)
            · ~{fmt(info.stats.dedupTokensSaved)} tokens saved by de-dup — since the app started
          </div>
          <div className="row">
            <button className="btn" onClick={clear} disabled={busy}>Clear cache</button>
            <button className="btn" onClick={load} disabled={busy}>Refresh</button>
            {note && <span className="small" style={{ marginLeft: 10, color: "var(--success)" }}>{note}</span>}
          </div>
        </>
      )}
    </section>
  );
}
