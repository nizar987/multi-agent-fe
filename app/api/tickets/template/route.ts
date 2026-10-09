/**
 * GET /api/tickets/template — downloadable CSV template for ticket import.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const TEMPLATE = [
  "title,description,priority",
  '"Fix login redirect bug","After OAuth the user lands on a 404 instead of the dashboard. Steps: login with Google → observe redirect.",high',
  '"Write release notes v1.2","Summarize the changelog since v1.1 in user-friendly language.",medium',
  '"Clean up unused assets","Remove images and icons that are no longer referenced.",low',
].join("\r\n");

export async function GET() {
  return new NextResponse(TEMPLATE + "\r\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="tickets-template.csv"',
    },
  });
}
