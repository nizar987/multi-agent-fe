"use client";
import { useRef, useState } from "react";

type State = "idle" | "loading" | "success" | "fail";

/**
 * Test connection button — 4 unambiguous states (DESIGN 2.2):
 * idle → loading (spinner) → success (green for 3 s) / fail (message persists).
 */
export default function TestConnection({
  payload, onResult,
}: {
  payload: Record<string, any>;
  onResult?: (ok: boolean) => void;
}) {
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = async () => {
    if (timer.current) clearTimeout(timer.current);
    setState("loading");
    setMessage("");
    try {
      const r = await fetch("/api/settings/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }).then((r) => r.json());
      setMessage(r.message);
      setState(r.ok ? "success" : "fail");
      onResult?.(r.ok);
      if (r.ok) timer.current = setTimeout(() => setState("idle"), 3000);
    } catch {
      setMessage("An unexpected error occurred while testing the connection.");
      setState("fail");
      onResult?.(false);
    }
  };

  return (
    <div>
      <button
        className={`btn${state === "success" ? " btn-success" : ""}`}
        onClick={run}
        disabled={state === "loading"}
        data-loading={state === "loading"}
      >
        {state === "loading" && <span className="spinner" />}
        {state === "success" ? `✓ ${message}` : "Test connection"}
      </button>
      {state === "fail" && <div className="error-text">{message}</div>}
    </div>
  );
}
