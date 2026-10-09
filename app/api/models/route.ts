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
import { getModelsCache, setModelsCache } from "@/lib/model-cache";

export const dynamic = "force-dynamic";

interface ModelGroup {
  name: string;
  active: boolean;
  models: string[];
}
interface ModelsResponse {
  ok: boolean;
  models: string[];
  groups: ModelGroup[];
  error?: string;
}

const TTL_MS = 60_000;

export async function GET() {
  const cached = getModelsCache();
  if (cached && Date.now() - cached.at < TTL_MS) return NextResponse.json(cached.data);

  const conns = listByKind("ai");

  // No saved AI connections yet — fall back to the legacy single config.
  if (conns.length === 0) {
    const d = await listModels();
    const data: ModelsResponse = {
      ...d,
      groups: d.ok ? [{ name: "AI Provider", active: true, models: d.models }] : [],
    };
    if (d.ok) setModelsCache({ at: Date.now(), data });
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

      // NVIDIA NIM: skip API fetch — use the models[] array stored in config.
      // Fall back to single cfg.model for connections saved before multi-select.
      const isNvidia = baseUrl.toLowerCase().includes("nvidia.com");
      if (isNvidia) {
        let nimModels: string[] = [];
        if (Array.isArray(cfg.models) && cfg.models.length > 0) {
          nimModels = cfg.models.map((m: any) => String(m).trim()).filter(Boolean);
        } else if (cfg.model) {
          nimModels = [String(cfg.model).trim()].filter(Boolean);
        }
        return { conn: c, baseUrl, provider, ok: nimModels.length > 0, models: nimModels };
      }

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
    groups.push({ name: r.conn.name, active: !!r.conn.is_active, models: r.models });
  }
  setModelRoutes(routeMap);

  // Flat list: active connection's models first, then the rest, deduplicated.
  groups.sort((a, b) => Number(b.active) - Number(a.active));
  const flat = [...new Set(groups.flatMap((g) => g.models))];

  const data: ModelsResponse = {
    ok: groups.length > 0,
    models: flat,
    groups,
    ...(groups.length === 0 ? { error: "No AI connection returned a model list." } : {}),
  };
  if (data.ok) setModelsCache({ at: Date.now(), data });
  return NextResponse.json(data);
}
