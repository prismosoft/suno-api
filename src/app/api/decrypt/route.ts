import { NextRequest, NextResponse } from "next/server";
import { sunoApi } from "@/lib/SunoApi";
import { corsHeaders } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/decrypt?id=<clipId>
 * Returns the clip's audio DECRYPTED as a playable MP4 (audio/opus) stream.
 * Upstream CDN media is AES-CTR-encrypted; this endpoint decrypts server-side.
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

    const buffer = await (await sunoApi()).decryptClipMedia(clipId);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "audio/mp4",
        "Content-Length": String(buffer.length),
        "Content-Disposition": `inline; filename="${clipId}.m4a"`,
        "Cache-Control": "public, max-age=86400",
        ...corsHeaders
      }
    });
  } catch (error: any) {
    console.error("Error decrypting clip:", error?.message);
    return new NextResponse(JSON.stringify({ error: "Decrypt failed", detail: error?.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }
}

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 200, headers: corsHeaders });
}