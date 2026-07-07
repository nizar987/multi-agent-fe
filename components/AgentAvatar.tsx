"use client";

/**
 * Agent avatar: colored circle + emoji.
 * `working` → pulsing ring (highlights the agent that is busy).
 */
export default function AgentAvatar({
  avatar, color, size = 32, working = false,
}: {
  avatar?: string | null;
  color?: string | null;
  size?: number;
  working?: boolean;
}) {
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
      aria-label="agent avatar"
    >
      {avatar || "🤖"}
    </span>
  );
}
