"use client";

/**
 * Agent avatar: colored circle + emoji.
 * `working` → pulsing ring (highlights the agent that is busy).
 * `name` → used for accessible aria-label (MINOR-1 fix)
 */
export default function AgentAvatar({
  avatar, color, size = 32, working = false, name,
}: {
  avatar?: string | null;
  color?: string | null;
  size?: number;
  working?: boolean;
  name?: string;
}) {
  const ariaLabel = name
    ? `${name}${working ? " (working)" : ""}`
    : working ? "Agent (working)" : "Agent avatar";

  return (
    <span
      className={`agent-avatar${working ? " working" : ""}`}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.55,
        background: (color || "#c15f3c") + "26", // ~15% alpha
        borderColor: color || "#c15f3c",
      }}
      aria-label={ariaLabel}
    >
      {avatar || "🤖"}
    </span>
  );
}
