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
  // gambar dgn format yang TIDAK didukung API (HEIC/TIFF/BMP dll.) — tolak dgn jelas,
  // jangan biarkan lolos sebagai "teks" acak yang membuat model tak melihat foto.
  if (type.startsWith("image/") || /\.(heic|heif|tiff?|bmp|avif)$/i.test(file.name)) {
    return { error: `${file.name}: format gambar tidak didukung — pakai PNG, JPEG, GIF, atau WebP (foto iPhone HEIC perlu dikonversi dulu).` };
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

/* ---------- rekonstruksi lampiran dari pesan tersimpan ---------- */

export interface StoredAtt {
  name: string;
  kind: "image" | "document" | "text";
  /** data URL utk thumbnail (hanya gambar, dari blok base64 di meta). */
  previewUrl?: string;
}

const ATTACH_TAG = /\n?\[lampiran: ([^\]]+)\]\s*$/;

/** Hilangkan tag "[lampiran: …]" dari teks tampilan. */
export function stripAttachTag(content: string): string {
  return content.replace(ATTACH_TAG, "").trimEnd();
}

/**
 * Bangun ulang objek lampiran (chip/thumbnail) dari pesan yang di-load dari
 * DB: nama diambil dari tag "[lampiran: …]", preview gambar dari blok base64
 * di kolom meta (contentBlocks). Blok lampiran selalu berada di URUTAN AKHIR
 * contentBlocks, sesuai urutan nama di tag.
 */
export function parseStoredMessage(content: string, meta?: string | null): { text: string; atts: StoredAtt[] } {
  const m = content.match(ATTACH_TAG);
  if (!m) return { text: content, atts: [] };
  const names = m[1].split(", ");
  const text = content.slice(0, m.index).trimEnd();

  let blocks: any[] = [];
  try {
    const parsed = meta ? JSON.parse(meta) : null;
    if (Array.isArray(parsed?.contentBlocks)) blocks = parsed.contentBlocks;
  } catch { /* meta rusak → chip tanpa preview */ }
  const attBlocks = blocks.length >= names.length ? blocks.slice(blocks.length - names.length) : [];

  const atts: StoredAtt[] = names.map((name, i) => {
    const b = attBlocks[i];
    if (b?.type === "image" && b.source?.data) {
      return { name, kind: "image", previewUrl: `data:${b.source.media_type};base64,${b.source.data}` };
    }
    if (b?.type === "document") return { name, kind: "document" };
    return { name, kind: "text" };
  });
  return { text, atts };
}
