"use client";
import { useEffect, useState } from "react";
import { type PreviewTarget } from "@/lib/preview-detect";

interface PreviewPanelProps {
  /** Controlled: the target to show. null = panel is hidden. */
  target: PreviewTarget | null;
  /** Panel width (default 380px). */
  width?: number;
  /** Called when the user clicks the close button. */
  onClose: () => void;
}

type FileResult =
  | { type: "text"; ext: string; content: string }
  | { type: "dir"; entries: { name: string; isDir: boolean; size: number }[] }
  | { type: "binary"; size: number; ext: string }
  | { type: "image"; url: string }
  | { type: "error"; error: string };

export default function PreviewPanel({ target, width = 380, onClose }: PreviewPanelProps) {
  const [fileResult, setFileResult] = useState<FileResult | null>(null);
  const [loading, setLoading] = useState(false);
  // allow drilling into sub-paths from a dir listing
  const [activePath, setActivePath] = useState<string | null>(null);

  // reset drill-down whenever the top-level target changes
  useEffect(() => {
    setActivePath(null);
    setFileResult(null);
  }, [target]);

  // resolve the effective file path (drill-down overrides)
  const filePath = activePath ?? (target?.kind === "file" ? target.path : null);

  // load file whenever filePath changes
  useEffect(() => {
    if (!filePath) { setFileResult(null); return; }
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    const imageExts = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
    if (imageExts.has(ext)) {
      setFileResult({ type: "image", url: `/api/preview?path=${encodeURIComponent(filePath)}` });
      return;
    }
    setLoading(true);
    setFileResult(null);
    fetch(`/api/preview?path=${encodeURIComponent(filePath)}`)
      .then((r) => r.json())
      .then((d) => setFileResult(d))
      .catch((e) => setFileResult({ type: "error", error: e.message }))
      .finally(() => setLoading(false));
  }, [filePath]);

  if (!target) return null;

  const label = target.kind === "web" ? target.url : target.path;
  const displayLabel = target.label;

  return (
    <div className="preview-panel" style={{ width }}>
      {/* header */}
      <div className="preview-panel-header">
        <span className="preview-panel-icon">{target.kind === "web" ? "🌐" : "📄"}</span>
        <span className="preview-panel-title" title={label}>{displayLabel}</span>
        {activePath && activePath !== (target.kind === "file" ? target.path : null) && (
          <button
            className="preview-back-btn"
            onClick={() => setActivePath(null)}
            title="Back"
          >← Back</button>
        )}
        <button
          className="preview-close-btn"
          onClick={onClose}
          title="Close preview"
          aria-label="Close preview"
        >✕</button>
      </div>

      {/* content */}
      <div className="preview-content">
        {target.kind === "web" && (
          <iframe
            key={target.url}
            src={target.url}
            className="preview-iframe"
            sandbox="allow-scripts allow-same-origin allow-forms"
            title={target.label}
          />
        )}

        {target.kind === "file" && (
          <>
            {loading && (
              <div className="preview-loading">
                <div className="spinner" /> Loading…
              </div>
            )}
            {!loading && fileResult?.type === "image" && (
              <div className="preview-image-wrap">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={fileResult.url} alt={displayLabel} className="preview-image" />
              </div>
            )}
            {!loading && fileResult?.type === "text" && (
              <div className="preview-text-wrap">
                <div className="preview-file-meta">{filePath}</div>
                <pre className="preview-code"><code>{fileResult.content}</code></pre>
              </div>
            )}
            {!loading && fileResult?.type === "dir" && (
              <div className="preview-text-wrap">
                <div className="preview-file-meta">{filePath}</div>
                <div className="preview-dir-list">
                  {fileResult.entries.map((e) => (
                    <div
                      key={e.name}
                      className="preview-dir-item"
                      onClick={() => {
                        const newPath = (filePath ?? "").replace(/\/$/, "") + "/" + e.name;
                        setActivePath(newPath);
                      }}
                    >
                      <span>{e.isDir ? "📁" : "📄"}</span>
                      <span className="grow">{e.name}</span>
                      {!e.isDir && <span className="muted small">{(e.size / 1024).toFixed(1)}KB</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {!loading && fileResult?.type === "binary" && (
              <div className="preview-empty">
                Binary file ({fileResult.ext}, {(fileResult.size / 1024).toFixed(0)} KB) — cannot be displayed.
              </div>
            )}
            {!loading && fileResult?.type === "error" && (
              <div className="preview-empty error-text">{fileResult.error}</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
