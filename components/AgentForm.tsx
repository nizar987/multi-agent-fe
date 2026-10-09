"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ModelSelect from "@/components/ModelSelect";
import FolderPicker from "@/components/FolderPicker";

type ToolStatus = { status: "connected" | "unconfigured" | "error" | "connecting"; detail: string };

const TOOL_LABELS: Record<string, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  tavily: "Tavily web (search / extract / crawl / map)",
  tavily_mcp: "Tavily remote MCP",
  filesystem: "Filesystem",
  memory: "Shared memory",
  delegate: "Delegate to other agents",
  vision: "Read images (via vision model)",
  shell: "Shell (run commands)",
  database: "Database (SQL query)",
  redis: "Redis",
  monitoring: "Monitoring (Grafana / Prometheus / Loki)",
  video: "Video editing (ffmpeg: trim / concat / subtitles / transcribe)",
  env: "Read .env file",
};

function StatusDot({ s }: { s: ToolStatus["status"] }) {
  const cls = s === "connected" ? "dot-green" : s === "error" ? "dot-red" :
    s === "connecting" ? "dot-blue pulse-dot" : "dot-gray";
  return <span className={`dot ${cls}`} />;
}

const AVATARS = ["🤖", "🧠", "⚡", "🔍", "📚", "🛠️", "💾", "🌐", "📊", "✍️", "🧪", "🎯", "📁", "🗂️", "🚀", "🦉"];
const COLORS = ["#c15f3c", "#2b6cb0", "#2e7d4f", "#b7791f", "#7c5cbf", "#c0392b", "#0f766e", "#6b6b66"];

