/**
 * GET /api/models — model ids aggregated from ALL saved AI connections,
 * grouped per connection. Also fills the model→connection routing map so
 * picking any listed model works even when its provider isn't the active one.
 */
import { NextResponse } from "next/server";
import { listModels, listModelsFor, detectProvider, AiProvider } from "@/lib/ai";
import { listByKind } from "@/lib/connections-db";
import { getConnectionSecret } from "@/lib/config";
import { setModelRoutes, ModelRoute } from "@/lib/model-routes";

export const dynamic = "force-dynamic";

interface ModelGroup {
  name: string;
  active: boolean;
  models: string[];
  /** Hidden from the regular model dropdown (still routed & selectable as vision model). */
  hidden?: boolean;
}

/** NVIDIA NIM is used only as the vision backend — keep its models out of the chat dropdown. */
function isHiddenConnection(baseUrl: string): boolean {
  return /nvidia\.com/i.test(baseUrl);
}
interface ModelsResponse {
  ok: boolean;
  models: string[];
  groups: ModelGroup[];
  error?: string;
}

let cache: { at: number; data: ModelsResponse } | null = null;
const TTL_MS = 60_000;

export async function GET() {
  if (cache && Date.now() - cache.at < TTL_MS) return NextResponse.json(cache.data);

  const conns = listByKind("ai");

  // No saved AI connections yet — fall back to the legacy single config.
  if (conns.length === 0) {
    const d = await listModels();
    const data: ModelsResponse = {
      ...d,
      groups: d.ok ? [{ name: "AI Provider", active: true, models: d.models }] : [],
    };
    if (d.ok) cache = { at: Date.now(), data };
    return NextResponse.json(data);
  }

  // Fetch every connection's model list in parallel. Inactive connections are
  // processed first and the active one last, so the active connection wins any
  // duplicate entries in the routing map.
  const ordered = [...conns].sort((a, b) => Number(a.is_active) - Number(b.is_active));
  const results = await Promise.all(
    ordered.map(async (c) => {
      let cfg: Record<string, any> = {};
      try { cfg = JSON.parse(c.config || "{}"); } catch { cfg = {}; }
      const baseUrl = String(cfg.baseUrl || "https://api.anthropic.com");
      const provider: AiProvider = ["anthropic", "openai", "gemini"].includes(cfg.provider)
        ? cfg.provider
        : detectProvider(baseUrl);
      const apiKey = getConnectionSecret(c.id);
      if (!apiKey) return { conn: c, baseUrl, provider, ok: false as const, models: [] as string[] };
      const r = await listModelsFor({ baseUrl, apiKey, provider });
      return { conn: c, baseUrl, provider, ok: r.ok, models: r.models };
    })
  );

  const routeMap: Record<string, ModelRoute> = {};
  const groups: ModelGroup[] = [];
  for (const r of results) {
    if (!r.ok || r.models.length === 0) continue;
    for (const m of r.models) {
      routeMap[m] = { connId: r.conn.id, baseUrl: r.baseUrl, provider: r.provider };
    }
    const hidden = isHiddenConnection(r.baseUrl);
    groups.push({ name: r.conn.name, active: !!r.conn.is_active, models: r.models, ...(hidden ? { hidden } : {}) });
  }
  setModelRoutes(routeMap);

  // Flat list: active connection's models first, then the rest, deduplicated.
  // Hidden (vision-only) connections stay out of the flat chat-model list.
  groups.sort((a, b) => Number(b.active) - Number(a.active));
  const flat = [...new Set(groups.filter((g) => !g.hidden).flatMap((g) => g.models))];

  const data: ModelsResponse = {
    ok: groups.length > 0,
    models: flat,
    groups,
    ...(groups.length === 0 ? { error: "No AI connection returned a model list." } : {}),
  };
  if (data.ok) cache = { at: Date.now(), data };
  return NextResponse.json(data);
}
