/**
 * Attachment support — memungkinkan agent MEMBACA file & foto yang
 * dilampirkan user di chat/workspace.
 *
 * - image (png/jpeg/gif/webp) & PDF → dikirim sebagai content block vision
 *   ke Messages API (model harus mendukung vision).
 * - file teks/kode → isinya diekstrak jadi text block.
 *
 * Blok yang dihasilkan disimpan di kolom `messages.meta` supaya konteks
 * multi-giliran tetap utuh saat riwayat dipulihkan.
 */

export type AttachmentKind = "image" | "document" | "text";

export interface Attachment {
  name: string;
  kind: AttachmentKind;
  mediaType: string; // image/png, application/pdf, text/plain, …
  /** base64 (image/document) atau teks mentah UTF-8 (text). */
  data: string;
}

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // batas Messages API per gambar
export const MAX_PDF_BYTES = 32 * 1024 * 1024;
export const MAX_TEXT_CHARS = 200_000;
export const MAX_ATTACHMENTS = 20;

/** Anthropic content block (longgar — API yang memvalidasi bentuk final). */
type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } };

/** Rakit content array Messages API dari teks user + lampiran. */
export function buildUserContent(message: string, attachments: Attachment[]): ContentBlock[] | string {
  const clean = (attachments ?? []).slice(0, MAX_ATTACHMENTS);
  if (clean.length === 0) return message;

  const blocks: ContentBlock[] = [];
  if (message.trim()) blocks.push({ type: "text", text: message });

  for (const a of clean) {
    if (a.kind === "image" && IMAGE_TYPES.includes(a.mediaType)) {
      blocks.push({ type: "image", source: { type: "base64", media_type: a.mediaType, data: a.data } });
    } else if (a.kind === "document" && a.mediaType === "application/pdf") {
      blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: a.data } });
    } else {
      // file teks/kode (atau tipe tak dikenal → perlakukan sbg teks)
      const text = a.data.slice(0, MAX_TEXT_CHARS);
      blocks.push({ type: "text", text: `File: ${a.name}\n\n${text}` });
    }
  }
  return blocks;
}

/** Ringkasan teks untuk kolom `content` (tampilan + judul percakapan). */
export function attachmentSummary(message: string, attachments: Attachment[]): string {
  if (!attachments || attachments.length === 0) return message;
  const names = attachments.map((a) => a.name).join(", ");
  const tag = `[lampiran: ${names}]`;
  return message.trim() ? `${message}\n${tag}` : tag;
}

/** True bila ada blok document (PDF) — dipakai untuk header beta Anthropic. */
export function hasDocumentBlock(messages: { content: unknown }[]): boolean {
  return messages.some(
    (m) => Array.isArray(m.content) && (m.content as any[]).some((b) => b?.type === "document")
  );
}
