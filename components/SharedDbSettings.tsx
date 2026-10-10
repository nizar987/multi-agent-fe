"use client";
import { useCallback, useEffect, useState } from "react";
import SecretField from "@/components/SecretField";

type Counts = { agents: number; skills: number; knowledge: number };

interface SharedDbInfo {
  mode: "local" | "shared";
  online: boolean | null;
  lastSyncAt: number | null;
  lastError: string | null;
  adoptedAction: "uploaded" | "downloaded" | null;
  counts: { remote: Counts | null; local: Counts };
}

interface Props {
  secret: { set: boolean; tail: string | null };
  backend: { label: string; secure: boolean };
  onSecretChanged: () => void;
}

const fmtCounts = (c: Counts) => `${c.agents} agents · ${c.skills} skills · ${c.knowledge} knowledge`;

/** Settings section: shared PostgreSQL for agents, skills and knowledge. */
export default function SharedDbSettings({ secret, backend, onSecretChanged }: Props) {
  const [info, setInfo] = useState<SharedDbInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const r = await fetch("/api/shared-db");
      if (!r.ok) throw new Error(`Server error: ${r.status}`);
      setInfo(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, []);

  useEffect(() => { load(); }, [load, secret.set, secret.tail]);

  const syncNow = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/shared-db", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      if (!r.ok) throw new Error(`Server error: ${r.status}`);
      setInfo(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  };

  const onChanged = () => {
    onSecretChanged();
    // Connect right away so the first upload/download happens while the user watches.
    setTimeout(() => { void syncNow(); }, 300);
  };

  return (
    <section className="settings-section" id="shared-db">
      <h2>Shared database</h2>
      <div className="hint mb-2">
        Store <strong>agents, skills and knowledge</strong> in PostgreSQL (e.g. Railway) so every installation sees the
        same catalog. Everything else — conversations, memory, usage — stays on this computer. A local copy keeps agents
        running when the database is unreachable (read-only until it is back). The first time you connect, an empty
        database receives this computer&apos;s catalog; a database that already has data replaces the local copy.
      </div>
      <SecretField
        label="Connection URL"
        name="sharedDbUrl"
        isSet={secret.set}
        tail={secret.tail}
        backend={backend}
        onChanged={onChanged}
        placeholder="postgresql://user:password@host:port/railway"
      />
      {error && <div className="banner-danger mb-2">{error}</div>}
      {info && (
        <>
          <div className="hint mb-2">
            {info.mode === "local"
              ? "Not connected — using the local SQLite catalog only."
              : info.online === false
                ? <span style={{ color: "var(--danger)" }}>⚠ Unreachable — using the local copy (read-only). {info.lastError}</span>
                : info.online
                  ? <span style={{ color: "var(--success)" }}>✓ Connected{info.lastSyncAt ? ` · last sync ${new Date(info.lastSyncAt).toLocaleTimeString()}` : ""}</span>
                  : "Connecting…"}
          </div>
          {info.adoptedAction && (
            <div className="hint mb-2">
              {info.adoptedAction === "uploaded"
                ? "✓ This computer's catalog was uploaded to the shared database."
                : "✓ The catalog from the shared database is now used here."}
            </div>
          )}
          <div className="hint mb-2">
            {info.counts.remote && <>Shared database: {fmtCounts(info.counts.remote)}<br /></>}
            Local copy: {fmtCounts(info.counts.local)}
          </div>
          {info.mode === "shared" && (
            <div className="row">
              <button className="btn" onClick={syncNow} disabled={busy}>{busy ? "Syncing…" : "Sync now"}</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