export default function AgentForm({ agentId }: { agentId?: number }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [modelOverride, setModelOverride] = useState("");
  const [tools, setTools] = useState<string[]>([]);
  const [skillIds, setSkillIds] = useState<number[]>([]);
  const [skills, setSkills] = useState<any[]>([]);
  const [toolStatus, setToolStatus] = useState<Record<string, ToolStatus>>({});
  const [saving, setSaving] = useState(false);
  const [avatar, setAvatar] = useState("🤖");
  const [color, setColor] = useState("#c15f3c");
  const [workingDir, setWorkingDir] = useState<string>("");

  useEffect(() => {
    fetch("/api/skills").then((r) => r.json()).then(setSkills);
    fetch("/api/tools/status").then((r) => r.json()).then((d) => setToolStatus(d.tools));
    // Existing categories power the datalist so labels stay consistent.
    fetch("/api/agents").then((r) => r.json()).then((list: any[]) => {
      const cats = Array.from(
        new Set(list.map((a) => (a.category ?? "").trim()).filter(Boolean))
      ).sort();
      setCategories(cats);
    });
    if (agentId) {
      fetch(`/api/agents/${agentId}`).then((r) => r.json()).then((a) => {
        setName(a.name); setDescription(a.description ?? "");
        setCategory(a.category ?? "");
        setSystemPrompt(a.system_prompt ?? "");
        setModelOverride(a.model_override ?? "");
        setTools(JSON.parse(a.tools || "[]"));
        setSkillIds(JSON.parse(a.skill_ids || "[]"));
        setAvatar(a.avatar ?? "🤖");
        setColor(a.color ?? "#c15f3c");
        setWorkingDir(a.working_dir ?? "");
      });
    }
  }, [agentId]);

  const toggle = (t: string) =>
    setTools((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const handleWorkingDirChange = async (dir: string) => {
    setWorkingDir(dir);
    if (!agentId) return;
    // Persist immediately via PATCH so it survives without hitting Save
    await fetch(`/api/agents/${agentId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ working_dir: dir || null }),
    });
  };

  const save = async () => {
    setSaving(true);
    const body = {
      name: name || "New agent", description, category: category.trim(),
      system_prompt: systemPrompt,
      model_override: modelOverride || null, tools, skill_ids: skillIds,
      avatar, color, working_dir: workingDir || null,
    };
    if (agentId) {
      await fetch(`/api/agents/${agentId}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    } else {
      await fetch("/api/agents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    }
    router.push("/");
  };

  const mcpTools = ["github", "gitlab", "tavily", "tavily_mcp", "filesystem", "database", "redis", "monitoring"];

  return (
    <div className="form-wrap">
      <h1>{agentId ? "Edit agent" : "New agent"}</h1>

      <div className="field">
        <label>Avatar</label>
        <div className="row mb-2">
          <span className="agent-avatar" style={{ width: 44, height: 44, fontSize: 24, background: color + "26", borderColor: color }}>{avatar}</span>
          <div>
            <div className="avatar-picker mb-2">
              {AVATARS.map((a) => (
                <button key={a} type="button" className={a === avatar ? "selected" : ""} onClick={() => setAvatar(a)}>{a}</button>
              ))}
            </div>
            <div className="color-picker">
              {COLORS.map((c) => (
                <button key={c} type="button" className={c === color ? "selected" : ""} style={{ background: c }} onClick={() => setColor(c)} />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="field">
        <label>Name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Repo Agent" />
      </div>
      <div className="field">
        <label>Description</label>
        <input className="input" value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="used by other agents to decide when to delegate to this one" />
      </div>
      <div className="field">
        <label>Category <span className="muted">(optional — group agents so the workspace can add a whole category at once)</span></label>
        <input
          className="input"
          list="agent-categories"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="e.g. coding · research · devops"
        />
        <datalist id="agent-categories">
          {categories.map((c) => <option key={c} value={c} />)}
        </datalist>
      </div>
      <div className="field">
        <label>System prompt</label>
        <textarea className="input" rows={5} value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} />
      </div>
      <div className="field">
        <label>Model <span className="muted">(optional — leave as Default to use the global model)</span></label>
        <ModelSelect value={modelOverride} onChange={setModelOverride} style={{ width: 280 }} />
        <div className="hint">Fetched live from your AI provider. Falls back to known models if the list is unavailable.</div>
      </div>

      <div className="field">
        <label>Tools</label>
        {mcpTools.map((t) => {
          const st = toolStatus[t]?.status ?? "connecting";
          const disabled = st === "unconfigured" || st === "error";
          return (
            <div key={t} className="tool-status-row">
              <input type="checkbox" id={`tool-${t}`} checked={tools.includes(t)} disabled={disabled} onChange={() => toggle(t)} />
              <StatusDot s={st} />
              <label htmlFor={`tool-${t}`} style={{ margin: 0, fontWeight: 400 }}>
                {TOOL_LABELS[t]} <span className="muted small">— {toolStatus[t]?.detail ?? "checking…"}</span>
              </label>
              {disabled && (
                <Link href={t === "monitoring" ? "/monitoring" : "/connections"} className="small">
                  {t === "monitoring" ? "Configure in Monitoring →" : "Configure in Connections →"}
                </Link>
              )}
            </div>
          );
        })}
        {["memory", "delegate", "vision", "video"].map((t) => (
          <div key={t} className="tool-status-row">
            <input type="checkbox" id={`tool-${t}`} checked={tools.includes(t)} onChange={() => toggle(t)} />
            <span className="dot dot-green" />
            <label htmlFor={`tool-${t}`} style={{ margin: 0, fontWeight: 400 }}>{TOOL_LABELS[t]}</label>
          </div>
        ))}

        {/* Shell — the most dangerous tool, separated with a warning */}
        <div className="tool-status-row">
          <input type="checkbox" id="tool-shell" checked={tools.includes("shell")} onChange={() => toggle("shell")} />
          <span className={`dot ${tools.includes("shell") ? "dot-red" : "dot-gray"}`} />
          <label htmlFor="tool-shell" style={{ margin: 0, fontWeight: 400 }}>{TOOL_LABELS.shell}</label>
        </div>
        {tools.includes("shell") && (
          <div className="banner-danger" style={{ marginTop: 6 }}>
            The agent can run shell commands in the allowed working folder (Settings → Filesystem).
            <div className="small muted" style={{ marginTop: 4 }}>
              Execution follows the mode picked in chat: Approval (ask per action),
              Act (run immediately), or Plan (plan only) — this also applies to SQL writes and Redis writes.
            </div>
          </div>
        )}

        {/* .env reader — sensitive: file contents are sent to the AI model */}
        <div className="tool-status-row">
          <input type="checkbox" id="tool-env" checked={tools.includes("env")} onChange={() => toggle("env")} />
          <span className={`dot ${tools.includes("env") ? "dot-red" : "dot-gray"}`} />
          <label htmlFor="tool-env" style={{ margin: 0, fontWeight: 400 }}>{TOOL_LABELS.env}</label>
        </div>
        {tools.includes("env") && (
          <div className="banner-danger" style={{ marginTop: 6 }}>
            The agent can read .env files (which often contain secrets) from the allowed working folder,
            and their contents are sent to the AI model.
            <div className="small muted" style={{ marginTop: 4 }}>
              Every read asks for your approval in chat (unless you picked Act mode).
            </div>
          </div>
        )}
      </div>

      <div className="field">
        <label>Skills</label>
        {skills.length === 0 && <div className="muted small">No skills in the library yet. <Link href="/skills">Create one on the Skills page →</Link></div>}
        {skills.map((s) => (
          <div key={s.id} className="tool-status-row">
            <input type="checkbox" id={`skill-${s.id}`} checked={skillIds.includes(s.id)}
              onChange={() => setSkillIds((prev) => prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id])} />
            <label htmlFor={`skill-${s.id}`} style={{ margin: 0, fontWeight: 400 }}>
              {s.name} <span className="muted small">{s.description}</span>
            </label>
          </div>
        ))}
      </div>

      {/* ============ Working Directory ============ */}
      <div className="field">
        <label>Working Directory</label>
        <div className="hint" style={{ marginBottom: 8 }}>
          The folder this agent works in when running shell commands or accessing files.
          Defaults to the first allowed folder in Settings if not set.
          {!agentId && (
            <span style={{ display: "block", marginTop: 4, color: "var(--warning)" }}>
              Save the agent first, then set a working directory.
            </span>
          )}
        </div>
        <FolderPicker
          value={workingDir}
          onChange={handleWorkingDirChange}
          placeholder="📂 Select folder…"
          disabled={!agentId}
        />
      </div>

      <div className="row">
        <button className="btn btn-primary" onClick={save} disabled={saving} data-loading={saving}>
          {saving && <span className="spinner" />} Save
        </button>
        <button className="btn" onClick={() => router.push("/")}>Cancel</button>
      </div>
    </div>
  );
}
