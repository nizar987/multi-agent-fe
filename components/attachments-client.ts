"use client";

import type { Attachment, AttachmentKind } from "@/lib/attachments";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_PDF_BYTES = 32 * 1024 * 1024;
const TEXTLIKE_EXT = /\.(txt|md|markdown|csv|tsv|json|ya?ml|xml|html?|css|scss|js|jsx|ts|tsx|py|rb|go|rs|java|kt|c|h|cpp|cc|sh|bash|sql|toml|ini|env|log|gitignore|dockerfile)$/i;

export interface PickedAttachment extends Attachment {
  /** data URL untuk preview thumbnail (khusus gambar). */
  previewUrl?: string;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

/** Baca satu File → Attachment (base64 utk gambar/PDF, teks utk lainnya). */
export async function readFileToAttachment(file: File): Promise<PickedAttachment | { error: string }> {
  const type = file.type || "";
  const isImage = /^image\/(png|jpe?g|gif|webp)$/.test(type);
  const isPdf = type === "application/pdf" || /\.pdf$/i.test(file.name);

  if (isImage) {
    if (file.size > MAX_IMAGE_BYTES) return { error: `${file.name}: gambar melebihi 5 MB.` };
    const dataUrl = await readAsDataUrl(file);
    const base64 = dataUrl.split(",")[1] ?? "";
    const mediaType = type === "image/jpg" ? "image/jpeg" : type;
    return { name: file.name, kind: "image" as AttachmentKind, mediaType, data: base64, previewUrl: dataUrl };
  }
  if (isPdf) {
    if (file.size > MAX_PDF_BYTES) return { error: `${file.name}: PDF melebihi 32 MB.` };
    const dataUrl = await readAsDataUrl(file);
    const base64 = dataUrl.split(",")[1] ?? "";
    return { name: file.name, kind: "document" as AttachmentKind, mediaType: "application/pdf", data: base64 };
  }
  // file teks/kode
  if (TEXTLIKE_EXT.test(file.name) || type.startsWith("text/") || file.size < 512 * 1024) {
    const text = await readAsText(file);
    return { name: file.name, kind: "text" as AttachmentKind, mediaType: type || "text/plain", data: text };
  }
  return { error: `${file.name}: tipe file tidak didukung (pakai gambar, PDF, atau file teks/kode).` };
}

/** Buang previewUrl sebelum kirim ke server (tidak dibutuhkan API). */
export function toWire(a: PickedAttachment): Attachment {
  return { name: a.name, kind: a.kind, mediaType: a.mediaType, data: a.data };
}
