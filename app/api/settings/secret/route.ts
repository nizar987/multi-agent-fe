import { NextRequest, NextResponse } from "next/server";
import { setSecret, deleteSecret, getSecret, secretTail, SecretName } from "@/lib/config";
import { assertLocalRequest } from "@/lib/local-only";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const VALID: SecretName[] = ["aiApiKey", "githubToken", "gitlabToken", "dbPassword", "redisPassword", "tavilyApiKey", "sharedDbUrl"];

export async function POST(req: NextRequest) {
  // 🔴 CRITICAL: secrets must only be accessible from localhost
  const guard = assertLocalRequest(req);
  if (guard) return guard;

  const body = await req.json();
  const { name, value, action } = body;

  if (!VALID.includes(name as SecretName)) {
    return NextResponse.json({ error: "unknown secret" }, { status: 400 });
  }

  if (action === "reveal") {
    // PRD §6.6: log access, return value only to local client
    // Never log the value itself — only that it was revealed.
    logger.info(`Secret reveal accessed: ${name} (tail: ${secretTail(name as SecretName) ?? "(not set)"})`);
    const val = getSecret(name as SecretName);
    if (val === null) {
      return NextResponse.json({ value: null });
    }
    return NextResponse.json({ value: val });
  }

  if (typeof value !== "string" || !value.trim()) {
    return NextResponse.json({ error: "empty value" }, { status: 400 });
  }

  // Reject excessively large values (> 8 KB) — real API keys are never this long
  if (value.length > 8192) {
    return NextResponse.json({ error: "value too long" }, { status: 400 });
  }

  setSecret(name as SecretName, value.trim());
  logger.info(`Secret updated: ${name}`);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const guard = assertLocalRequest(req);
  if (guard) return guard;

  const body = await req.json();
  const { name } = body;

  if (!VALID.includes(name as SecretName)) {
    return NextResponse.json({ error: "unknown secret" }, { status: 400 });
  }

  deleteSecret(name as SecretName);
  logger.info(`Secret deleted: ${name}`);
  return NextResponse.json({ ok: true });
}
