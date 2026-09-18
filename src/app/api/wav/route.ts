import { NextRequest, NextResponse } from "next/server";
import { sunoApi } from "@/lib/SunoApi";
import { corsHeaders } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/wav?id=<clipId>[&url=1]
 * Returns SUNO'S ORIGINAL WAV for the clip (server-side converted by Suno,
 * downloaded as-is — no transcoding).
 *
 * Flow (verified suno.com desktop "Download → WAV"):
 *   POST /api/billing/clips/{id}/download/  (charges 1 download credit, idempotent)
 *   POST /api/gen/{id}/convert_wav/         (idempotent)
 *   poll GET /api/gen/{id}/wav_file/        → { wav_file_url }
 *
 * Default: streams the WAV bytes (audio/wav, attachment).
 * With &url=1: returns JSON { clip_id, wav_file_url } instead.
 */
export async function GET(req: NextRequest) {
  try {
    const clipId = req.nextUrl.searchParams.get("id");
    if (!clipId) {
      return new NextResponse(JSON.stringify({ error: "Missing parameter: id" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    let url: string | null = null;
    let lastError: any = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        url = await (await sunoApi()).getWavFileUrl(clipId);
        break;
      } catch (err: any) {
        lastError = err;
        console.error(`WAV attempt ${attempt + 1} failed:`, err?.message);
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
    if (!url) throw lastError;

    if (req.nextUrl.searchParams.get("url") === "1") {
      return new NextResponse(JSON.stringify({ clip_id: clipId, wav_file_url: url }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    const wavResp = await fetch(url);
    if (!wavResp.ok || !wavResp.body) {
      throw new Error(`WAV CDN download failed: HTTP ${wavResp.status}`);
    }
    const bytes = new Uint8Array(await wavResp.arrayBuffer());

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": String(bytes.length),
        "Content-Disposition": `attachment; filename="${clipId}.wav"`,
        "Cache-Control": "public, max-age=86400",
        ...corsHeaders
      }
    });
  } catch (error: any) {
    console.error("Error fetching WAV:", error?.message);
    return new NextResponse(JSON.stringify({ error: "WAV fetch failed", detail: error?.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }
}

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 200, headers: corsHeaders });
}
