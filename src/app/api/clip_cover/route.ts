import { NextRequest, NextResponse } from "next/server";
import { sunoApi } from "@/lib/SunoApi";
import { CoverArt, resizeCover } from "@/lib/audioTags";
import { corsHeaders } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/clip_cover
 * Sets a custom cover image on a Suno clip.
 *
 * Downloads the image from `image_url`, uploads it through Suno's presigned
 * image flow (moderation-gated), then applies it as the clip's cover via
 * POST /api/gen/{clip_id}/set_metadata/.
 *
 * JSON body:
 *   { clip_id, image_url, size?: number (default 1024), format?: "jpeg"|"png" (default "jpeg") }
 * Response: { ok, upload_id, image_url, moderation_status }
 *
 * Suno clip covers render as squares; artwork is normalized to `size`x`size`
 * JPEG (JPEG keeps the upload small; Suno re-encodes anyway).
 */
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const clipId = String(b?.clip_id || "");
    const imageUrl = String(b?.image_url || "");
    if (!clipId || !imageUrl) {
      return NextResponse.json({ error: "clip_id and image_url required" }, { status: 400, headers: corsHeaders });
    }

    const size = Number(b?.size) > 0 ? Math.round(Number(b.size)) : 1024;
    const format = b?.format === "png" ? "png" : "jpeg";

    // Reuse the square normalizer from /api/cover so the artwork is exactly
    // size x size regardless of the source aspect ratio.
    const api = await sunoApi();

    // 1. download the artwork
    const dl = await fetch(imageUrl);
    if (!dl.ok) {
      return NextResponse.json({ error: `download failed ${dl.status}` }, { status: 502, headers: corsHeaders });
    }
    let bytes = Buffer.from(await dl.arrayBuffer());

    // 2. normalize to an exact square via the shared resizer
    const isPng = bytes.subarray(0, 4).toString("hex") === "89504e47";
    const cover: CoverArt = { data: bytes, mime: isPng ? "image/png" : "image/jpeg" };
    const out = await resizeCover(cover, size, format);
    bytes = out.data;

    // 3. presigned upload to Suno
    const ext = format === "png" ? "png" : "jpeg";
    const upload = await api.createImageUpload(ext);
    const fields: Record<string, string> = upload?.fields || {};
    const contentType =
      (Object.entries(fields || {}).find(([k]) => k.toLowerCase() === "content-type") || [])[1] ||
      (format === "png" ? "image/png" : "image/jpeg");
    await api.uploadPresignedImage(upload.url, fields, `${upload.id}.${ext}`, contentType, bytes);

    // 4. finish + moderation check
    const finish = await api.finishImageUpload(upload.id);
    if (finish?.moderation_status && finish.moderation_status !== "approved") {
      return NextResponse.json(
        { error: `image moderation: ${finish.moderation_status}`, upload_id: upload.id },
        { status: 422, headers: corsHeaders }
      );
    }

    // 5. apply as the clip cover — via image_url (the upload is already on
    // Suno's CDN). This is the pattern sunox's recovery flow uses; image_s3_id
    // alone was observed to no-op on set_metadata.
    const coverUrl = `https://cdn2.suno.ai/image_${upload.id}.jpeg`;
    await api.setClipMetadata(clipId, { image_url: coverUrl });

    return NextResponse.json(
      { ok: true, clip_id: clipId, upload_id: upload.id, image_url: coverUrl },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: any) {
    console.error("Error setting clip cover:", error);
    const status = error?.response?.status || 500;
    return NextResponse.json(
      { error: error?.response?.data?.detail || error?.message || String(error) },
      { status, headers: corsHeaders }
    );
  }
}

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 200, headers: corsHeaders });
}