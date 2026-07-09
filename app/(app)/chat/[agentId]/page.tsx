"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import AgentAvatar from "@/components/AgentAvatar";
import ApprovalCard, { ApprovalItem } from "@/components/ApprovalCard";
import AskUserCard, { AskItem } from "@/components/AskUserCard";
import PreviewPanel from "@/components/PreviewPanel";
import { detectTargets, type PreviewTarget } from "@/lib/preview-detect";
import ModeSelect, { RunMode } from "@/components/ModeSelect";
import PanelIcon from "@/components/PanelIcon";
import AttachmentBar from "@/components/AttachmentBar";
import ConnectorModal from "@/components/ConnectorModal";
import ModelSelect from "@/components/ModelSelect";
import MessageBody, { ThinkingIndicator, ToolProgress } from "@/components/MessageBody";
import { PickedAttachment, toWire, parseStoredMessage } from "@/components/attachments-client";

type MsgAttachment = { name: string; kind: string; previewUrl?: string };

type ChatItem =
  | { kind: "msg"; role: "user" | "assistant"; content: string; atts?: MsgAttachment[] }
  | { kind: "tool"; tool: string; done: boolean; ok?: boolean }
  | { kind: "notice"; text: string }
  | ({ kind: "approval" } & ApprovalItem)
  | ({ kind: "ask" } & AskItem)
  | { kind: "delegate"; agent: string; done: boolean };

