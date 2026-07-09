"use client";

export type RunMode = "approval" | "act" | "plan";

interface ModeSelectProps {
  value: RunMode;
  onChange: (mode: RunMode) => void;
  /** Show the "Run plan" button (after the agent has finished drafting a plan). */
  showProceed?: boolean;
  onProceed?: () => void;
}

const HINTS: Record<RunMode, string> = {
  approval: "Risky actions (shell, SQL writes, Redis writes, .env reads) ask for your permission first.",
  act: "Act mode is on: risky actions run IMMEDIATELY without confirmation.",
  plan: "The agent only drafts a plan; risky actions are blocked automatically.",
};

/** Execution-mode dropdown below the chat box: Approval / Act / Plan. */
export default function ModeSelect({ value, onChange, showProceed, onProceed }: ModeSelectProps) {
  return (
    <>
      <select
        className="mode-select"
        value={value}
        onChange={(e) => onChange(e.target.value as RunMode)}
        title={HINTS[value]}
      >
        <option value="approval">🛡 Approval</option>
        <option value="act">⚡ Act</option>
        <option value="plan">📝 Plan</option>
      </select>
      {value === "act" ? (
        <span className="mode-warning" title={HINTS.act}>⚠ {HINTS.act}</span>
      ) : (
        <span title={HINTS[value]}>{HINTS[value]}</span>
      )}
      {showProceed && onProceed && (
        <button
          className="btn btn-primary btn-proceed"
          onClick={onProceed}
          title="Execute the drafted plan (switches to Approval mode)"
        >
          ▶ Run plan
        </button>
      )}
    </>
  );
}
