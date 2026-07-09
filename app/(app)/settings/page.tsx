"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

export default function SettingsPage() {
  const [data, setData] = useState<any>(null);
  const [backupRunning, setBackupRunning] = useState(false);
  const [backupResult, setBackupResult] = useState<any>(null);

  const load = useCallback(async () => {
    const d = await fetch("/api/settings").then((r) => r.json());
    setData(d);
  }, []);
  useEffect(() => { load(); }, [load]);

  const saveConfig = async (patch: any) => {
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    load();
    window.dispatchEvent(new Event("settings-changed"));
  };

  const addFolder = async () => {
    const r = await fetch("/api/settings/pick-folder", { method: "POST" });
    if (r.status === 501) { alert((await r.json()).error); return; }
    load();
  };

  const removeFolder = (dir: string) => {
    const dirs = data.config.filesystem.allowedDirs.filter((d: string) => d !== dir);
    saveConfig({ filesystem: { allowedDirs: dirs } });
  };

  const setTheme = (theme: string) => {
    document.documentElement.dataset.theme = theme === "system" ? "" : theme;
    saveConfig({ ui: { theme } });
  };

  const pickBackupFolder = async () => {
    const r = await fetch("/api/settings/pick-backup-folder", { method: "POST" });
    if (r.status === 501) { alert((await r.json()).error); return; }
    const j = await r.json();
    if (!j.canceled) load();
  };

  const runBackup = async () => {
    setBackupRunning(true);
    setBackupResult(null);
    try {
      const r = await fetch("/api/backup", { method: "POST" });
      const j = await r.json();
      setBackupResult(j);
      load();
    } catch (e: any) {
      setBackupResult({ ok: false, error: e.message });
    } finally {
      setBackupRunning(false);
    }
  };

  if (!data) return <div className="skeleton" style={{ width: 300, height: 20 }} />;

  return (
    <div>
      <h1>Settings</h1>

      <p className="muted small">
        Looking for AI providers & connectors? They moved to <Link href="/connections">Connections</Link>.
        Recurring agent tasks are under <Link href="/schedules">Schedules</Link>, and always-allowed
        actions under <Link href="/permissions">Permissions</Link>.
      </p>

      {/* ============ Filesystem ============ */}
      <section className="settings-section" id="filesystem">
        <h2>Filesystem</h2>
        <div className="banner-danger">
          Agents with the Filesystem tool can read and write everything inside the folders listed here.
        </div>
        {data.config.filesystem.allowedDirs.length === 0 && (
          <div className="empty-state">
            <div className="glyph">📁</div>
            No allowed folders yet. Agents cannot access local files.
          </div>
        )}
        {data.config.filesystem.allowedDirs.map((dir: string) => (
          <div key={dir} className="list-row">
            <span>📁</span>
            <div className="grow path-truncate" title={dir}>{dir}</div>
            <button className="btn btn-danger-ghost" onClick={() => removeFolder(dir)}>Remove</button>
          </div>
        ))}
        <button className="btn" onClick={addFolder}>+ Add folder</button>
      </section>

      {/* ============ Backup ============ */}
      <section className="settings-section" id="backup">
        <h2>Backup</h2>
        <div className="hint mb-2">
          Database is automatically backed up to CSV once per day. You can also trigger a manual backup.
        </div>
        <div className="field">
          <label>Backup folder</label>
          <div className="list-row">
            <span>📁</span>
            <div className="grow path-truncate" title={data.backup?.backupDir || "(not set)"}>
              {data.backup?.backupDir || "(not set)"}
            </div>
            <button className="btn" onClick={pickBackupFolder}>
              {data.backup?.backupDir ? "Change…" : "Choose folder…"}
            </button>
          </div>
        </div>
        {data.backup?.lastRun && (
          <div className="hint mb-2">
            Last backup: {new Date(data.backup.lastRun).toLocaleString()} — {data.backup.lastStatus === "ok" ? "✓ success" : `✗ ${data.backup.lastStatus}`}
          </div>
        )}
        <div className="row">
          <button className="btn btn-primary" onClick={runBackup} disabled={backupRunning || !data.backup?.backupDir}>
            {backupRunning ? "Backing up…" : "Backup now"}
          </button>
          {backupResult && (
            <span style={{ fontSize: 13, marginLeft: 10, color: backupResult.ok ? "var(--success)" : "var(--danger)" }}>
              {backupResult.ok
                ? `✓ ${backupResult.tables} tables, ${backupResult.rows} rows`
                : `✗ ${backupResult.error}`}
            </span>
          )}
        </div>
      </section>

      {/* ============ Appearance & more ============ */}
      <section className="settings-section" id="misc">
        <h2>Appearance & More</h2>
        <div className="field">
          <label>Theme</label>
          <div className="row">
            {["system", "light", "dark"].map((t) => (
              <button key={t}
                className={`btn${data.config.ui.theme === t ? " btn-primary" : ""}`}
                onClick={() => setTheme(t)}>
                {t === "system" ? "Follow OS" : t === "light" ? "Light" : "Dark"}
              </button>
            ))}
          </div>
        </div>
        <button className="btn" onClick={async () => {
          await fetch("/api/settings", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ onboardingDone: false }),
          });
          window.location.href = "/";
        }}>
          Run initial setup again
        </button>
      </section>
    </div>
  );
}
