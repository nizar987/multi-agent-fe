import { NextResponse } from "next/server";
import { getToolStatuses } from "@/lib/mcp";
import { hasSecret } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const tools = await getToolStatuses();
  return NextResponse.json({
    tools,
    ai: hasSecret("aiApiKey") ? "configured" : "unconfigured",
  });
}
