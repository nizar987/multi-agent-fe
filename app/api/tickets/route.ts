/**
 * GET  /api/tickets — all tickets (with linked manager-task status)
 * POST /api/tickets — create a ticket { title, description?, priority? }
 */
import { NextRequest, NextResponse } from "next/server";
import { createTicket, listTickets } from "@/lib/tickets-db";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(listTickets());
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const title = (body?.title ?? "").toString().trim();
  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });
  const id = createTicket(title, (body?.description ?? "").toString(), (body?.priority ?? "medium").toString());
  return NextResponse.json({ id });
}
