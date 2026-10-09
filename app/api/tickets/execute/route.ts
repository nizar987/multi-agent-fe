/**
 * POST /api/tickets/execute — hand the open tickets to the Agent Manager.
 * Body: { ticketIds?: number[], agentIds?: number[], model?: string }
 *   ticketIds empty/omitted → ALL open tickets.
 *   agentIds  empty/omitted → the manager may use every registered agent.
 *
 * All picked tickets become ONE manager task: the manager plans, splits the
 * work across agents, reviews and reports. Returns { taskId, ticketIds } —
 * the client then redirects to the Workspace manager view.
 */
import { NextRequest, NextResponse } from "next/server";
import { getOpenTickets, linkTicketsToTask } from "@/lib/tickets-db";
import { startTask } from "@/lib/manager";
import { hasSecret } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!hasSecret("aiApiKey")) {
    return NextResponse.json({ error: "no_api_key" }, { status: 428 });
  }
  const body = await req.json().catch(() => ({}));
  const ticketIds: number[] = Array.isArray(body?.ticketIds)
    ? body.ticketIds.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n))
    : [];
  const agentIds: number[] = Array.isArray(body?.agentIds)
    ? body.agentIds.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n))
    : [];
  const model = typeof body?.model === "string" && body.model.trim() ? body.model.trim() : null;

  const tickets = getOpenTickets(ticketIds);
  if (tickets.length === 0) {
    return NextResponse.json({ error: "No open tickets to execute." }, { status: 400 });
  }

  const request =
    "Complete the following tickets. Each ticket is an independent piece of work — distribute them " +
    "across the team sensibly (group related tickets for one agent when that is more efficient) and " +
    "report per ticket when done.\n\n" +
    tickets
      .map(
        (t, i) =>
          `Ticket ${i + 1} (#${t.id}, priority: ${t.priority}): ${t.title}` +
          (t.description ? `\n${t.description}` : "")
      )
      .join("\n\n");

  const title =
    tickets.length === 1 ? tickets[0].title.slice(0, 80) : `${tickets.length} tickets: ${tickets[0].title}`.slice(0, 80);

  const taskId = startTask(request, title, agentIds, model);
  linkTicketsToTask(tickets.map((t) => t.id), taskId);
  return NextResponse.json({ taskId, ticketIds: tickets.map((t) => t.id) });
}
