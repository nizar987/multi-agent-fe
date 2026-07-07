import { NextRequest, NextResponse } from "next/server";
import { setSecret, deleteSecret, getSecret, SecretName } from "@/lib/config";

export const dynamic = "force-dynamic";

const VALID: SecretName[] = ["aiApiKey", "githubToken", "gitlabToken", "dbPassword", "redisPassword", "tavilyApiKey"];

export async function POST(req: NextRequest) {
  const { name, value, action } = await req.json();
  if (!VALID.includes(name)) return NextResponse.json({ error: "unknown secret" }, { status: 400 });

  if (action === "reveal") {
    // used only while the 👁 button is held
    return NextResponse.json({ value: getSecret(name) });
  }
  if (typeof value !== "string" || !value.trim()) {
    return NextResponse.json({ error: "empty value" }, { status: 400 });
  }
  setSecret(name, value.trim());
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { name } = await req.json();
  if (!VALID.includes(name)) return NextResponse.json({ error: "unknown secret" }, { status: 400 });
  deleteSecret(name);
  return NextResponse.json({ ok: true });
}
