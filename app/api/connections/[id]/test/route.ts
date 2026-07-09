/**
 * POST /api/connections/:id/test — verify a saved connection using its stored
 * config + secret. Returns { ok, message }.
 */
import { NextRequest, NextResponse } from "next/server";
import { listConnections } from "@/lib/connections-db";
import { getConnectionSecret } from "@/lib/config";
import {
  testGithub,
  testGitlab,
  testDatabase,
  testRedis,
  testGrafana,
  testPrometheus,
  testLoki,
} from "@/lib/connections";
import { testAiConnection, testAiVision, detectProvider } from "@/lib/ai";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  const conn = listConnections().find((c) => c.id === id);
  if (!conn) return NextResponse.json({ ok: false, message: "Connection not found." }, { status: 404 });

  let cfg: Record<string, any> = {};
  try { cfg = JSON.parse(conn.config || "{}"); } catch { cfg = {}; }
  const secret = getConnectionSecret(id);

  let result: { ok: boolean; message: string };
  if (conn.kind === "ai") {
    if (!secret) return NextResponse.json({ ok: false, message: "No API key stored for this connection." });
    const baseUrl = String(cfg.baseUrl || "https://api.anthropic.com");
    // Resolve "auto" to a concrete provider via URL detection so the test
    // always uses the correct wire format (OpenAI vs Anthropic vs Gemini).
    const resolvedProvider =
      cfg.provider && cfg.provider !== "auto"
        ? (cfg.provider as any)
        : detectProvider(baseUrl);
    const aiParams = {
      baseUrl,
      model: String(cfg.model || ""),
      apiKey: secret,
      provider: resolvedProvider,
    };
    result = await testAiConnection(aiParams);
    if (result.ok) {
      // Also verify the endpoint actually passes images through to the model.
      const vision = await testAiVision(aiParams);
      result = { ok: result.ok, message: `${result.message} · ${vision.message}` };
    }
  } else if (conn.kind === "github") {
    if (!secret) return NextResponse.json({ ok: false, message: "No token stored for this connection." });
    result = await testGithub(secret);
  } else if (conn.kind === "gitlab") {
    if (!secret) return NextResponse.json({ ok: false, message: "No token stored for this connection." });
    result = await testGitlab(secret, String(cfg.apiUrl || "https://gitlab.com/api/v4"));
  } else if (conn.kind === "database") {
    result = await testDatabase(
      {
        type: (cfg.engine === "mysql" || cfg.engine === "mariadb") ? "mysql" : "postgres",
        host: String(cfg.host ?? "localhost"),
        port: Number(cfg.port) || (cfg.engine === "mysql" || cfg.engine === "mariadb" ? 3306 : 5432),
        user: String(cfg.user ?? ""),
        database: String(cfg.database ?? ""),
        ssl: !!cfg.ssl,
      },
      secret
    );
  } else if (conn.kind === "grafana") {
    if (!secret) return NextResponse.json({ ok: false, message: "No API token stored for this connection." });
    result = await testGrafana(String(cfg.url ?? ""), secret);
  } else if (conn.kind === "prometheus") {
    result = await testPrometheus(String(cfg.url ?? ""), String(cfg.username ?? "") || undefined, secret);
  } else if (conn.kind === "loki") {
    result = await testLoki(String(cfg.url ?? ""), String(cfg.username ?? "") || undefined, secret);
  } else {
    result = await testRedis(
      {
        host: String(cfg.host ?? "localhost"),
        port: Number(cfg.port) || 6379,
        username: String(cfg.username ?? ""),
        db: Number(cfg.db) || 0,
        tls: !!cfg.tls,
      },
      secret
    );
  }
  return NextResponse.json(result);
}
