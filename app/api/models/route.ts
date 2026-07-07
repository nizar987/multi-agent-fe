/** GET /api/models — model ids available at the configured AI endpoint. */
import { NextResponse } from "next/server";
import { listModels } from "@/lib/ai";

export const dynamic = "force-dynamic";

let cache: { at: number; data: { ok: boolean; models: string[]; error?: string } } | null = null;
const TTL_MS = 60_000;

export async function GET() {
  if (cache && Date.now() - cache.at < TTL_MS) return NextResponse.json(cache.data);
  const data = await listModels();
  if (data.ok) cache = { at: Date.now(), data };
  return NextResponse.json(data);
}
