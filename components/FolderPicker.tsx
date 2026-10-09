"use client";
import { useEffect, useRef, useState } from "react";

type Props = {
  /** Currently selected folder (empty string = none). */
  value: string;
  /** Called when user picks a folder (from history or new dialog). */
  onChange: (folder: string) => void;
  /** Optional placeholder label on the trigger button. */
  placeholder?: string;
  disabled?: boolean;
};

/**
 * FolderPicker — shows previously picked folders as a dropdown.
 * If there are no known folders OR the user clicks "Browse new folder…",
 * it opens the native OS dialog.
 *
 * Logic:
 *  - On mount: GET /api/settings/pick-folder → get allowedDirs history
 *  - If history is empty → directly open native dialog (POST)
 *  - If history exists → show dropdown with past folders + "Browse new…"
 */
export default function FolderPicker({ value, onChange, placeholder = "📁 Working folder", disabled = false }: Props) {
  const [history, setHistory] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Load history on mount
  useEffect(() => {
    fetch("/api/settings/pick-folder")
      .then((r) => r.json())
      .then((d) => setHistory(Array.isArray(d.folders) ? d.folders : []))
      .catch(() => setHistory([]));
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  /** Open native OS dialog, add result to history, call onChange. */
  const browseNew = async () => {
    setOpen(false);
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/settings/pick-folder", { method: "POST" });
      const j = await r.json();
      if (!r.ok) { setError(j.error || "Could not open folder dialog."); return; }
      if (j.canceled) return;
      const folder: string = j.folder;
      setHistory((prev) => prev.includes(folder) ? prev : [folder, ...prev]);
      onChange(folder);
    } catch {
      setError("Could not open folder dialog.");
    } finally {
      setLoading(false);
    }
  };

  const handleTrigger = () => {
    if (disabled || loading) return;
    // No history → go straight to native dialog
    if (history.length === 0) { browseNew(); return; }
    setOpen((o) => !o);
  };

  const selectFromHistory = (folder: string) => {
    setOpen(false);
    onChange(folder);
  };

  /** Short display name: just the last path segment. */
  const shortName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

  const label = value ? shortName(value) : placeholder;

  return (
    <div className="folder-picker" ref={ref}>
      <div className="folder-picker-trigger-row">
        <button
          type="button"
          className={`btn folder-picker-btn${value ? " folder-picker-btn--set" : ""}`}
          onClick={handleTrigger}
          disabled={disabled || loading}
          title={value || placeholder}
        >
          {loading
            ? <><span className="spinner" /> Opening…</>
            : <><span className="folder-picker-icon">📁</span><span className="folder-picker-label">{label}</span></>
          }
          {history.length > 0 && !loading && (
            <span className="folder-picker-chevron">{open ? "▲" : "▼"}</span>
          )}
        </button>

        {value && (
          <button
            type="button"
            className="btn btn-icon folder-picker-clear"
            onClick={() => onChange("")}
            title="Clear working folder"
            disabled={disabled}
          >×</button>
        )}
      </div>

      {error && <div className="error-text" style={{ marginTop: 4, fontSize: 12 }}>{error}</div>}

      {open && history.length > 0 && (
        <div className="folder-picker-menu">
          <div className="folder-picker-menu-header">Recent folders</div>
          {history.map((f) => (
            <button
              key={f}
              type="button"
              className={`folder-picker-item${f === value ? " active" : ""}`}
              onClick={() => selectFromHistory(f)}
              title={f}
            >
              <span className="folder-picker-item-icon">📁</span>
              <span className="folder-picker-item-path">
                <span className="folder-picker-item-name">{shortName(f)}</span>
                <span className="folder-picker-item-full">{f}</span>
              </span>
              {f === value && <span className="folder-picker-item-check">✓</span>}
            </button>
          ))}
          <div className="folder-picker-menu-divider" />
          <button
            type="button"
            className="folder-picker-item folder-picker-browse"
            onClick={browseNew}
          >
            <span className="folder-picker-item-icon">📂</span>
            <span className="folder-picker-item-name">Browse new folder…</span>
          </button>
        </div>
      )}
    </div>
  );
}
