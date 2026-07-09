"use client";
import { useCallback, useEffect, useState } from "react";
import SecretField from "@/components/SecretField";
import TestConnection from "@/components/TestConnection";
import ConnectionsManager from "@/components/ConnectionsManager";
import ModelSelect from "@/components/ModelSelect";

const MODEL_PRESETS = ["claude-sonnet-5", "claude-opus-4.8", "claude-haiku-4.5"];

export default function ConnectionsPage() {
  const [data, setData] = useState<any>(null);
  const [aiBaseUrl, setAiBaseUrl] = useState("");
  const [aiModel, setAiModel] = useState("");
  const [aiProvider, setAiProvider] = useState("auto");
  const [visionModel, setVisionModel] = useState("");
  const [aiFail, setAiFail] = useState(false);

  const load = useCallback(async () => {
    const d = await fetch("/api/settings").then((r) => r.json());
    setData(d);
    setAiBaseUrl(d.config.ai.baseUrl);
    setAiModel(d.config.ai.model);
    setAiProvider(d.config.ai.provider ?? "auto");
    setVisionModel(d.config.ai.visionModel ?? "");
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

  if (!data) return <div className="skeleton" style={{ width: 300, height: 20 }} />;

  return (
    <div>
      <h1>Connections</h1>

      {/* ============ Connections (multiple per type) ============ */}
      <section className="settings-section" id="connections">
        <div className="hint mb-2">
          Add as many AI providers, GitHub, GitLab, database and Redis connections as you like —
          pick which one is <strong>active</strong> for each type. Agents always use the active connection.
        </div>
        <ConnectionsManager onChanged={load} />
      </section>

      {/* ============ Active AI values ============ */}
      <section className="settings-section" id="ai">
        <h2>Active AI Provider</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          These are the values in use right now — the active AI connection above is mirrored here
          automatically. Editing here changes the live values directly.
        </p>
        <div className="field">
          <label>API format</label>
          <select
            className="input"
            style={{ width: 320 }}
            value={aiProvider}
            onChange={(e) => {
              setAiProvider(e.target.value);
              saveConfig({ ai: { baseUrl: aiBaseUrl, model: aiModel, provider: e.target.value } });
            }}
          >
            <option value="auto">Auto-detect from Base URL</option>
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="openai">OpenAI-compatible (OpenAI, Kimi/Moonshot, DeepSeek, OpenRouter…)</option>
            <option value="gemini">Google Gemini</option>
          </select>
          <div className="hint">
            Which wire format the endpoint speaks — tool calling & streaming are translated automatically.
          </div>
        </div>
        <div className="field">
          <label>Base URL</label>
          <input
            className={`input mono${aiFail ? " field-error" : ""}`}
            value={aiBaseUrl}
            onChange={(e) => setAiBaseUrl(e.target.value)}
            onBlur={() => saveConfig({ ai: { baseUrl: aiBaseUrl, model: aiModel, provider: aiProvider } })}
          />
          <div className="hint">
            e.g. https://api.anthropic.com · https://api.openai.com · https://api.moonshot.ai · https://generativelanguage.googleapis.com
          </div>
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
              onBlur={() => saveConfig({ ai: { baseUrl: aiBaseUrl, model: aiModel, provider: aiProvider } })}
              placeholder="e.g. kimi-k2.6 · gpt-4o · gemini-2.5-pro" />
          </div>
          <div className="hint">Applies to the next chat immediately — no restart needed.</div>
        </div>
        <TestConnection payload={{ service: "ai", baseUrl: aiBaseUrl, model: aiModel, provider: aiProvider }} onResult={(ok) => setAiFail(!ok)} />
      </section>

      {/* ============ Vision tool (read_image) ============ */}
      <section className="settings-section" id="vision">
        <h2>Vision Tool (read_image)</h2>
        <div className="hint mb-2">
          Agents with the <strong>Read images</strong> tool enabled forward attached photos/screenshots
          to this model — useful when their own chat model (or gateway) can't see images.
          Recommended: <code>mistralai/ministral-14b-instruct-2512</code> via NVIDIA NIM
          (Base URL <code>https://integrate.api.nvidia.com</code>, format <code>openai</code>,
          key <code>nvapi-…</code>). With <code>NVIDIA_API_KEY</code> in <code>.env</code> the
          connection & this default are set up automatically. Enable/disable per agent in the agent's
          tool list.
        </div>
        <div className="field">
          <label>Vision model</label>
          <ModelSelect
            value={visionModel}
            onChange={(m) => {
              setVisionModel(m);
              saveConfig({ ai: { baseUrl: aiBaseUrl, model: aiModel, provider: aiProvider, visionModel: m } });
            }}
            defaultLabel="Active model (default)"
            includeHidden
            title="Vision model for the read_image tool"
            style={{ width: 320 }}
          />
        </div>
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
    </div>
  );
}
