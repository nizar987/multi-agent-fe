"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import AgentAvatar from "@/components/AgentAvatar";
import ApprovalCard, { ApprovalItem } from "@/components/ApprovalCard";
import AskUserCard, { AskItem } from "@/components/AskUserCard";
import PreviewPanel from "@/components/PreviewPanel";
import { detectTargets, type PreviewTarget } from "@/lib/preview-detect";
import ModeSelect, { RunMode } from "@/components/ModeSelect";
import PanelIcon from "@/components/PanelIcon";
import AttachmentBar from "@/components/AttachmentBar";
import { PickedAttachment, toWire, parseStoredMessage, stripAttachTag } from "@/components/attachments-client";
import ManagerRun from "@/components/ManagerRun";
import ConnectorModal from "@/components/ConnectorModal";
import ModelSelect from "@/components/ModelSelect";
import MessageBody, { ThinkingIndicator, ToolProgress } from "@/components/MessageBody";

type WsMode = "parallel" | "manager";

type WsSession = { id: number; title: string; created_at: string };

type AgentResp = {
  text: string;
  tools: { tool: string; done: boolean; ok?: boolean }[];
  approvals: ApprovalItem[];
  asks: AskItem[];
  notices: string[];
  done: boolean;
  error?: string;
};
type RoundAtt = { name: string; kind: string; previewUrl?: string };
type Round = { user: string; atts?: RoundAtt[]; responses: Record<number, AgentResp> };

const emptyResp = (): AgentResp => ({ text: "", tools: [], approvals: [], asks: [], notices: [], done: false });

