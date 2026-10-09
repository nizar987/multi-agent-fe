"use client";

export type ApprovalKind = "shell" | "database" | "redis" | "env" | "learning";
export type ApprovalDecision = "always" | "once" | "deny";

export interface ApprovalItem {
  id: string;
  approvalKind: ApprovalKind;
  detail: string;
  state: "pending" | "approved" | "rejected";
}

interface ApprovalCardProps {
  item: ApprovalItem;
  onDecide: (id: string, decision: ApprovalDecision) => void;
}

const TITLES: Record<ApprovalKind, string> = {
  shell: "⌘ Wants to run a shell command",
  database: "🗄 Wants to run SQL (modifies data)",
  redis: "⚡ Wants to write to Redis",
  env: "🔑 Wants to read a .env file",
  learning: "🧠 Wants to change your knowledge / skills / shared memory",
};

/** Approval card for risky actions — one mechanism for shell, SQL, Redis, and .env reads. */
export default function ApprovalCard({ item, onDecide }: ApprovalCardProps) {
  return (
    <div className="shell-card">
      <div className="shell-head">
        <span>{TITLES[item.approvalKind]}</span>
        {item.state === "approved" && <span style={{ color: "var(--success)" }}>✓ executed</span>}
        {item.state === "rejected" && <span style={{ color: "var(--danger)" }}>✕ rejected</span>}
      </div>
      <pre className="shell-cmd">{item.detail}</pre>
      {item.state === "pending" && (
        <div className="row" style={{ marginTop: 8, flexWrap: "wrap", gap: 6 }}>
          <button
            className="btn btn-primary"
            onClick={() => onDecide(item.id, "once")}
            title="Run it this one time"
          >Allow once</button>
          <button
            className="btn"
            onClick={() => onDecide(item.id, "always")}
            title="Run it now and add to the allowed list — this exact action won't ask again"
          >✓ Always allow</button>
          <button
            className="btn btn-danger-ghost"
            onClick={() => onDecide(item.id, "deny")}
            title="Don't run it"
          >Deny</button>
        </div>
      )}
    </div>
  );
}
