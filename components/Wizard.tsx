"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 4-step onboarding wizard (DESIGN §3):
 * 1. AI API key (required — "Next" disabled until the test succeeds)
 * 2. GitHub & GitLab (skippable)
 * 3. Local folders (skippable)
 * 4. Done — 3 example agents as cards, click → straight into chat.
 */
export default function Wizard({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [step, setStep] = useState(1);

  // step 1
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://api.anthropic.com");
  const [model, setModel] = useState("claude-sonnet-5");
  const [testState, setTestState] = useState<"idle" | "loading" | "ok" | "fail">("idle");
  const [testMsg, setTestMsg] = useState("");

  // step 2
  const [ghToken, setGhToken] = useState("");
  const [glToken, setGlToken] = useState("");
  const [glUrl, setGlUrl] = useState("https://gitlab.com/api/v4");

  // step 3
  const [folders, setFolders] = useState<string[]>([]);

  // step 4
  const [seedAgents, setSeedAgents] = useState<{ id: number; name: string }[]>([]);

  const testAi = async () => {
    setTestState("loading");
    const r = await fetch("/api/settings/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ service: "ai", apiKey, baseUrl, model }),
    }).then((r) => r.json()).catch(() => ({ ok: false, message: "Failed to test the connection." }));
    setTestMsg(r.message);
    setTestState(r.ok ? "ok" : "fail");
  };

  const finishStep1 = async () => {
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ai: { baseUrl, model } }),
    });
    await fetch("/api/settings/secret", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "aiApiKey", value: apiKey }),
    });
    window.dispatchEvent(new Event("settings-changed"));
    setStep(2);
  };

  const finishStep2 = async (skip: boolean) => {
    if (!skip) {
      if (ghToken.trim()) {
        await fetch("/api/settings/secret", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "githubToken", value: ghToken }),
        });
      }
      if (glToken.trim()) {
        await fetch("/api/settings", {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify({ gitlab: { apiUrl: glUrl } }),
        });
        await fetch("/api/settings/secret", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "gitlabToken", value: glToken }),
        });
      }
    }
    setStep(3);
  };

  const pickFolder = async () => {
    const r = await fetch("/api/settings/pick-folder", { method: "POST" });
    if (r.status === 501) { alert((await r.json()).error); return; }
    const d = await r.json();
    if (d.folder) setFolders((f) => [...f, d.folder]);
  };

  const finishStep3 = async () => {
    // Save selected folders to settings before proceeding (MAJOR-6 fix)
    if (folders.length > 0) {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filesystem: { allowedDirs: folders } }),
      });
    }
    const r = await fetch("/api/onboarding", { method: "POST" }).then((r) => r.json());
    setSeedAgents(r.agents ?? []);
    setStep(4);
  };

  const StepDots = () => (
    <div className="wizard-steps">
      {[1, 2, 3, 4].map((i) => (
        <span key={i} style={{ display: "contents" }}>
          <span className={`step-dot${i < step ? " done" : i === step ? " current" : ""}`} />
          {i < 4 && <span className="step-line" />}
        </span>
      ))}
    </div>
  );

  return (
    <div className="wizard-overlay">
      <div className="wizard-modal">
        <StepDots />

        {step === 1 && (
          <div className="wizard-step" key={1}>
            <h2>Connect an AI model</h2>
            <p className="muted small">The only required step. Your API key is stored securely in OS storage.</p>
            <div className="field">
              <label>Base URL</label>
              <input className="input mono" value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); setTestState("idle"); }} />
            </div>
            <div className="field">
              <label>API Key</label>
              <input className={`input mono${testState === "fail" ? " field-error" : ""}`} type="password" placeholder="sk-ant-…"
                value={apiKey} onChange={(e) => { setApiKey(e.target.value); setTestState("idle"); }} />
              {testState === "fail" && <div className="error-text">{testMsg}</div>}
              {testState === "ok" && <div className="test-success">✓ {testMsg}</div>}
            </div>
            <div className="field">
              <label>Model</label>
              <input className="input mono" value={model} onChange={(e) => { setModel(e.target.value); setTestState("idle"); }} />
            </div>
            <div className="wizard-actions">
              <button className="btn" onClick={testAi} disabled={!apiKey.trim() || testState === "loading"} data-loading={testState === "loading"}>
                {testState === "loading" && <span className="spinner" />} Test connection
              </button>
              <button className="btn btn-primary" disabled={testState !== "ok"} onClick={finishStep1}>Next →</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="wizard-step" key={2}>
            <h2>GitHub & GitLab <span className="tag tag-optional">optional</span></h2>
            <p className="muted small">So agents can read repos, issues, and MRs. You can fill this in later in Settings.</p>
            <div className="field">
              <label>GitHub Personal Access Token</label>
              <input className="input mono" type="password" placeholder="ghp_…" value={ghToken} onChange={(e) => setGhToken(e.target.value)} />
            </div>
            <div className="field">
              <label>GitLab API URL</label>
              <input className="input mono" value={glUrl} onChange={(e) => setGlUrl(e.target.value)} />
            </div>
            <div className="field">
              <label>GitLab Personal Access Token</label>
              <input className="input mono" type="password" placeholder="glpat-…" value={glToken} onChange={(e) => setGlToken(e.target.value)} />
            </div>
            <div className="wizard-actions">
              <button className="btn" onClick={() => finishStep2(true)}>Skip</button>
              <button className="btn btn-primary" onClick={() => finishStep2(false)}>Next →</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="wizard-step" key={3}>
            <h2>Local folders <span className="tag tag-optional">optional</span></h2>
            <p className="muted small">Pick the folders agents may access with the Filesystem tool.</p>
            {folders.map((f) => (
              <div key={f} className="list-row"><span>📁</span><div className="grow path-truncate">{f}</div></div>
            ))}
            <button className="btn mb-4" onClick={pickFolder}>+ Add folder</button>
            <div className="wizard-actions">
              <button className="btn" onClick={finishStep3}>Skip</button>
              <button className="btn btn-primary" onClick={finishStep3}>Next →</button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="wizard-step" key={4}>
            <h2>All set 🎉</h2>
            <p className="muted small">3 example agents were created for you — click one to start chatting right away.</p>
            <div className="card-grid mb-4">
              {seedAgents.map((a) => (
                <div key={a.id} className="card clickable" onClick={() => router.push(`/chat/${a.id}`)}>  
                  <strong>{a.name}</strong>
                  <div className="muted small">Start chatting →</div>
                </div>
              ))}
            </div>
            <div className="wizard-actions">
              <span />
              <button className="btn btn-primary" onClick={onDone}>Enter the app</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