export default function ChatPage({ params }: { params: { agentId: string } }) {
  const agentId = params.agentId;
  const [agent, setAgent] = useState<any>(null);
  const [convs, setConvs] = useState<any[]>([]);
  const [convId, setConvId] = useState<number | null>(null);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [needsKey, setNeedsKey] = useState(false);
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null);
  const [mode, setMode] = useState<RunMode>("approval");
  const [planReady, setPlanReady] = useState(false); // plan drafted → show the proceed button
  const [attachments, setAttachments] = useState<PickedAttachment[]>([]);
  const [connectorOpen, setConnectorOpen] = useState(false);
  const [descOpen, setDescOpen] = useState(false);
  const [model, setModel] = useState("");
  const [workingDir, setWorkingDir] = useState<string | null>(null);
  const [pickingFolder, setPickingFolder] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // open a URL or file path in the preview panel — called by link clicks in MessageBody
  const openPreview = (href: string) => {
    const targets = detectTargets(href);
    if (targets.length > 0) {
      setPreviewTarget(targets[0]);
    } else {
      // plain string that wasn't detected as URL/path — treat as web URL if it looks like one
      if (href.startsWith("http://") || href.startsWith("https://")) {
        try {
          const host = new URL(href).hostname.replace(/^www\./, "");
          setPreviewTarget({ kind: "web", url: href, label: host });
        } catch { /* invalid url, ignore */ }
      } else {
        setPreviewTarget({ kind: "file", path: href, label: href.split("/").pop() || href });
      }
    }
  };

  useEffect(() => {
    fetch(`/api/agents/${agentId}`).then((r) => r.json()).then((a) => {
      setAgent(a);
      setWorkingDir(a.working_dir ?? null);
    });
    fetch("/api/settings").then((r) => r.json()).then((s) => setNeedsKey(!s.secrets.aiApiKey.set));
    loadConvs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  const loadConvs = async () => {
    const cs = await fetch(`/api/agents/${agentId}/conversations`).then((r) => r.json());
    setConvs(cs);
    if (cs.length > 0) selectConv(cs[0].id);
    else newConv();
  };

  const selectConv = async (id: number) => {
    setConvId(id);
    const msgs = await fetch(`/api/conversations/${id}/messages`).then((r) => r.json());
    setItems(msgs.filter((m: any) => m.role === "user" || m.role === "assistant")
      .map((m: any) => {
        if (m.role === "user") {
          // Rebuild attachment chips/thumbnails from the stored message.
          const { text, atts } = parseStoredMessage(m.content, m.meta);
          return { kind: "msg", role: "user", content: text, atts: atts.length ? atts : undefined };
        }
        return { kind: "msg", role: "assistant", content: m.content };
      }));
  };

  const newConv = useCallback(async () => {
    const r = await fetch(`/api/agents/${agentId}/conversations`, { method: "POST" }).then((r) => r.json());
    setConvId(r.id);
    setItems([]);
    fetch(`/api/agents/${agentId}/conversations`).then((r) => r.json()).then(setConvs);
  }, [agentId]);

  const deleteConv = async () => {
    if (!convId || busy) return;
    const conv = convs.find((c) => c.id === convId);
    if (!confirm(`Delete conversation "${conv?.title ?? convId}"? This cannot be undone.`)) return;
    await fetch(`/api/conversations/${convId}`, { method: "DELETE" });
    const remaining = convs.filter((c) => c.id !== convId);
    setConvs(remaining);
    if (remaining.length > 0) selectConv(remaining[0].id);
    else newConv();
  };

  // Cmd/Ctrl+N → new conversation
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "n") { e.preventDefault(); newConv(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [newConv]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [items, busy]);

  const sendMessage = async (text: string, runMode: RunMode = mode, atts: PickedAttachment[] = []) => {
    if ((!text && atts.length === 0) || !convId || busy) return;
    setPlanReady(false);
    const msgAtts: MsgAttachment[] = atts.map((a) => ({ name: a.name, kind: a.kind, previewUrl: a.previewUrl }));
    setItems((p) => [...p, { kind: "msg", role: "user", content: text, atts: msgAtts.length ? msgAtts : undefined }]);
    setBusy(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId: convId, message: text, mode: runMode, attachments: atts.map(toWire), model: model || undefined }),
      });
      if (res.status === 428) { setNeedsKey(true); setBusy(false); return; }
      if (!res.ok || !res.body) throw new Error(await res.text());

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let assistantIdx = -1;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          const ev = JSON.parse(part.slice(6));
          setItems((prev) => {
            const next = [...prev];
            if (ev.type === "text") {
              if (assistantIdx >= 0 && next[assistantIdx]?.kind === "msg") {
                (next[assistantIdx] as any).content = ev.text;
              } else {
                next.push({ kind: "msg", role: "assistant", content: ev.text });
                assistantIdx = next.length - 1;
              }
            } else if (ev.type === "tool_call") {
              // run_shell is shown via the approval card, not the generic indicator
              if (ev.tool !== "run_shell") next.push({ kind: "tool", tool: ev.tool, done: false });
              assistantIdx = -1;
            } else if (ev.type === "tool_result") {
              for (let i = next.length - 1; i >= 0; i--) {
                const it = next[i];
                if (it.kind === "tool" && it.tool === ev.tool && !it.done) {
                  next[i] = { ...it, done: true, ok: ev.ok };
                  break;
                }
              }
            } else if (ev.type === "approval_request") {
              next.push({ kind: "approval", id: ev.id, approvalKind: ev.kind, detail: ev.detail, state: "pending" });
              assistantIdx = -1;
            } else if (ev.type === "approval_resolved") {
              for (let i = next.length - 1; i >= 0; i--) {
                const it = next[i];
                if (it.kind === "approval" && it.id === ev.id && it.state === "pending") {
                  next[i] = { ...it, state: ev.approved ? "approved" : "rejected" };
                  break;
                }
              }
            } else if (ev.type === "ask_user") {
              next.push({ kind: "ask", id: ev.id, question: ev.question, options: ev.options ?? [], state: "pending" });
              assistantIdx = -1;
            } else if (ev.type === "ask_resolved") {
              for (let i = next.length - 1; i >= 0; i--) {
                const it = next[i];
                if (it.kind === "ask" && it.id === ev.id && it.state === "pending") {
                  next[i] = { ...it, state: "answered", answer: ev.answer };
                  break;
                }
              }
            } else if (ev.type === "system_notice") {
              next.push({ kind: "notice", text: ev.text });
            } else if (ev.type === "delegate_start") {
              next.push({ kind: "delegate", agent: ev.agent, done: false });
              assistantIdx = -1;
            } else if (ev.type === "delegate_end") {
              for (let i = next.length - 1; i >= 0; i--) {
                const it = next[i];
                if (it.kind === "delegate" && it.agent === ev.agent && !it.done) {
                  next[i] = { ...it, done: true };
                  break;
                }
              }
            } else if (ev.type === "done") {
              // Never end silently: if no assistant text arrived, say so.
              const hasReply = next.some((it) => it.kind === "msg" && it.role === "assistant" && it.content);
              if (!hasReply && !String(ev.finalText ?? "").trim()) {
                next.push({ kind: "notice", text: "⚠ The model returned an empty answer — check the Logs page for details (provider/model may have rejected the request)." });
              }
            } else if (ev.type === "error") {
              next.push({ kind: "notice", text: `Error: ${ev.message}` });
            }
            return next;
          });
        }
      }
      if (runMode === "plan") setPlanReady(true);
    } catch (e: any) {
      setItems((p) => [...p, { kind: "notice", text: `Error: ${e.message}` }]);
    } finally {
      setBusy(false);
    }
  };

  const send = () => {
    const text = input.trim();
    if (!text && attachments.length === 0) return;
    const atts = attachments;
    setInput("");
    setAttachments([]);
    sendMessage(text, mode, atts);
  };

  const proceedPlan = () => {
    setMode("approval");
    sendMessage("Proceed: execute the plan you drafted above, step by step.", "approval");
  };

  const pickFolder = async () => {
    setPickingFolder(true);
    try {
      const res = await fetch(`/api/agents/${agentId}/pick-folder`, { method: "POST" });
      const data = await res.json();
      if (!data.canceled && data.folder) setWorkingDir(data.folder);
    } catch {
      // ignore
    } finally {
      setPickingFolder(false);
    }
  };

  const clearFolder = async () => {
    await fetch(`/api/agents/${agentId}/pick-folder`, { method: "DELETE" });
    setWorkingDir(null);
  };

  const clearChat = () => {
    if (items.length === 0) return;
    if (!confirm("Clear all messages in this conversation?")) return;
    setItems([]);
  };

  const answerAsk = async (id: string, answer: string) => {
    await fetch("/api/ask/answer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, answer }),
    });
    // card state is updated by the ask_resolved event from the server
  };

  const decideApproval = async (id: string, decision: "always" | "once" | "deny") => {
    await fetch("/api/shell/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, decision }),
    });
    // card state is updated by the approval_resolved event from the server
  };

  if (needsKey) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
        <div className="card" style={{ maxWidth: 400, textAlign: "center", padding: 32 }}>
          <div style={{ fontSize: 28, marginBottom: 12 }}>◆</div>
          <h2>Connect an AI model first</h2>
          <p className="muted">Agents need an AI API key to answer. Configuration only takes a minute.</p>
          <Link href="/connections" className="btn btn-primary">Open Connections → AI Provider</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-shell">
      <div className="chat-col">
        <div className="chat-header">
          <div className="chat-header-row">
            <Link href="/" className="chat-back muted" title="Back">←</Link>
            <AgentAvatar avatar={agent?.avatar} color={agent?.color} size={28} working={busy} />
            <div className="chat-header-title">
              <strong>{agent?.name ?? "…"}</strong>
              {agent?.description && (
                <button
                  className="chat-desc-toggle"
                  onClick={() => setDescOpen((v) => !v)}
                  aria-expanded={descOpen}
                  title={descOpen ? "Hide description" : "Show description"}
                >
                  About<span className={`chevron${descOpen ? " open" : ""}`}>⌄</span>
                </button>
              )}
            </div>
            <span style={{ flex: 1 }} />
            <select className="input chat-conv-select" value={convId ?? ""} onChange={(e) => selectConv(Number(e.target.value))}>
              {convs.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
            <button className="btn" onClick={newConv} title="New conversation (Cmd/Ctrl+N)">+ New</button>
            <button
              className="btn btn-danger-ghost"
              onClick={deleteConv}
              disabled={busy || !convId}
              title="Delete this conversation"
              aria-label="Delete conversation"
            >🗑</button>
            <button
              className={`btn btn-icon${previewTarget ? " active" : ""}`}
              onClick={() => setPreviewTarget((v) => v ? null : v)}
              title={previewTarget ? "Close preview panel" : "No preview open"}
              disabled={!previewTarget}
            ><PanelIcon /></button>
          </div>
          {agent?.description && descOpen && (
            <p className="chat-header-desc muted small">{agent.description}</p>
          )}
        </div>

        <div className="chat-scroll" ref={scrollRef}>
          {items.length === 0 && !busy && (
            <div className="empty-state">
              <div className="glyph">💬</div>
              Start a conversation with {agent?.name ?? "the agent"}.
            </div>
          )}
          {items.map((it, i) => {
            if (it.kind === "msg") {
              // Find active tool for this message position
              const nextTool = items[i + 1];
              const activeTool = nextTool?.kind === "tool" && !nextTool.done ? nextTool.tool : undefined;
              return (
                <div key={i} className={`msg ${it.role}`}>
                  <div className="msg-role">{it.role === "user" ? "You" : agent?.name ?? "Agent"}</div>
                  {it.content && (
                    it.role === "user"
                      ? <div className="msg-body">{it.content}</div>
                      : <MessageBody text={it.content} onOpenPreview={openPreview} />
                  )}
                  {it.atts && it.atts.length > 0 && (
                    <div className="msg-attachments">
                      {it.atts.map((a, k) => a.previewUrl
                        ? <img key={k} src={a.previewUrl} alt={a.name} title={a.name} />
                        : <span key={k} className="attach-chip"><span>{a.kind === "document" ? "📄" : "📝"}</span><span className="attach-name">{a.name}</span></span>)}
                    </div>
                  )}
                </div>
              );
            }
            if (it.kind === "tool") {
              return (
                <div key={i} className="msg">
                  <ToolProgress tools={[{ tool: it.tool, done: it.done, ok: it.ok }]} />
                </div>
              );
            }
            if (it.kind === "approval") {
              return (
                <div key={i} className="msg">
                  <ApprovalCard item={it} onDecide={decideApproval} />
                </div>
              );
            }
            if (it.kind === "ask") {
              return (
                <div key={i} className="msg">
                  <AskUserCard item={it} onAnswer={answerAsk} />
                </div>
              );
            }
            if (it.kind === "delegate") {
              return (
                <div key={i} className="msg">
                  <ToolProgress tools={[{ tool: `delegating → ${it.agent}`, done: it.done, ok: it.done }]} />
                </div>
              );
            }
            return <div key={i} className="msg-system-inline">{(it as any).text}</div>;
          })}
          {busy && (
            <div className="msg">
              <ThinkingIndicator />
            </div>
          )}
        </div>

        <div className="chat-input-bar">
          <div className="chat-input-inner">
            <textarea
              className="input"
              rows={2}
              placeholder="Type a message… (Enter to send, Shift+Enter for a new line)"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
              }}
            />
            <button className="btn btn-primary" aria-label="Send message" onClick={send} disabled={busy || (!input.trim() && attachments.length === 0)}>Send</button>
          </div>
          <div className="chat-input-footer">
            <AttachmentBar attachments={attachments} onChange={setAttachments} disabled={busy} />
            <ModeSelect value={mode} onChange={setMode} showProceed={planReady && !busy} onProceed={proceedPlan} />
            <ModelSelect value={model} onChange={setModel} defaultLabel="Agent default" title="Model for this chat" style={{ width: 180, flex: "none", marginLeft: "auto" }} />
          </div>
          <div className="chat-input-actions">
            <div className="chat-input-action-left">
              <button className="btn btn-sm btn-connector" onClick={() => setConnectorOpen(true)} title="Add or switch connections">🔗 Connector</button>
              {/* Working directory widget */}
              <div className="workdir-widget">
                <span className="workdir-icon">📁</span>
                {workingDir ? (
                  <>
                    <span className="workdir-path" title={workingDir}>{workingDir.split("/").pop() || workingDir}</span>
                    <button
                      className="workdir-btn workdir-btn-change"
                      onClick={pickFolder}
                      disabled={pickingFolder || busy}
                      title={`Working dir: ${workingDir} — click to change`}
                    >{pickingFolder ? "…" : "Change"}</button>
                    <button
                      className="workdir-btn workdir-btn-clear"
                      onClick={clearFolder}
                      disabled={busy}
                      title="Remove working directory"
                      aria-label="Remove working directory"
                    >✕</button>
                  </>
                ) : (
                  <button
                    className="workdir-btn workdir-btn-set"
                    onClick={pickFolder}
                    disabled={pickingFolder || busy}
                    title="Set working directory for this agent"
                  >{pickingFolder ? "Opening…" : "Set folder"}</button>
                )}
              </div>
            </div>
            <div className="chat-input-action-right">
              <button className="btn btn-sm btn-ghost-danger" onClick={clearChat} disabled={items.length === 0} title="Clear conversation messages">🧹 Clear</button>
            </div>
          </div>
        </div>
      </div>

      {/* panel preview — only shown when user explicitly clicks a link */}
      <PreviewPanel
        target={previewTarget}
        onClose={() => setPreviewTarget(null)}
      />

      <ConnectorModal open={connectorOpen} onClose={() => setConnectorOpen(false)} />
    </div>
  );
}
