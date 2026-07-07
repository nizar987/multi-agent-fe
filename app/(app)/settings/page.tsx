"use client";
import { useCallback, useEffect, useState } from "react";
import SecretField from "@/components/SecretField";
import TestConnection from "@/components/TestConnection";
import ConnectionsManager from "@/components/ConnectionsManager";
import CronManager from "@/components/CronManager";

const MODEL_PRESETS = ["claude-sonnet-5", "claude-opus-4.8", "claude-haiku-4.5"];

export default function SettingsPage() {
  const [data, setData] = useState<any>(null);
  const [aiBaseUrl, setAiBaseUrl] = useState("");
  const [aiModel, setAiModel] = useState("");
  const [aiFail, setAiFail] = useState(false);
  const [backupRunning, setBackupRunning] = useState(false);
  const [backupResult, setBackupResult] = useState<any>(null);

  const load = useCallback(async () => {
    const d = await fetch("/api/settings").then((r) => r.json());
    setData(d);
    setAiBaseUrl(d.config.ai.baseUrl);
    setAiModel(d.config.ai.model);
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

  const loadLogs = async () => {
    // removed — logs now live on /logs page
  };

  if (!data) return <div className="skeleton" style={{ width: 300, height: 20 }} />;

  return (
    <div>
      <h1>Settings</h1>

      {/* ============ AI Provider ============ */}
      <section className="settings-section" id="ai">
        <h2>AI Provider</h2>
        <div className="field">
          <label>Base URL</label>
          <input
            className={`input mono${aiFail ? " field-error" : ""}`}
            value={aiBaseUrl}
            onChange={(e) => setAiBaseUrl(e.target.value)}
            onBlur={() => saveConfig({ ai: { baseUrl: aiBaseUrl, model: aiModel } })}
          />
          <div className="hint">Anthropic directly, or a compatible gateway (e.g. Genfity).</div>
        </div>
        <SecretField
          label="API Key"
          name="aiApiKey"
          isSet={data.secrets.aiApiKey.set}
          tail={data.secrets.aiApiKey.tail}
          backend={data.secretBackend}
          onChanged={load}
          placeholder="sk-ant-…"
        />
        <div className="field">
          <label>Default model</label>
          <div className="row">
            <select className="input" style={{ width: 240 }} value={MODEL_PRESETS.includes(aiModel) ? aiModel : "__custom"}
              onChange={(e) => {
                if (e.target.value !== "__custom") {
                  setAiModel(e.target.value);
                  saveConfig({ ai: { baseUrl: aiBaseUrl, model: e.target.value } });
                }
              }}>
              {MODEL_PRESETS.map((m) => <option key={m} value={m}>{m}</option>)}
              <option value="__custom">custom…</option>
            </select>
            <input className="input mono" style={{ flex: 1 }} value={aiModel}
              onChange={(e) => setAiModel(e.target.value)}
              onBlur={() => saveConfig({ ai: { baseUrl: aiBaseUrl, model: aiModel } })}
              placeholder="custom model name via gateway" />
          </div>
          <div className="hint">Applies to the next chat immediately — no restart needed.</div>
        </div>
        <TestConnection payload={{ service: "ai", baseUrl: aiBaseUrl, model: aiModel }} onResult={(ok) => setAiFail(!ok)} />
      </section>

      {/* ============ Web Search (Tavily) ============ */}
      <section className="settings-section" id="tavily">
        <h2>Web Search (Tavily)</h2>
        <div className="hint mb-2">
          Give agents with the <strong>Tavily</strong> tool live web access: search, extract page
          content, crawl and map sites. Get a free API key at{" "}
          <a href="https://app.tavily.com" target="_blank" rel="noreferrer">app.tavily.com</a> (1,000 credits/month).
        </div>
        <SecretField
          label="API Key"
          name="tavilyApiKey"
          isSet={data.secrets.tavilyApiKey?.set}
          tail={data.secrets.tavilyApiKey?.tail}
          backend={data.secretBackend}
          onChanged={load}
          placeholder="tvly-…"
        />
      </section>

      {/* ============ Connections (multiple per type) ============ */}
      <section className="settings-section" id="connections">
        <h2>Connections</h2>
        <div className="hint mb-2">
          Add as many GitHub, GitLab, database and Redis connections as you like — pick which one is
          <strong> active</strong> for each type. Agents always use the active connection.
        </div>
        <ConnectionsManager onChanged={load} />
      </section>

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

      {/* ============ Cron Jobs ============ */}
      <section className="settings-section" id="cron">
        <h2>Scheduled Tasks (Cron)</h2>
        <CronManager />
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
