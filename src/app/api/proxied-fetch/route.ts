import { NextRequest, NextResponse } from "next/server";
import { agentFor, isBlockStatus, pickProxy, ProxyPoolExhausted, reportBlocked, reportOk } from "@/lib/proxyPool";
import https from "https";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/proxied-fetch
 * Generic pass-through: forwards an HTTP request through the outbound
 * residential proxy (SUNO_PROXY_URL) and returns the raw response.
 *
 * Spec (JSON body):
 *   { method, url, headers?, bodyB64?, direct?: true, session?: "<stable key>" }
 *
 * Response:
 *   { statusCode, statusMessage, headers (incl. set-cookie), bodyB64 }
 *
 * Protected by the API_BEARER_TOKEN middleware like every other /api route.
 * HTTPS-only, private/internal hosts blocked.
 */
export async function POST(req: NextRequest) {
  try {
    const spec = await req.json();
    const method = String(spec.method || "GET").toUpperCase();
    const url = String(spec.url || "");
    if (!/^https:\/\//i.test(url)) {
      return NextResponse.json({ error: "https URLs only" }, { status: 400 });
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return NextResponse.json({ error: "invalid url" }, { status: 400 });
    }
    const host = parsed.hostname;
    const isPrivate =
      /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|::1|\[?fe80|\[?fd)/i.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host);
    if (isPrivate) {
      return NextResponse.json({ error: "private/internal hosts not allowed" }, { status: 403 });
    }

    const fwdHeaders: Record<string, string> = { ...(spec.headers || {}) };
    delete fwdHeaders["Host"];
    delete fwdHeaders["host"];
    delete fwdHeaders["Content-Length"];
    delete fwdHeaders["content-length"];
    const bodyBuf = spec.bodyB64 ? Buffer.from(spec.bodyB64, "base64") : null;
    // S3 (and other strict servers) reject chunked uploads — always send an explicit Content-Length for a fully-buffered body
    if (bodyBuf) fwdHeaders["Content-Length"] = String(bodyBuf.length);

    const send = (agent: any) =>
      new Promise<any>((resolve, reject) => {
        const httpReq = https.request(
          url,
          { method, headers: fwdHeaders, agent, timeout: 120000 },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () =>
              resolve({
                statusCode: res.statusCode,
                statusMessage: res.statusMessage,
                headers: { ...res.headers },
                bodyB64: Buffer.concat(chunks).toString("base64")
              })
            );
          }
        );
        httpReq.on("timeout", () => httpReq.destroy(new Error("proxied-fetch timeout 120s")));
        httpReq.on("error", reject);
        if (bodyBuf && method !== "GET" && method !== "HEAD") httpReq.write(bodyBuf);
        httpReq.end();
      });

    // direct:true skips the residential proxy entirely (large S3 uploads: S3 accepts datacenter
    // IPs and the proxy uplink is too slow to be worth it)
    if (spec.direct === true) return NextResponse.json(await send(undefined));

    // Try up to three sessions. A 403/429 is this IP being refused, so rotate; anything else is
    // the page's own answer and is returned as-is.
    const tried: string[] = [];
    let result: any = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      let entry;
      try {
        entry = pickProxy(spec.session ? String(spec.session) : undefined, tried);
      } catch (e: any) {
        if (e instanceof ProxyPoolExhausted) {
          return NextResponse.json(
            { error: "proxy pool exhausted", detail: e.message, rotatedThrough: tried },
            { status: 503 }
          );
        }
        throw e;
      }
      tried.push(entry.id);
      result = await send(agentFor(entry));
      if (!isBlockStatus(result.statusCode)) {
        reportOk(entry);
        return NextResponse.json({ ...result, proxySession: entry.id });
      }
      reportBlocked(entry, `HTTP ${result.statusCode} from ${parsed.hostname}`);
    }

    // every attempt was refused — hand back the last response plus what was tried, so the caller
    // can tell "the site blocked us" apart from "the page 404'd"
    return NextResponse.json({ ...result, proxyRotatedThrough: tried, proxyAllBlocked: true });
  } catch (error: any) {
    console.error("proxied-fetch failed:", error?.message);
    return NextResponse.json({ error: "proxied fetch failed", detail: error?.message }, { status: 502 });
  }
}

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" } });
}
