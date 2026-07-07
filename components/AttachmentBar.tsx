"use client";
import { useRef, useState, useEffect, useCallback } from "react";
import { PickedAttachment, readFileToAttachment } from "./attachments-client";

interface AttachmentBarProps {
  attachments: PickedAttachment[];
  onChange: (next: PickedAttachment[]) => void;
  disabled?: boolean;
}

const FILE_ICON: Record<string, string> = {
  document: "📄",
  text: "📝",
};

const CODE_EXTS = /\.(js|jsx|ts|tsx|py|go|rs|java|sh|sql|html|css|json|yaml|yml|md|csv|toml|ini)$/i;

/** Deteksi apakah file adalah kode/teks yang bisa di-preview */
function isPreviewableText(a: PickedAttachment) {
  return a.kind === "text" && (CODE_EXTS.test(a.name) || a.mediaType?.startsWith("text/"));
}

/** Lightbox untuk preview gambar full-size */
function ImageLightbox({
  src,
  name,
  onClose,
}: {
  src: string;
  name: string;
  onClose: () => void;
}) {
  // Tutup dengan Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="lightbox-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Preview: ${name}`}
    >
      <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
        <div className="lightbox-header">
          <span className="lightbox-name">{name}</span>
          <button
            className="lightbox-close"
            onClick={onClose}
            aria-label="Tutup preview"
          >
            ×
          </button>
        </div>
        <div className="lightbox-body">
          <img src={src} alt={name} className="lightbox-img" />
        </div>
      </div>
    </div>
  );
}

/** Modal preview untuk file teks / kode / PDF */
function TextPreviewModal({
  attachment,
  onClose,
}: {
  attachment: PickedAttachment;
  onClose: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const isPdf = attachment.kind === "document" && attachment.mediaType === "application/pdf";
  const lines = attachment.data?.split("\n") ?? [];
  const preview = lines.slice(0, 300).join("\n");
  const truncated = lines.length > 300;

  return (
    <div
      className="lightbox-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Preview: ${attachment.name}`}
    >
      <div
        className="lightbox-inner lightbox-inner--text"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="lightbox-header">
          <span className="lightbox-name">{attachment.name}</span>
          <div className="lightbox-header-actions">
            <span className="lightbox-badge">
              {isPdf ? "PDF" : attachment.mediaType?.split("/")[1]?.toUpperCase() ?? "TEXT"}
            </span>
            <button
              className="lightbox-close"
              onClick={onClose}
              aria-label="Tutup preview"
            >
              ×
            </button>
          </div>
        </div>
        <div className="lightbox-body lightbox-body--text">
          {isPdf ? (
            <div className="preview-pdf-notice">
              <span className="preview-pdf-icon">📄</span>
              <p>File PDF: <strong>{attachment.name}</strong></p>
              <p className="preview-pdf-size">
                {Math.round((attachment.data?.length ?? 0) * 0.75 / 1024)} KB
              </p>
              <p className="preview-pdf-hint">
                File PDF akan dikirim ke AI untuk dianalisis.
              </p>
            </div>
          ) : (
            <>
              <pre className="preview-code">{preview}</pre>
              {truncated && (
                <p className="preview-truncated">
                  … {lines.length - 300} baris lagi tidak ditampilkan (file dikirim lengkap ke AI)
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AttachmentBar({
  attachments,
  onChange,
  disabled,
}: AttachmentBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [lightbox, setLightbox] = useState<{
    type: "image" | "text";
    attachment: PickedAttachment;
  } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const pick = useCallback(async (files: FileList | null) => {
    if (!files || disabled) return;
    const added: PickedAttachment[] = [];
    for (const f of Array.from(files)) {
      const res = await readFileToAttachment(f);
      if ("error" in res) alert(res.error);
      else added.push(res);
    }
    if (added.length) onChange([...attachments, ...added]);
    if (inputRef.current) inputRef.current.value = "";
  }, [attachments, onChange, disabled]);

  const remove = (i: number) =>
    onChange(attachments.filter((_, idx) => idx !== i));

  const openPreview = (a: PickedAttachment) => {
    if (a.kind === "image" && a.previewUrl) {
      setLightbox({ type: "image", attachment: a });
    } else if (isPreviewableText(a) || a.kind === "document") {
      setLightbox({ type: "text", attachment: a });
    }
  };

  // Drag-and-drop support
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) setDragOver(true);
  };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    pick(e.dataTransfer.files);
  };

  const canPreview = (a: PickedAttachment) =>
    (a.kind === "image" && !!a.previewUrl) ||
    isPreviewableText(a) ||
    a.kind === "document";

  return (
    <>
      {/* Lightbox / Text Preview Modal */}
      {lightbox?.type === "image" && (
        <ImageLightbox
          src={lightbox.attachment.previewUrl!}
          name={lightbox.attachment.name}
          onClose={() => setLightbox(null)}
        />
      )}
      {lightbox?.type === "text" && (
        <TextPreviewModal
          attachment={lightbox.attachment}
          onClose={() => setLightbox(null)}
        />
      )}

      {/* Attachment chips list */}
      {attachments.length > 0 && (
        <div className="attach-list" role="list" aria-label="File terlampir">
          {attachments.map((a, i) => (
            <span key={i} className="attach-chip" role="listitem" title={a.name}>
              {/* Thumbnail / icon */}
              {a.kind === "image" && a.previewUrl ? (
                <button
                  type="button"
                  className="attach-thumb-btn"
                  onClick={() => openPreview(a)}
                  aria-label={`Preview ${a.name}`}
                  tabIndex={0}
                >
                  <img
                    src={a.previewUrl}
                    alt={a.name}
                    className="attach-thumb"
                  />
                  <span className="attach-thumb-overlay" aria-hidden="true">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                    </svg>
                  </span>
                </button>
              ) : (
                <span className="attach-icon" aria-hidden="true">
                  {FILE_ICON[a.kind] ?? "📎"}
                </span>
              )}

              {/* File name — clickable if previewable */}
              {canPreview(a) ? (
                <button
                  type="button"
                  className="attach-name attach-name--link"
                  onClick={() => openPreview(a)}
                  title={`Klik untuk preview ${a.name}`}
                >
                  {a.name}
                </button>
              ) : (
                <span className="attach-name">{a.name}</span>
              )}

              {/* File kind badge */}
              <span className={`attach-kind-badge attach-kind-badge--${a.kind === "document" ? "document" : a.kind === "image" ? "image" : "text"}`}>
                {a.kind === "document" ? "PDF" : a.kind === "image" ? "IMG" : a.mediaType?.split("/")[1]?.toUpperCase() ?? "FILE"}
              </span>

              {/* Remove button */}
              <button
                type="button"
                className="attach-x"
                onClick={() => remove(i)}
                aria-label={`Hapus ${a.name}`}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Attach button with drag-drop zone */}
      <button
        type="button"
        className={`attach-btn${dragOver ? " attach-btn--dragover" : ""}`}
        title="Lampirkan file atau foto (atau drag & drop)"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        aria-label="Lampirkan file"
      >
        {dragOver && (
          <span className="attach-drop-hint" aria-live="polite">Drop di sini</span>
        )}
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
        </svg>
      </button>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/*,.md,.csv,.json,.yaml,.yml,.js,.ts,.tsx,.py,.go,.rs,.java,.sql,.sh,.html,.css"
        style={{ display: "none" }}
        onChange={(e) => pick(e.target.files)}
      />
    </>
  );
}
