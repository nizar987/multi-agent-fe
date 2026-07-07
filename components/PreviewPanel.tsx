"use client";
import { useEffect, useState } from "react";
import { detectTargets, type PreviewTarget } from "@/lib/preview-detect";

interface PreviewPanelProps {
  /** All agent text (concatenated) — the panel scans it automatically. */
  texts: string[];
  /** Panel width (default 380px). */
  width?: number;
}

type FileResult =
  | { type: "text"; ext: string; content: string }
  | { type: "dir"; entries: { name: string; isDir: boolean; size: number }[] }
  | { type: "binary"; size: number; ext: string }
  | { type: "image"; url: string }
  | { type: "error"; error: string };

export default function PreviewPanel({ texts, width = 380 }: PreviewPanelProps) {
  const [targets, setTargets] = useState<PreviewTarget[]>([]);
  const [active, setActive] = useState<PreviewTarget | null>(null);
  const [fileResult, setFileResult] = useState<FileResult | null>(null);
  const [loading, setLoading] = useState(false);

  // rescan whenever the text changes
  useEffect(() => {
    const all = texts.join("\n");
    const found = detectTargets(all);
    setTargets(found);
    // auto-select any new target that was not there before
    if (found.length > 0) {
      setActive((prev) => {
        const stillThere = prev && found.some((t) =>
          t.kind === prev.kind && (t.kind === "web" ? t.url === (prev as any).url : t.path === (prev as any).path)
        );
        return stillThere ? prev : found[found.length - 1];
      });
    }
  }, [texts]);

  // load the file when active switches to a file target
  useEffect(() => {
    if (!active || active.kind !== "file") { setFileResult(null); return; }
    const ext = active.path.split(".").pop()?.toLowerCase() ?? "";
    const imageExts = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
    if (imageExts.has(ext)) {
      setFileResult({ type: "image", url: `/api/preview?path=${encodeURIComponent(active.path)}` });
      return;
    }
    setLoading(true);
    setFileResult(null);
    fetch(`/api/preview?path=${encodeURIComponent(active.path)}`)
      .then((r) => r.json())
      .then((d) => setFileResult(d))
      .catch((e) => setFileResult({ type: "error", error: e.message }))
      .finally(() => setLoading(false));
  }, [active]);

  if (targets.length === 0) return null;

  const key = (t: PreviewTarget) => t.kind === "web" ? t.url : t.path;
  const isActive = (t: PreviewTarget) => active ? key(t) === key(active) : false;

  return (
    <div className="preview-panel" style={{ width }}>
      {/* tab list */}
      <div className="preview-tabs">
        {targets.map((t) => (
          <button
            key={key(t)}
            className={`preview-tab${isActive(t) ? " active" : ""}`}
            onClick={() => setActive(t)}
            title={t.kind === "web" ? t.url : t.path}
          >
            <span className="preview-tab-icon">{t.kind === "web" ? "🌐" : "📄"}</span>
            <span className="preview-tab-label">{t.label}</span>
          </button>
        ))}
      </div>

      {/* content */}
      <div className="preview-content">
        {!active && (
          <div className="preview-empty">Pick a tab to see a preview.</div>
        )}

        {active?.kind === "web" && (
          <iframe
            key={active.url}
            src={active.url}
            className="preview-iframe"
            sandbox="allow-scripts allow-same-origin allow-forms"
            title={active.label}
          />
        )}

        {active?.kind === "file" && (
          <>
            {loading && (
              <div className="preview-loading">
                <div className="spinner" /> Loading…
              </div>
            )}
            {!loading && fileResult?.type === "image" && (
              <div className="preview-image-wrap">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={fileResult.url} alt={active.label} className="preview-image" />
              </div>
            )}
            {!loading && fileResult?.type === "text" && (
              <div className="preview-text-wrap">
                <div className="preview-file-meta">{active.path}</div>
                <pre className="preview-code"><code>{fileResult.content}</code></pre>
              </div>
            )}
            {!loading && fileResult?.type === "dir" && (
              <div className="preview-text-wrap">
                <div className="preview-file-meta">{active.path}</div>
                <div className="preview-dir-list">
                  {fileResult.entries.map((e) => (
                    <div
                      key={e.name}
                      className="preview-dir-item"
                      onClick={() => {
                        const newPath = active.path.replace(/\/$/, "") + "/" + e.name;
                        setActive({ kind: "file", path: newPath, label: e.name });
                        setTargets((prev) => {
                          const exists = prev.some((t) => t.kind === "file" && t.path === newPath);
                          if (exists) return prev;
                          return [...prev, { kind: "file", path: newPath, label: e.name }];
                        });
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
