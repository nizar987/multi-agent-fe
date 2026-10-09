"use client";
/**
 * Team board section — notes the agents of a workspace session posted for each
 * other (board_post) and the files currently locked by running agents.
 * Rendered inside the right-hand Progress panel.
 */

export interface BoardNote {
  id: number;
  agent_name: string;
  note: string;
  created_at: string;
}

export interface FileLock {
  path: string;
  agentName: string;
}

/** SQLite datetime('now') is UTC without a zone — show it in local time. */
function localTime(utc: string): string {
  const d = new Date(`${utc.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? utc : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function TeamBoard({ notes, locks }: { notes: BoardNote[]; locks: FileLock[] }) {
  return (
    <div className="progress-group">
      <div className="progress-group-name">Team board</div>
      {notes.length === 0 ? (
        <div className="muted small">No notes yet — agents post their plans and findings here.</div>
      ) : (
        notes.map((n) => (
          <div key={n.id} className="small" style={{ marginBottom: 6, wordBreak: "break-word" }}>
            <span className="muted">{localTime(n.created_at)}</span> <strong>{n.agent_name}</strong>: {n.note}
          </div>
        ))
      )}
      {locks.length > 0 && (
        <>
          <div className="progress-group-name" style={{ marginTop: 8 }}>🔒 Locked files</div>
          {locks.map((l) => (
            <div key={l.path} className="small mono" title={l.path} style={{ wordBreak: "break-all" }}>
              {l.path.split("/").slice(-2).join("/")} <span className="muted">— {l.agentName}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
