/**
 * local-only.ts — middleware guard for sensitive API routes.
 *
 * This app runs as a local Electron desktop app. Routes that deal with
 * secrets, shell approval, or destructive operations must only be
 * reachable from localhost. This module provides a reusable check so
 * every sensitive route can enforce it with one line.
 *
 * Usage:
 *   import { assertLocalRequest } from "@/lib/local-only";
 *   const guard = assertLocalRequest(req);
 *   if (guard) return guard; // returns 403 Response if not local
 */
import { NextRequest, NextResponse } from "next/server";

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost", "::ffff:127.0.0.1", "[::1]"]);

/**
 * Strip the port from a Host-style value.
 * A bare IPv6 address ("::1", "::ffff:127.0.0.1") has several colons and no
 * port — splitting on the last colon would turn "::1" into "::".
 */
function hostname(value: string): string {
  const v = value.trim();
  if (v.startsWith("[")) return v.slice(0, v.indexOf("]") + 1); // [::1]:3210 → [::1]
  const colon = v.indexOf(":");
  if (colon === -1) return v;                                    // host, no port
  if (v.indexOf(":", colon + 1) !== -1) return v;                // bare IPv6
  return v.slice(0, colon);                                      // host:port
}

const isLoopback = (name: string) => LOOPBACK.has(name.trim().toLowerCase());

/**
 * True when the request was addressed to a loopback host and every recorded
 * hop is loopback too.
 *
 * `x-forwarded-for` / `x-real-ip` are NEVER read as proof of locality — they
 * are set by the client, so `X-Forwarded-For: 127.0.0.1` would otherwise turn
 * this guard into a no-op. They are only read to DISQUALIFY a request: if any
 * hop names a non-loopback address, the request was relayed from elsewhere.
 * (Local tooling does front the dev server and sets these to ::1, so their
 * mere presence cannot be treated as hostile.)
 *
 * The real boundary is the listening socket: the packaged app binds the server
 * to 127.0.0.1 (electron/main.js). This check is defense in depth on top.
 */
export function isLocalRequest(req: NextRequest): boolean {
  const hops = [
    ...(req.headers.get("x-forwarded-for") ?? "").split(","),
    req.headers.get("x-real-ip") ?? "",
  ].filter((h) => h.trim());
  if (hops.some((h) => !isLoopback(hostname(h)))) return false;

  const host = req.headers.get("host") ?? req.headers.get("x-forwarded-host");
  // Fall back to the parsed URL when there is no Host header.
  return isLoopback(host ? hostname(host) : req.nextUrl.hostname);
}

/**
 * Returns a 403 NextResponse if the request is NOT from localhost.
 * Returns null if the request is allowed (caller should continue normally).
 */
export function assertLocalRequest(req: NextRequest): NextResponse | null {
  if (isLocalRequest(req)) return null;
  return NextResponse.json(
    { error: "forbidden — this endpoint is only accessible from localhost" },
    { status: 403 }
  );
}
