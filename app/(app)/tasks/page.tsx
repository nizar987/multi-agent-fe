"use client";
/**
 * Tasks — kanban board of tickets. Create tickets (form or CSV import), then
 * Execute: open tickets are handed to the Agent Manager, which distributes the
 * work across your agents; the user is redirected to the Workspace manager
 * view to watch the run. Cards can be dragged between Open and Done; the
 * Executing column is driven by the manager run itself.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type TicketPriority = "low" | "medium" | "high";
type TicketStatus = "open" | "executing" | "done" | "failed";

interface Ticket {
  id: number;
  title: string;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  manager_task_id: number | null;
  created_at: string;
  task_status: string | null;
}

const PRIORITY_COLOR: Record<TicketPriority, string> = {
  high: "var(--danger, #e5534b)",
  medium: "var(--accent)",
  low: "var(--text-secondary)",
};

const COLUMNS: Array<{ status: TicketStatus; label: string; hint: string; droppable: boolean }> = [
  { status: "open", label: "Open", hint: "waiting to be executed", droppable: true },
  { status: "executing", label: "Executing", hint: "the manager is working", droppable: false },
  { status: "done", label: "Done", hint: "finished", droppable: true },
  { status: "failed", label: "Failed", hint: "drag back to Open to retry", droppable: false },
];

export default function TasksPage() {
  const router = useRouter();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TicketPriority>("medium");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [dragOver, setDragOver] = useState<TicketStatus | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const hasExecutingRef = useRef<boolean>(false);

  // Keep ref in sync with tickets state so interval can read it without stale closure
  useEffect(() => {
    hasExecutingRef.current = tickets.some((x) => x.status === "executing");
  }, [tickets]);

  const load = useCallback(() =>
    fetch("/api/tickets")
      .then((r) => r.json())
      .then((d: Ticket[]) => {
        setTickets(Array.isArray(d) ? d : []);
        setLoaded(true);
      }),
  []);

  useEffect(() => {
    load();
    // Poll only when there are executing tickets — read via ref to avoid stale closure (MINOR-7 fix)
    const t = setInterval(() => {
      if (hasExecutingRef.current) void load();
    }, 5000);
    return () => clearInterval(t);
  }, [load]);

  const flash = (kind: "error" | "ok", text: string) => {
    setNote({ kind, text });
    setTimeout(() => setNote(null), 5000);
  };

  const addTicket = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, description, priority }),
      });
      if (!r.ok) { flash("error", (await r.json()).error || "Could not create the ticket."); return; }
      setTitle(""); setDescription(""); setPriority("medium");
      await load();
    } finally { setBusy(false); }
  };

  const importCsv = async (file: File) => {
    setBusy(true);
    try {
      const csv = await file.text();
      const r = await fetch("/api/tickets/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      const j = await r.json();
      if (!r.ok) { flash("error", j.error || "Import failed."); return; }
      flash("ok", `Imported ${j.created} ticket(s)${j.skipped ? `, skipped ${j.skipped} row(s) without a title` : ""}.`);
      await load();
    } catch {
      flash("error", "Could not read the file.");
    } finally {
      setBusy(false);
      if (importRef.current) importRef.current.value = "";
    }
  };

  const removeTicket = async (id: number) => {
    await fetch(`/api/tickets/${id}`, { method: "DELETE" });
    setSelected((s) => { const n = new Set(s); n.delete(id); return n; });
    load();
  };

  const setStatus = async (id: number, status: TicketStatus) => {
    await fetch(`/api/tickets/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load();
  };

  const toggle = (id: number) =>
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const open = tickets.filter((t) => t.status === "open");
  const toExecute = open.filter((t) => selected.size === 0 || selected.has(t.id));

  const execute = async () => {
    if (toExecute.length === 0 || busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/tickets/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticketIds: selected.size > 0 ? [...selected] : [] }),
      });
      const j = await r.json();
      if (!r.ok) { flash("error", j.error === "no_api_key" ? "Connect an AI model first." : j.error || "Execute failed."); return; }
      router.push(`/workspace?managerTask=${j.taskId}`);
    } finally { setBusy(false); }
  };

  /* ---------- drag & drop ---------- */
  const canDrop = (t: Ticket | undefined, target: TicketStatus): boolean =>
    !!t && t.status !== "executing" && t.status !== target && (target === "open" || target === "done");

  const onDrop = (target: TicketStatus) => (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    const id = Number(e.dataTransfer.getData("text/ticket-id"));
    const t = tickets.find((x) => x.id === id);
    if (canDrop(t, target)) void setStatus(id, target);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Tasks</h1>
        <span className="muted small">tickets → Execute → the Agent Manager distributes the work</span>
        <span style={{ flex: 1 }} />
        <a className="btn" href="/api/tickets/template" download title="Download the CSV template (title, description, priority)">
          ⬇ Template
        </a>
        <button className="btn" onClick={() => importRef.current?.click()} disabled={busy} title="Import tickets from a CSV file (use the template)">
          ⬆ Import CSV
        </button>
        <input
          ref={importRef}
          type="file"
          accept=".csv,text/csv"
          style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void importCsv(f); }}
        />
        <button className="btn" onClick={() => setFormOpen((v) => !v)}>{formOpen ? "× Close" : "+ New ticket"}</button>
        <button
          className="btn btn-primary"
          onClick={execute}
          disabled={busy || toExecute.length === 0}
          title={
            toExecute.length === 0
              ? "No open tickets to execute"
              : selected.size > 0
                ? `Execute ${toExecute.length} selected ticket(s) via the Agent Manager`
                : `Execute all ${toExecute.length} open ticket(s) via the Agent Manager`
          }
        >
          ▶ Execute{toExecute.length > 0 ? ` (${toExecute.length})` : ""}
        </button>
      </div>

      {note && (
        <div className="card" style={{ color: note.kind === "error" ? "var(--danger, #e5534b)" : "var(--success, #4caf7d)", padding: 10 }}>
          {note.text}
        </div>
      )}

      {/* New ticket form (collapsible) */}
      {formOpen && (
        <div className="card">
          <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
            <div className="field" style={{ margin: 0, flex: "2 1 260px" }}>
              <label>Title</label>
              <input
                className="input"
                value={title}
                placeholder="e.g. Fix the login redirect bug"
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addTicket()}
                autoFocus
              />
            </div>
            <div className="field" style={{ margin: 0, width: 130 }}>
              <label>Priority</label>
              <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)}>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label>Details (optional)</label>
            <textarea
              className="input"
              rows={3}
              value={description}
              placeholder="Context, acceptance criteria, links…"
              onChange={(e) => setDescription(e.target.value)}
              style={{ resize: "vertical", width: "100%" }}
            />
          </div>
          <button className="btn" onClick={addTicket} disabled={busy || !title.trim()} style={{ marginTop: 8 }}>
            + Add ticket
          </button>
        </div>
      )}

      {open.length > 0 && (
        <div className="muted small">
          {selected.size > 0
            ? `${selected.size} selected — Execute runs only those`
            : "no tickets selected — Execute runs ALL open tickets"}
        </div>
      )}

      {/* Kanban board */}
      {!loaded ? (
        <div className="skeleton" style={{ height: 200 }} />
      ) : (
        <div style={{ display: "flex", gap: 12, alignItems: "stretch", flex: 1, minHeight: 0, overflowX: "auto", paddingBottom: 8 }}>
          {COLUMNS.map((col) => {
            const items = tickets.filter((t) => t.status === col.status);
            const isTarget = dragOver === col.status;
            return (
              <div
                key={col.status}
                onDragOver={(e) => { if (col.droppable) { e.preventDefault(); setDragOver(col.status); } }}
                onDragLeave={() => setDragOver((cur) => (cur === col.status ? null : cur))}
                onDrop={col.droppable ? onDrop(col.status) : undefined}
                style={{
                  flex: "1 1 0",
                  minWidth: 220,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  background: "var(--bg-muted)",
                  border: `1px ${isTarget ? "dashed var(--accent)" : "solid var(--border)"}`,
                  borderRadius: "var(--radius, 8px)",
                  padding: 10,
                  minHeight: 260,
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <strong>{col.label}</strong>
                  <span className="tag">{items.length}</span>
                  <span className="muted" style={{ fontSize: 10 }}>{col.hint}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, overflowY: "auto" }}>
                  {items.length === 0 && (
                    <div className="muted small" style={{ padding: "14px 4px", textAlign: "center" }}>
                      {col.status === "open" ? "No open tickets — add or import some." : "—"}
                    </div>
                  )}
                  {items.map((t) => (
                    <div
                      key={t.id}
                      className="card"
                      draggable={t.status !== "executing"}
                      onDragStart={(e) => e.dataTransfer.setData("text/ticket-id", String(t.id))}
                      style={{
                        padding: 10,
                        cursor: t.status === "executing" ? "default" : "grab",
                        opacity: t.status === "done" ? 0.75 : 1,
                        borderLeft: `3px solid ${PRIORITY_COLOR[t.priority]}`,
                      }}
                      title={t.status === "executing" ? "Being executed by the manager" : "Drag between Open and Done"}
                    >
                      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                        {t.status === "open" && (
                          <input
                            type="checkbox"
                            checked={selected.has(t.id)}
                            onChange={() => toggle(t.id)}
                            title="Include in Execute"
                            style={{ marginTop: 2 }}
                          />
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>
                            <span className="muted">#{t.id}</span> {t.title}
                            {t.status === "executing" && <span className="dot dot-blue pulse-dot" style={{ width: 6, height: 6, display: "inline-block", marginLeft: 6 }} />}
                          </div>
                          {t.description && (
                            <div className="muted small" style={{ marginTop: 4, whiteSpace: "pre-wrap", maxHeight: 72, overflow: "hidden" }}>
                              {t.description}
                            </div>
                          )}
                          <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center", flexWrap: "wrap" }}>
                            <span className="tag" style={{ color: PRIORITY_COLOR[t.priority] }}>{t.priority}</span>
                            {t.manager_task_id != null && (
                              <button
                                className="btn btn-icon"
                                onClick={() => router.push(`/workspace?managerTask=${t.manager_task_id}`)}
                                title={`Open manager task #${t.manager_task_id} in the Workspace${t.task_status ? ` (${t.task_status})` : ""}`}
                                style={{ fontSize: 11 }}
                              >🧩</button>
                            )}
                            {t.status === "failed" && (
                              <button className="btn" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => setStatus(t.id, "open")} title="Move back to Open to retry">
                                ↺ Retry
                              </button>
                            )}
                            <span style={{ flex: 1 }} />
                            <button className="btn btn-icon" onClick={() => removeTicket(t.id)} title="Delete ticket" style={{ fontSize: 11 }}>🗑</button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
