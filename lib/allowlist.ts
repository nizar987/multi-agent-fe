/**
 * Approval allowlist — actions the user chose "Always allow" for.
 * Matched by exact (kind, detail) pair; matching actions skip the approval card.
 */
import { getDb } from "./db";
import type { ApprovalKind } from "./agent-runtime";

export interface AllowlistEntry {
  id: number;
  kind: ApprovalKind;
  detail: string;
  created_at: string;
}

export function isAllowed(kind: ApprovalKind, detail: string): boolean {
  const row = getDb()
    .prepare("SELECT id FROM approval_allowlist WHERE kind=? AND detail=?")
    .get(kind, detail.trim());
  return !!row;
}

export function addAllowed(kind: ApprovalKind, detail: string): void {
  getDb()
    .prepare("INSERT OR IGNORE INTO approval_allowlist(kind, detail) VALUES(?,?)")
    .run(kind, detail.trim());
}

export function listAllowed(): AllowlistEntry[] {
  return getDb()
    .prepare("SELECT * FROM approval_allowlist ORDER BY kind, id DESC")
    .all() as AllowlistEntry[];
}

export function removeAllowed(id: number): void {
  getDb().prepare("DELETE FROM approval_allowlist WHERE id=?").run(id);
}
