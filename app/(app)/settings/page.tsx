"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import ToolCacheSettings from "@/components/ToolCacheSettings";
import RunWatchdogSettings from "@/components/RunWatchdogSettings";
import SharedDbSettings from "@/components/SharedDbSettings";
import PageHeader from "@/components/PageHeader";
import SettingsNav from "@/components/SettingsNav";
import Icon from "@/components/Icon";

const SETTINGS_SECTIONS = [
  { id: "filesystem", label: "Filesystem" },
  { id: "backup", label: "Backup" },
  { id: "shared-db", label: "Shared database" },
  { id: "tool-cache", label: "Tool cache" },
  { id: "auto-resume", label: "Auto-resume" },
  { id: "misc", label: "Appearance & more" },
];

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
    // Apply immediately to <html> so there is no flash
    if (theme === "system") {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = theme;
    }
    // Persist to localStorage so the theme-init script (app/layout.tsx)
    // can restore the correct theme on next load before first paint.
    try { localStorage.setItem("agent_platform_theme", theme); } catch { /* ignore */ }
    // Desktop shell: keep native chrome (vibrancy, scrollbars) in sync.
    (window as Window & { desktop?: { setTheme?: (t: string) => void } }).desktop?.setTheme?.(theme);
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

  if (!data) {
    return (
      <div className="page-narrow">
        <PageHeader title="Settings" />
        <div className="skeleton" style={{ height: 120, borderRadius: 14 }} />
      </div>
    );
  }

  const aiKeyMissing = !data.secrets?.aiApiKey?.set;

  return (
    <div className="settings-layout">
      <SettingsNav sections={SETTINGS_SECTIONS} />
      <div className="settings-main">
      <PageHeader
        title="Settings"
        subtitle={<>
          AI providers & connectors live in <Link href="/connections">Connections</Link>, recurring tasks in{" "}
          <Link href="/schedules">Schedules</Link>, and always-allowed actions in <Link href="/permissions">Permissions</Link>.
        </>}
      />

      {/* AI key missing — one-click CTA to Connections (DESIGN §5) */}
      {aiKeyMissing && (
        <div className="card callout-accent">
          <div style={{ flex: 1, minWidth: 220 }}>
            <strong>Connect an AI model first</strong>
            <p className="muted small" style={{ margin: "4px 0 0" }}>
              Agents need an API key to answer. Takes less than a minute.
            </p>
          </div>
          <Link href="/connections#ai" className="btn btn-primary" style={{ flexShrink: 0 }}>
            Open Connections → AI Provider
          </Link>
        </div>
      )}

      {/* ============ Filesystem ============ */}
      <section className="settings-section" id="filesystem">
        <h2>Filesystem</h2>
        <div className="callout-warn">
          <Icon name="alert" size={15} />
          <span>Agents with the Filesystem tool can read and write everything inside the folders listed here.</span>
        </div>
        {data.config.filesystem.allowedDirs.length === 0 && (
          <div className="empty-state">
            <span className="glyph"><Icon name="folder" size={22} /></span>
            <span className="empty-state-title">No allowed folders yet</span>
            <span>Agents cannot access local files.</span>
          </div>
        )}
        {data.config.filesystem.allowedDirs.length > 0 && (
          <div className="item-list mb-4">
            {data.config.filesystem.allowedDirs.map((dir: string) => (
              <div key={dir} className="item-row">
                <span className="item-row-icon"><Icon name="folder" size={15} /></span>
                <div className="item-row-main">
                  <div className="path-truncate" title={dir}>{dir}</div>
                </div>
                <div className="item-row-actions">
                  <button className="btn btn-danger-ghost btn-sm" onClick={() => removeFolder(dir)}>Remove</button>
                </div>
              </div>
            ))}
          </div>
        )}
        <button className="btn" onClick={addFolder}><Icon name="plus" size={14} strokeWidth={2.2} /> Add folder</button>
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
            <Icon name="folder" size={15} className="workdir-icon" />
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
            Last backup: {new Date(data.backup.lastRun).toLocaleString()} — <span style={{ color: data.backup.lastStatus === "ok" ? "var(--success)" : "var(--danger)" }}>{data.backup.lastStatus === "ok" ? "✓ success" : `✗ ${data.backup.lastStatus}`}</span>
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

      {/* ============ Shared database (agents / skills / knowledge) ============ */}
      <SharedDbSettings
        secret={data.secrets?.sharedDbUrl ?? { set: false, tail: null }}
        backend={data.secretBackend}
        onSecretChanged={load}
      />

      {/* ============ Tool cache ============ */}
      <ToolCacheSettings />

      {/* ============ Auto-resume ============ */}
      <RunWatchdogSettings />

      {/* ============ Appearance & more ============ */}
      <section className="settings-section" id="misc">
        <h2>Appearance & More</h2>
        <div className="field">
          <label>Theme</label>
          <div className="segmented" role="radiogroup" aria-label="Theme">
            {["system", "light", "dark"].map((t) => (
              <button key={t}
                role="radio"
                aria-checked={data.config.ui.theme === t}
                className={`segmented-item${data.config.ui.theme === t ? " active" : ""}`}
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
    </div>
  );
}
