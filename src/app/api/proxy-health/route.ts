import { NextResponse } from "next/server";
import { poolHealth } from "@/lib/proxyPool";

export const dynamic = "force-dynamic";

/** GET /api/proxy-health — how much of the proxy pool is usable right now.
 *  `healthy: 0` means every session is blocked and outbound calls will 503 until one lapses or
 *  more sessions are added to SUNO_PROXY_POOL. Session ids only; never credentials. */
export async function GET() {
  const h = poolHealth();
  return NextResponse.json({ ...h, ok: h.healthy > 0 }, { status: h.healthy > 0 ? 200 : 503 });
}
