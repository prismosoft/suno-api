import { NextRequest, NextResponse } from "next/server";
import { corsHeaders } from "@/lib/utils";
import { CoverArt, resizeCover } from "@/lib/audioTags";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/cover
 * Normalizes album art to an exact square size and returns the image bytes.
 *
 * Release artwork must be 3000x3000, but no image model on Runware can render that: they cap
 * total pixels below it (Qwen-Image 2048x2048, Qwen-Image-3.0 2560x2560, gpt-image 2880x2880).
 * The cover pipeline therefore generates at each model's maximum and sizes it here, so the
 * stored artwork is the same 3000x3000 regardless of which model drew it.
 *
 * JSON body:
 *   { image_url | image_b64, size?: number (default 3000), format?: "png"|"jpeg" (default "png") }
 * Response: the resized image (image/png | image/jpeg), X-Cover-Bytes and X-Cover-Size headers.
 */
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();

    let data: Buffer;
    if (b.image_b64) {
      data = Buffer.from(String(b.image_b64), "base64");
    } else if (b.image_url) {
      const r = await fetch(String(b.image_url));
      if (!r.ok) {
        return NextResponse.json({ error: `download failed ${r.status}` }, { status: 502, headers: corsHeaders });
      }
      data = Buffer.from(await r.arrayBuffer());
    } else {
      return NextResponse.json({ error: "image_url or image_b64 required" }, { status: 400, headers: corsHeaders });
    }

    const size = Number(b.size) > 0 ? Math.round(Number(b.size)) : 3000;
    const format = b.format === "jpeg" || b.format === "jpg" ? "jpeg" : "png";

    const isPng = data.subarray(0, 4).toString("hex") === "89504e47";
    const input: CoverArt = { data, mime: isPng ? "image/png" : "image/jpeg" };
    const out = await resizeCover(input, size, format);

    return new NextResponse(new Uint8Array(out.data), {
      status: 200,
      headers: {
        "Content-Type": out.mime,
        "Content-Length": String(out.data.length),
        "X-Cover-Bytes": String(out.data.length),
        "X-Cover-Size": String(size),
        ...corsHeaders,
      },
    });
  } catch (error: any) {
    console.error("Error normalizing cover:", error);
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500, headers: corsHeaders });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}
