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

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  const conn = listConnections().find((c) => c.id === id);
  if (!conn) return NextResponse.json({ ok: false, message: "Connection not found." }, { status: 404 });

  let cfg: Record<string, any> = {};
  try { cfg = JSON.parse(conn.config || "{}"); } catch { cfg = {}; }
  const secret = getConnectionSecret(id);

  let result: { ok: boolean; message: string };
  if (conn.kind === "github") {
    if (!secret) return NextResponse.json({ ok: false, message: "No token stored for this connection." });
    result = await testGithub(secret);
  } else if (conn.kind === "gitlab") {
    if (!secret) return NextResponse.json({ ok: false, message: "No token stored for this connection." });
    result = await testGitlab(secret, String(cfg.apiUrl || "https://gitlab.com/api/v4"));
  } else if (conn.kind === "database") {
    result = await testDatabase(
      {
        type: cfg.engine === "mysql" ? "mysql" : "postgres",
        host: String(cfg.host ?? "localhost"),
        port: Number(cfg.port) || (cfg.engine === "mysql" ? 3306 : 5432),
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
