"use client";
import { useState } from "react";

export interface AskOption {
  label: string;
  description?: string;
  /** true = recommended, false = not recommended, undefined = neutral */
  recommended?: boolean;
}

export interface AskItem {
  id: string;
  question: string;
  options: AskOption[];
  state: "pending" | "answered";
  answer?: string;
}

interface AskUserCardProps {
  item: AskItem;
  onAnswer: (id: string, answer: string) => void;
}

/**
 * Multiple-choice question card — the agent asks, the user clicks an option
 * (recommended / not-recommended are labelled) or types a custom answer.
 */
export default function AskUserCard({ item, onAnswer }: AskUserCardProps) {
  const [custom, setCustom] = useState("");
  const [showCustom, setShowCustom] = useState(false);

  const answered = item.state === "answered";

  const submitCustom = () => {
    const text = custom.trim();
    if (!text) return;
    onAnswer(item.id, text);
  };

  return (
    <div className="ask-card">
      <div className="ask-question">❓ {item.question}</div>

      {answered ? (
        <div className="ask-answered">✓ You answered: <strong>{item.answer}</strong></div>
      ) : (
        <>
          <div className="ask-options">
            {item.options.map((o, i) => (
              <button
                key={i}
                className={`ask-option${o.recommended === true ? " ask-option--recommended" : ""}${o.recommended === false ? " ask-option--discouraged" : ""}`}
                onClick={() => onAnswer(item.id, o.label)}
              >
                <span className="ask-option-head">
                  <span className="ask-option-label">{o.label}</span>
                  {o.recommended === true && <span className="ask-badge ask-badge--good">⭐ Recommended</span>}
                  {o.recommended === false && <span className="ask-badge ask-badge--bad">Not recommended</span>}
                </span>
                {o.description && <span className="ask-option-desc">{o.description}</span>}
              </button>
            ))}

            {!showCustom && (
              <button className="ask-option ask-option--custom" onClick={() => setShowCustom(true)}>
                <span className="ask-option-head">
                  <span className="ask-option-label">✏️ Other…</span>
                </span>
                <span className="ask-option-desc">Type your own answer</span>
              </button>
            )}
          </div>

          {showCustom && (
            <div className="ask-custom-row">
              <input
                className="input"
                autoFocus
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitCustom(); }}
                placeholder="Type your answer… (Enter to send)"
              />
              <button className="btn btn-primary" disabled={!custom.trim()} onClick={submitCustom}>Answer</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