export default function WorkspacePage() {
  const [agents, setAgents] = useState<any[]>([]);
  const [agentsLoaded, setAgentsLoaded] = useState(false);
  const [active, setActive] = useState<number[]>([]); // agents added to the workspace (ordered)
  const [rounds, setRounds] = useState<Round[]>([]);
  const [working, setWorking] = useState<Set<number>>(new Set());
  const abortControllers = useRef<Map<number, AbortController>>(new Map());
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [needsKey, setNeedsKey] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null);
  const [mode, setMode] = useState<RunMode>("approval");
  const [planReady, setPlanReady] = useState(false); // plan drafted → show the proceed button
  const [attachments, setAttachments] = useState<PickedAttachment[]>([]);
  const [wsMode, setWsMode] = useState<WsMode>("parallel");
  const [managerTaskIds, setManagerTaskIds] = useState<number[]>([]);
  const [connectorOpen, setConnectorOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [model, setModel] = useState("");
  const [sessions, setSessions] = useState<WsSession[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [selReply, setSelReply] = useState<{ x: number; y: number; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Load agents + settings + sessions in parallel, then restore the latest session
    // AFTER agents are available so agentById() works correctly during reconstruction.
    Promise.all([
      fetch("/api/agents").then((r) => r.json()),
      fetch("/api/settings").then((r) => r.json()),
      fetch("/api/workspace/sessions").then((r) => r.json()),
    ]).then(async ([agentList, settings, ss]: [any[], any, WsSession[]]) => {
      if (cancelled) return;
      setAgents(agentList);
      setAgentsLoaded(true);
      setNeedsKey(!settings.secrets?.aiApiKey?.set);

      if (ss.length > 0) {
        setSessions(ss);
        // Pass agentList directly so reconstruction doesn't depend on stale state
        await loadSessionWithAgents(ss[0].id, agentList);
      } else {
        // No sessions yet — create one
        const r = await fetch("/api/workspace/sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "New session" }),
        }).then((r) => r.json());
        if (cancelled) return;
        setSessions([{ id: r.id, title: r.title, created_at: new Date().toISOString() }]);
        setSessionId(r.id);
        setRounds([]);
        setActive([]);
      }
    });
    return () => { cancelled = true; };
  }, []);

  /** Create a blank session and select it immediately. */
  const createFreshSession = async () => {
    const r = await fetch("/api/workspace/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "New session" }),
    }).then((r) => r.json());
    setSessions((p) => [{ id: r.id, title: r.title, created_at: new Date().toISOString() }, ...p]);
    setSessionId(r.id);
    setRounds([]);
    setActive([]);
  };

  /**
   * Core reconstruction logic. Accepts agentList explicitly so it can be
   * called before React state for `agents` has been committed (e.g. on
   * initial mount where Promise.all resolves before the first render cycle).
   */
  const loadSessionWithAgents = async (sid: number, agentList: any[]) => {
    setSessionId(sid);
    const data = await fetch(`/api/workspace/sessions/${sid}`).then((r) => r.json());

    // Messages are now sorted by global id ASC from the backend,
    // so we can walk them in order and reconstruct rounds faithfully.
    //
    // Strategy:
    //   - Each time we see a user message for an agent that has NO pending
    //     user message in the current open round, we use the current round
    //     (or open a new one if the content differs from the last round's user text).
    //   - Assistant messages are attached to the most recent round that
    //     still has no assistant reply for that agent.
    const rs: Round[] = [];
    // Track which round index is "open" for each agent (waiting for assistant reply)
    const openRoundForAgent: Record<number, number> = {};

    for (const m of (data.messages ?? [])) {
      const agentId = m.agent_id as number;
      if (m.role === "user") {
        // Find an existing open round with the same user text, or create one
        const last = rs[rs.length - 1];
        if (!last || last.user !== m.content || last.responses[agentId] !== undefined) {
          // Need a new round — but first check if there's already a round
          // for this exact user text that doesn't have this agent yet
          const existingIdx = rs.findLastIndex(
            (r) => r.user === m.content && r.responses[agentId] === undefined
          );
          if (existingIdx >= 0) {
            openRoundForAgent[agentId] = existingIdx;
          } else {
            // Rebuild attachment chips/thumbnails from the stored message.
            const { atts } = parseStoredMessage(m.content, m.meta);
            rs.push({ user: m.content, atts: atts.length ? atts : undefined, responses: {} });
            openRoundForAgent[agentId] = rs.length - 1;
          }
        } else {
          openRoundForAgent[agentId] = rs.length - 1;
        }
        // Pre-seed empty response slot so the agent appears in the round
        rs[openRoundForAgent[agentId]].responses[agentId] = emptyResp();
      } else if (m.role === "assistant") {
        const idx = openRoundForAgent[agentId];
        if (idx !== undefined && rs[idx]) {
          rs[idx].responses[agentId] = { ...emptyResp(), text: m.content, done: true };
        }
      }
    }

    setRounds(rs);

    // Restore active agents from the session (use agentList param, not stale state)
    const sessionAgentIds: number[] = data.agents ?? [];
    if (sessionAgentIds.length > 0) {
      // Only keep agents that still exist
      const validIds = sessionAgentIds.filter((id) => agentList.some((a) => a.id === id));
      setActive(validIds.length > 0 ? validIds : []);
    } else {
      setActive([]);
    }
  };

  /** Public loadSession — uses current `agents` state (safe after initial load). */
  const loadSession = (sid: number) => loadSessionWithAgents(sid, agents);

  const newSession = () => createFreshSession();

  const deleteSession = async (sid: number) => {
    await fetch(`/api/workspace/sessions/${sid}`, { method: "DELETE" });
    setSessions((p) => p.filter((s) => s.id !== sid));
    if (sessionId === sid) {
      // Switch to next available or clear
      const remaining = sessions.filter((s) => s.id !== sid);
      if (remaining.length > 0) loadSession(remaining[0].id);
      else { setSessionId(null); setRounds([]); setActive([]); }
    }
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [rounds, working]);

  // show a floating "Reply" button when text inside a response is highlighted
  useEffect(() => {
    const onMouseUp = (e: MouseEvent) => {
      // ignore mouseup on the reply button itself
      if ((e.target as Element)?.closest?.(".sel-reply-btn")) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) { setSelReply(null); return; }
      const text = sel.toString().trim();
      if (!text) { setSelReply(null); return; }
      const anchor = sel.anchorNode;
      const el = anchor instanceof Element ? anchor : anchor?.parentElement;
      // Show the reply button for any text selected inside the conversation area.
      // Match the scroll container (not just parallel-mode `.ws-turn-body`) so it
      // also works for Manager-mode output and the assignment detail view.
      if (!el?.closest(".chat-scroll")) { setSelReply(null); return; }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      setSelReply({ x: rect.left + rect.width / 2, y: rect.top, text });
    };
    document.addEventListener("mouseup", onMouseUp);
    return () => document.removeEventListener("mouseup", onMouseUp);
  }, []);

  const replyToSelection = () => {
    if (!selReply) return;
    const quoted = selReply.text.split("\n").map((l) => `> ${l}`).join("\n");
    setInput((prev) => (prev.trim() ? `${prev}\n${quoted}\n` : `${quoted}\n`));
    setSelReply(null);
    window.getSelection()?.removeAllRanges();
    inputRef.current?.focus();
  };

  // close the picker on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  /** Persist the current active agent list to the session so it survives reload. */
  const persistAgents = (ids: number[], sid: number | null) => {
    if (!sid) return;
    fetch(`/api/workspace/sessions/${sid}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent_ids: ids }),
    });
  };

  const addAgent = (id: number) => {
    setActive((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      persistAgents(next, sessionId);
      return next;
    });
    setPickerOpen(false);
  };
  const removeAgent = (id: number) => {
    setActive((prev) => {
      const next = prev.filter((x) => x !== id);
      persistAgents(next, sessionId);
      return next;
    });
  };

  /** Cancel a single agent's ongoing SSE stream without removing it from the workspace. */
  const stopAgent = (id: number) => {
    const ctrl = abortControllers.current.get(id);
    if (ctrl) {
      ctrl.abort();
      abortControllers.current.delete(id);
    }
    setWorking((prev) => { const n = new Set(prev); n.delete(id); return n; });
    // Mark the agent's last response as done (stopped by user)
    setRounds((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (!last) return prev;
      const resp = last.responses[id];
      if (resp && !resp.done) {
        next[next.length - 1] = {
          ...last,
          responses: {
            ...last.responses,
            [id]: {
              ...resp,
              done: true,
              notices: [...resp.notices, "⏹ Stopped by user."],
            },
          },
        };
      }
      return next;
    });
    // If all agents done, release busy
    setWorking((prev) => {
      if (prev.size === 0) setBusy(false);
      return prev;
    });
  };

  /** Add every agent of a category to the team in one click. */
  const addCategory = (cat: string) => {
    setActive((prev) => {
      const ids = agents
        .filter((a) => (a.category ?? "").trim() === cat && !prev.includes(a.id))
        .map((a) => a.id);
      if (ids.length === 0) return prev;
      const next = [...prev, ...ids];
      persistAgents(next, sessionId);
      return next;
    });
    setPickerOpen(false);
  };

  const agentById = (id: number) => agents.find((a) => a.id === id);
  const available = agents.filter((a) => !active.includes(a.id));

  /** Available agents grouped by category (uncategorized sorts last). */
  const availableByCategory = (): [string, any[]][] => {
    const map = new Map<string, any[]>();
    for (const a of available) {
      const cat = (a.category ?? "").trim() || "Uncategorized";
      (map.get(cat) ?? map.set(cat, []).get(cat)!).push(a);
    }
    return [...map.entries()].sort(([a], [b]) =>
      a === "Uncategorized" ? 1 : b === "Uncategorized" ? -1 : a.localeCompare(b)
    );
  };

  // collect all agent response text for the preview
  // open preview on explicit link click
  const openPreview = (href: string) => {
    const targets = detectTargets(href);
    if (targets.length > 0) {
      setPreviewTarget(targets[0]);
    } else if (href.startsWith("http://") || href.startsWith("https://")) {
      try {
        const host = new URL(href).hostname.replace(/^www\./, "");
        setPreviewTarget({ kind: "web", url: href, label: host });
      } catch { /* invalid */ }
    } else {
      setPreviewTarget({ kind: "file", path: href, label: href.split("/").pop() || href });
    }
  };

  const sendMessage = async (text: string, runMode: RunMode = mode, atts: PickedAttachment[] = [], sid?: number) => {
    if ((!text && atts.length === 0) || active.length === 0 || busy) return;
    const ids = [...active];
    setPlanReady(false);
    setBusy(true);
    setWorking(new Set(ids));

    const roundUser = atts.length ? `${text}${text ? "\n" : ""}[lampiran: ${atts.map((a) => a.name).join(", ")}]` : text;
    const roundAtts: RoundAtt[] = atts.map((a) => ({ name: a.name, kind: a.kind, previewUrl: a.previewUrl }));
    const round: Round = { user: roundUser, atts: roundAtts.length ? roundAtts : undefined, responses: {} };
    for (const id of ids) round.responses[id] = emptyResp();
    setRounds((p) => [...p, round]);
    const roundIdx = rounds.length;

    const patch = (agentId: number, fn: (r: AgentResp) => AgentResp) =>
      setRounds((prev) => {
        const next = [...prev];
        const r = next[roundIdx];
        if (r) next[roundIdx] = { ...r, responses: { ...r.responses, [agentId]: fn(r.responses[agentId] ?? emptyResp()) } };
        return next;
      });

    // Create one AbortController per agent
    const controllers = new Map<number, AbortController>();
    for (const id of ids) {
      const ctrl = new AbortController();
      controllers.set(id, ctrl);
      abortControllers.current.set(id, ctrl);
    }

    try {
      // Use a combined signal — aborts if ANY agent is stopped (parallel stream shares one response)
      // Individual agent stop is handled by marking done in stopAgent; stream continues for others.
      const res = await fetch("/api/workspace/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, agentIds: ids, mode: runMode, attachments: atts.map(toWire), model: model || undefined, sessionId: sid ?? sessionId ?? undefined }),
      });
      if (res.status === 428) { setNeedsKey(true); setBusy(false); setWorking(new Set()); return; }
      if (!res.ok || !res.body) throw new Error(await res.text());

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      // Parse a single SSE block (between two \n\n separators) following the
      // SSE spec: a block may contain multiple lines; only "data:" lines carry
      // payload. Returns null when no parseable JSON is found.
      const parseSSEBlock = (block: string): any | null => {
        for (const line of block.split("\n")) {
          const trimmed = line.trimEnd();
          if (!trimmed.startsWith("data:")) continue;
          // "data:" with optional single space after colon (SSE spec §9.2.6)
          const payload = trimmed.slice(5).replace(/^ /, "").trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            return JSON.parse(payload);
          } catch (e) {
            // Log the raw payload so we can diagnose future issues without
            // crashing the SSE loop; position 237 errors come from here.
            console.warn("[SSE] JSON parse failed — raw payload:", payload.slice(0, 300), e);
          }
        }
        return null;
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const ev = parseSSEBlock(part);
          if (ev === null) continue;
          const id = ev.agentId as number;
          if (ev.type === "text") patch(id, (r) => ({ ...r, text: ev.text }));
          else if (ev.type === "tool_call") patch(id, (r) => ev.tool === "run_shell" ? r : ({ ...r, tools: [...r.tools, { tool: ev.tool, done: false }] }));
          else if (ev.type === "approval_request") patch(id, (r) => ({ ...r, approvals: [...r.approvals, { id: ev.id, approvalKind: ev.kind, detail: ev.detail, state: "pending" }] }));
          else if (ev.type === "approval_resolved") patch(id, (r) => ({
            ...r,
            approvals: r.approvals.map((s) => s.id === ev.id && s.state === "pending" ? { ...s, state: ev.approved ? "approved" : "rejected" } : s),
          }));
          else if (ev.type === "ask_user") patch(id, (r) => ({ ...r, asks: [...r.asks, { id: ev.id, question: ev.question, options: ev.options ?? [], state: "pending" }] }));
          else if (ev.type === "ask_resolved") patch(id, (r) => ({
            ...r,
            asks: r.asks.map((a) => a.id === ev.id && a.state === "pending" ? { ...a, state: "answered", answer: ev.answer } : a),
          }));
          else if (ev.type === "tool_result") patch(id, (r) => {
            const tools = [...r.tools];
            for (let i = tools.length - 1; i >= 0; i--) {
              if (tools[i].tool === ev.tool && !tools[i].done) { tools[i] = { ...tools[i], done: true, ok: ev.ok }; break; }
            }
            return { ...r, tools };
          });
          else if (ev.type === "system_notice") patch(id, (r) => ({ ...r, notices: [...r.notices, ev.text] }));
          else if (ev.type === "done") {
            // Skip if already stopped by user
            setRounds((prev) => {
              const last = prev[prev.length - 1];
              if (last?.responses[id]?.done) return prev; // already stopped
              return prev; // will be patched below
            });
            patch(id, (r) => {
              if (r.done) return r; // already stopped by user
              return {
                ...r,
                done: true,
                notices: r.text.trim() || r.error
                  ? r.notices
                  : [...r.notices, "⚠ The model returned an empty answer — check the Logs page for details."],
              };
            });
            abortControllers.current.delete(id);
            setWorking((prev) => { const n = new Set(prev); n.delete(id); return n; });
          } else if (ev.type === "error") {
            patch(id, (r) => r.done ? r : { ...r, done: true, error: ev.message });
            abortControllers.current.delete(id);
            setWorking((prev) => { const n = new Set(prev); n.delete(id); return n; });
          }
        }
      }
      if (runMode === "plan") setPlanReady(true);
    } catch (e: any) {
      // AbortError = user stopped, not a real error
      if ((e as Error).name !== "AbortError") {
        for (const id of ids) patch(id, (r) => r.done ? r : { ...r, done: true, error: e.message });
      }
    } finally {
      for (const id of ids) abortControllers.current.delete(id);
      // Only release busy if all agents are done
      setWorking((prev) => {
        if (prev.size === 0) setBusy(false);
        return prev;
      });
      setBusy(false);
      setWorking(new Set());
    }
  };

  // Manager mode: the picked agents become the manager's team for one task.
  const startManagerTask = async (text: string, atts: PickedAttachment[] = []) => {
    if (!text || active.length === 0 || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/manager/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          original_request: text,
          agent_ids: active,
          model: model || undefined,
          attachments: atts.map(toWire),
        }),
      });
      if (res.status === 428) { setNeedsKey(true); return; }
      const data = await res.json();
      if (res.ok && data.id) setManagerTaskIds((p) => [...p, data.id]);
    } finally {
      setBusy(false);
    }
  };

  const retryRound = (roundIdx: number) => {
    const round = rounds[roundIdx];
    if (!round || busy) return;
    // Remove this round and all subsequent rounds, then re-send
    setRounds((prev) => prev.slice(0, roundIdx));
    // Extract original text (strip attachment annotation if present)
    const originalText = round.user.replace(/\n?\[lampiran:.*\]$/, "").trim();
    sendMessage(originalText, mode, [], sessionId ?? undefined);
  };

  const pickFiles = async (files: FileList | null) => {
    if (!files) return;
    const { readFileToAttachment } = await import("@/components/attachments-client");
    const added: PickedAttachment[] = [];
    for (const f of Array.from(files)) {
      const res = await readFileToAttachment(f);
      if ("error" in res) alert(res.error);
      else added.push(res);
    }
    if (added.length) setAttachments((prev) => [...prev, ...added]);
  };

  const send = () => {
    const text = input.trim();
    if (!text && attachments.length === 0) return;
    if (wsMode === "manager") {
      if (!text) return;
      const atts = attachments;
      setInput("");
      setAttachments([]);
      startManagerTask(text, atts);
      return;
    }
    const atts = attachments;
    setInput("");
    setAttachments([]);

    // If this is the first message, update session title from the question
    if (sessionId && rounds.length === 0) {
      const title = text.length > 60 ? text.slice(0, 57) + "…" : text;
      fetch("/api/workspace/sessions", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: sessionId, title }),
      });
      setSessions((p) => p.map((s) => s.id === sessionId ? { ...s, title } : s));
    }

    sendMessage(text, mode, atts);
  };

  const proceedPlan = () => {
    setMode("approval");
    sendMessage("Proceed: execute the plan you drafted above, step by step.", "approval");
  };

  const answerAsk = async (id: string, answer: string) => {
    await fetch("/api/ask/answer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, answer }),
    });
    // card state is updated by the ask_resolved event from the server
  };

  const decideApproval = async (approvalId: string, decision: "always" | "once" | "deny") => {
    await fetch("/api/shell/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: approvalId, decision }),
    });
  };

  const clearWs = async () => {
    if (!confirm("Clear the entire workspace history?")) return;
    if (sessionId) {
      await fetch(`/api/workspace/history?sessionId=${sessionId}`, { method: "DELETE" });
      setSessions((p) => p.filter((s) => s.id !== sessionId));
      setSessionId(null);
    } else {
      await fetch("/api/workspace/history", { method: "DELETE" });
    }
    setRounds([]);
  };

  if (needsKey) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
        <div className="card" style={{ maxWidth: 400, textAlign: "center", padding: 32 }}>
          <div style={{ fontSize: 28, marginBottom: 12 }}>◆</div>
          <h2>Connect an AI model first</h2>
          <p className="muted">The workspace needs an AI API key to run agents.</p>
          <Link href="/connections" className="btn btn-primary">Open Connections → AI Provider</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", height: "calc(100vh - 64px)", margin: -32, overflow: "hidden" }}>
      {/* sessions history sidebar */}
      {historyCollapsed ? (
        <div className="ws-sessions-collapsed" onClick={() => setHistoryCollapsed(false)} title="Show history">
          <span style={{ writingMode: "vertical-rl", fontSize: 12, color: "var(--text-tertiary)" }}>📋 History</span>
        </div>
      ) : (
        <div className="ws-sessions-sidebar">
          <div className="ws-sessions-header">
            <span className="ws-sessions-title">History</span>
            <div style={{ display: "flex", gap: 4 }}>
              <button className="btn ws-sessions-new" onClick={newSession} title="New session">+</button>
              <button className="btn ws-sessions-new" onClick={() => setHistoryCollapsed(true)} title="Hide history">◀</button>
            </div>
          </div>
          <div className="ws-sessions-list">
            {sessions.length === 0 && (
              <div className="ws-sessions-empty">No sessions yet</div>
            )}
            {sessions.map((s) => (
              <div
                key={s.id}
                className={`ws-session-item${sessionId === s.id ? " active" : ""}`}
                onClick={() => !busy && loadSession(s.id)}
              >
                <span className="ws-session-label">{s.title}</span>
                <button
                  className="ws-session-del"
                  onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                  title="Delete session"
                >×</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* kolom chat */}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
      <div className="chat-header">
        <div className="chat-header-row" style={{ flexWrap: "wrap", gap: 10 }}>
          <strong>Workspace</strong>
          <div className="ws-mode-toggle">
            <button className={wsMode === "parallel" ? "active" : ""} onClick={() => setWsMode("parallel")}>Parallel</button>
            <button className={wsMode === "manager" ? "active" : ""} onClick={() => setWsMode("manager")}>Manager</button>
          </div>
          <span className="muted small">
            {wsMode === "manager"
              ? "the manager plans, delegates to your picked agents, reviews & reports"
              : "add the agents that should work — they run in parallel"}
          </span>
          <span style={{ flex: 1 }} />
          <button
            className={`btn btn-icon${previewTarget ? " active" : ""}`}
            onClick={() => setPreviewTarget(null)}
            title={previewTarget ? "Close preview panel" : "No preview open"}
            disabled={!previewTarget}
          ><PanelIcon /></button>
        </div>
      </div>

      {/* bar agent aktif + tombol Add */}
      <div className="ws-agentbar">
      <div className="ws-agentbar-top">
        <div className="ws-agent-chips">
          {active.map((id) => {
            const a = agentById(id);
            const isWorking = working.has(id);
            return (
              <div key={id} className="ws-chip-wrapper">
                {/* working bubble shown above the chip */}
                {isWorking && (
                  <div className="ws-chip-bubble">
                    <span className="dot dot-blue pulse-dot" style={{ width: 6, height: 6 }} />
                    working…
                  </div>
                )}
                <span className={`ws-chip selected${isWorking ? " working" : ""}`} title={a?.description}>
                  <AgentAvatar avatar={a?.avatar} color={a?.color} size={22} working={isWorking} />
                  {a?.name ?? `Agent #${id}`}
                  {isWorking ? (
                    <button
                      className="ws-chip-stop"
                      onClick={() => stopAgent(id)}
                      title={`Stop ${a?.name ?? "agent"}`}
                      aria-label={`Stop ${a?.name ?? "agent"}`}
                    >⏹</button>
                  ) : (
                    <button
                      className="ws-chip-x"
                      onClick={() => !busy && removeAgent(id)}
                      title="Remove from workspace"
                      aria-label={`Remove ${a?.name ?? "agent"} from workspace`}
                    >×</button>
                  )}
                </span>
              </div>
            );
          })}

          <div className="ws-picker" ref={pickerRef}>
            <button
              className="ws-add-btn"
              onClick={() => setPickerOpen((o) => !o)}
              disabled={busy || available.length === 0}
              title={available.length === 0 ? "All agents have been added" : "Add an agent to the workspace"}
            >
              + Add agent
            </button>
            {pickerOpen && (
              <div className="ws-picker-menu">
                {available.length === 0 && <div className="ws-picker-empty">No other agents.</div>}
                {availableByCategory().map(([cat, list]) => (
                  <div key={cat} className="ws-picker-group">
                    <div className="ws-picker-group-head">
                      <span className="ws-picker-group-name">{cat}</span>
                      {cat !== "Uncategorized" && (
                        <button
                          className="ws-picker-addall"
                          onClick={() => addCategory(cat)}
                          title={`Add all ${list.length} agent${list.length > 1 ? "s" : ""} in "${cat}"`}
                        >+ Add all ({list.length})</button>
                      )}
                    </div>
                    {list.map((a) => (
                      <button key={a.id} className="ws-picker-item" onClick={() => addAgent(a.id)}>
                        <AgentAvatar avatar={a.avatar} color={a.color} size={22} />
                        <span className="grow">
                          <div style={{ fontWeight: 500 }}>{a.name}</div>
                          {a.description && <div className="muted small" style={{ marginTop: 1 }}>{a.description}</div>}
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          {agents.length === 0 && (
            <span className="muted small">No agents yet — <Link href="/agents/new">create one first</Link>.</span>
          )}
        </div>
        </div>
      </div>

      <div
        className={`chat-scroll${(wsMode === "manager" ? managerTaskIds.length === 0 : rounds.length === 0) ? " chat-scroll--empty" : ""}`}
        ref={scrollRef}
        onScroll={() => setSelReply(null)}
      >
        {/* ---------- Manager mode ---------- */}
        {wsMode === "manager" && (
          <>
            {active.length === 0 && managerTaskIds.length === 0 && (
              <div className="empty-state">
                <div className="glyph">🧭</div>
                Pick the agents this task needs via <strong>+ Add agent</strong>,
                then describe the task. The manager plans it across your team.
              </div>
            )}
            {active.length > 0 && managerTaskIds.length === 0 && (
              <div className="empty-state">
                <div className="glyph">🧭</div>
                Team ready ({active.length} agent{active.length > 1 ? "s" : ""}). Describe the task below —
                the manager will delegate, review, and report back.
              </div>
            )}
            {managerTaskIds.map((tid) => (
              <ManagerRun key={tid} taskId={tid} agents={agents} />
            ))}
          </>
        )}

        {/* ---------- Parallel mode ---------- */}
        {wsMode === "parallel" && active.length === 0 && rounds.length === 0 && (
          <div className="empty-state">
            <div className="glyph">🧩</div>
            Add one or more agents via <strong>+ Add agent</strong>,
            then send a single message for them to work on together.
          </div>
        )}
        {wsMode === "parallel" && active.length > 0 && rounds.length === 0 && (
          <div className="empty-state">
            <div className="glyph">💬</div>
            {active.length} agent{active.length > 1 ? "s" : ""} ready. Send your first message below.
          </div>
        )}

        {wsMode === "parallel" && rounds.map((round, ri) => (
          <div key={ri} className="ws-round">
            <div className="msg user">
              <div className="msg-role">You</div>
              <div className="msg-body">{round.atts?.length ? stripAttachTag(round.user) : round.user}</div>
              {round.atts && round.atts.length > 0 && (
                <div className="msg-attachments">
                  {round.atts.map((a, k) => a.previewUrl
                    ? <img key={k} src={a.previewUrl} alt={a.name} title={a.name} />
                    : <span key={k} className="attach-chip"><span>{a.kind === "document" ? "📄" : "📝"}</span><span className="attach-name">{a.name}</span></span>)}
                </div>
              )}
              <div className="msg-actions">
                <button
                  className="msg-retry-btn"
                  onClick={() => retryRound(ri)}
                  disabled={busy}
                  title="Retry this message"
                  aria-label="Retry"
                >↺ Retry</button>
              </div>
            </div>
            <div className="ws-thread">
              {Object.entries(round.responses).map(([idStr, resp]) => {
                const id = Number(idStr);
                const a = agentById(id);
                const isWorking = working.has(id) && ri === rounds.length - 1;
                return (
                  <div key={id} className="ws-turn">
                    <div className="ws-turn-avatar">
                      <AgentAvatar avatar={a?.avatar} color={a?.color} size={30} working={isWorking} />
                    </div>
                    <div className="ws-turn-body">
                      <div className="ws-turn-head">
                        <span className="ws-turn-name">{a?.name ?? `Agent #${id}`}</span>
                        {isWorking && <span className="tag">working…</span>}
                        {resp.done && !resp.error && <span style={{ color: "var(--success)" }}>✓</span>}
                      </div>
                      {resp.notices.map((n, i) => <div key={i} className="msg-system-inline" style={{ margin: "4px 0" }}>{n}</div>)}
                      {resp.approvals.map((s) => (
                        <div key={s.id} style={{ margin: "6px 0" }}>
                          <ApprovalCard item={s} onDecide={decideApproval} />
                        </div>
                      ))}
                      {resp.asks.map((a) => (
                        <div key={a.id} style={{ margin: "6px 0" }}>
                          <AskUserCard item={a} onAnswer={answerAsk} />
                        </div>
                      ))}
                      <ToolProgress tools={resp.tools} />
                      {resp.error
                        ? <MessageBody text={resp.error} isError />
                        : resp.text
                          ? <MessageBody text={resp.text} onOpenPreview={openPreview} />
                          : isWorking && <ThinkingIndicator tool={resp.tools.find(t => !t.done)?.tool} />}
                      {resp.done && (
                        <div className="msg-actions">
                          <button
                            className="msg-retry-btn"
                            onClick={() => retryRound(ri)}
                            disabled={busy}
                            title="Retry — resend this message"
                            aria-label="Retry"
                          >↺ Retry</button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="chat-input-bar">
        <div className="chat-input-inner">
          <textarea
            ref={inputRef}
            className="input"
            rows={2}
            placeholder={
              active.length === 0
                ? (wsMode === "manager" ? "Pick your team first via + Add agent…" : "Add an agent first to get started…")
                : wsMode === "manager"
                  ? `Describe the task for the manager to run across ${active.length} agent${active.length > 1 ? "s" : ""}… (Enter to send)`
                  : `Send to ${active.length} agent${active.length > 1 ? "s" : ""} at once… (Enter to send)`
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            disabled={active.length === 0}
          />
          <button
            className="btn btn-primary"
            onClick={send}
            disabled={busy || active.length === 0 || (wsMode === "manager" ? !input.trim() : (!input.trim() && attachments.length === 0))}
          >
            {wsMode === "manager" ? "Start task" : "Send"}
          </button>
        </div>
        <div className="chat-input-footer">
          <AttachmentBar attachments={attachments} onChange={setAttachments} disabled={busy || active.length === 0} />
          {wsMode === "parallel" ? (
            <ModeSelect value={mode} onChange={setMode} showProceed={planReady && !busy} onProceed={proceedPlan} />
          ) : (
            <span className="muted small">Manager runs each agent plan-first, then act. SQL stays read-only.</span>
          )}
          <ModelSelect
            value={model}
            onChange={setModel}
            defaultLabel={wsMode === "manager" ? "Agents' default" : "Agent default"}
            title={wsMode === "manager" ? "Model for the manager & its agents" : "Model for this run"}
            style={{ width: 180, flex: "none", marginLeft: "auto" }}
          />
        </div>
        <div className="chat-input-actions">
          <div className="chat-input-action-left">
            <button className="btn btn-sm btn-connector" onClick={() => setConnectorOpen(true)} title="Add or switch connections">🔗 Connector</button>
            <button
              className="btn btn-sm btn-upload"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy || active.length === 0}
              title="Upload file (PDF, teks, kode)"
            >📎 File</button>
            <button
              className="btn btn-sm btn-upload"
              onClick={() => photoInputRef.current?.click()}
              disabled={busy || active.length === 0}
              title="Upload foto / gambar"
            >🖼 Foto</button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="application/pdf,text/*,.md,.csv,.json,.yaml,.yml,.js,.ts,.tsx,.py,.go,.rs,.java,.sql,.sh,.html,.css"
              style={{ display: "none" }}
              onChange={(e) => pickFiles(e.target.files)}
            />
            <input
              ref={photoInputRef}
              type="file"
              multiple
              accept="image/png,image/jpeg,image/gif,image/webp"
              style={{ display: "none" }}
              onChange={(e) => pickFiles(e.target.files)}
            />
          </div>
          <div className="chat-input-action-right">
            {rounds.length > 0 && (
              <button className="btn btn-sm btn-ghost-danger" onClick={clearWs} title="Clear workspace history">🧹 Clear</button>
            )}
          </div>
        </div>
      </div>
      </div>

      {/* floating reply-to-selection button */}
      {selReply && (
        <button
          className="sel-reply-btn"
          style={{ left: selReply.x, top: selReply.y }}
          onMouseDown={(e) => { e.preventDefault(); replyToSelection(); }}
        >↩ Reply</button>
      )}

      {/* panel preview */}
      <PreviewPanel target={previewTarget} onClose={() => setPreviewTarget(null)} />

      <ConnectorModal open={connectorOpen} onClose={() => setConnectorOpen(false)} />
    </div>
  );
}
