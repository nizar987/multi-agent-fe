/**
 * POST /api/tickets/import — bulk-create tickets from CSV text.
 * Body: { csv: string }  (columns: title, description, priority; header row optional)
 */
import { NextRequest, NextResponse } from "next/server";
import { importTicketsCsv } from "@/lib/tickets-db";

export const dynamic = "force-dynamic";

const MAX_CSV_CHARS = 500_000;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const csv = typeof body?.csv === "string" ? body.csv : "";
  if (!csv.trim()) return NextResponse.json({ error: "csv is required" }, { status: 400 });
  if (csv.length > MAX_CSV_CHARS) {
    return NextResponse.json({ error: "CSV too large (max 500 KB)." }, { status: 413 });
  }
  const result = importTicketsCsv(csv);
  if (result.created === 0) {
    return NextResponse.json({ error: "No valid rows found — the first column (title) must not be empty." }, { status: 400 });
  }
  return NextResponse.json(result);
}
