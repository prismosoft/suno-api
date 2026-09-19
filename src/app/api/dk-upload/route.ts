import { NextRequest, NextResponse } from "next/server";
import https from "https";
import { sunoApi } from "@/lib/SunoApi";
import { corsHeaders } from "@/lib/utils";
import { AudioTags, coverToJpeg, tagWav } from "@/lib/audioTags";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/dk-upload
 * Tags a release file and uploads it to DistroKid's S3 policy endpoint in one hop, so the
 * orchestrator never holds the bytes (n8n's task runner dies on 40MB+ buffers).
 *
 * Body:
 *   { kind: "song" | "cover",
 *     clip_id?, audio_url?,            // song: Suno clip (WAV is fetched/converted) or a direct URL
 *     cover_url?,                      // song: embedded as art; cover: the image itself
 *     tags?: {...},                    // song: title/artist/album/label/genre/year/copyright/composer/lyrics
 *     upload_url, key_prefix, filename, content_type, acl,
 *     accessKeyId, policy, signature, user_id }
 *
 * The final S3 key is "<key_prefix><byte size>--<filename>", which DistroKid derives from the file itself.
 * Response: { ok, status, key, size }
 */
async function download(url: string): Promise<Buffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download failed ${r.status}: ${url.slice(0, 120)}`);
  return Buffer.from(await r.arrayBuffer());
}

function postMultipart(url: string, fields: Record<string, string>, file: { name: string; filename: string; type: string; data: Buffer }) {
  const boundary = "----rhrdk" + Date.now();
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  // S3 requires the file part last
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\nContent-Type: ${file.type}\r\nContent-Transfer-Encoding: binary\r\n\r\n`));
  parts.push(file.data, Buffer.from(`\r\n--${boundary}--\r\n`));
  const body = Buffer.concat(parts);

  return new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
    const req = https.request(
      url,
      { method: "POST", headers: { "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": String(body.length) }, timeout: 240000 },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8").slice(0, 600) }));
      }
    );
    req.on("timeout", () => req.destroy(new Error("dk-upload: S3 timeout")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const kind = String(b.kind || "");
    for (const k of ["upload_url", "key_prefix", "filename", "accessKeyId", "policy", "signature", "user_id"]) {
      if (!b[k]) return NextResponse.json({ error: `missing ${k}` }, { status: 400, headers: corsHeaders });
    }

    let data: Buffer;
    let contentType = String(b.content_type || "");
    if (kind === "cover") {
      if (!b.cover_url) return NextResponse.json({ error: "missing cover_url" }, { status: 400, headers: corsHeaders });
      data = (await coverToJpeg({ data: await download(String(b.cover_url)), mime: "image/png" })).data;
      contentType = "image/jpeg";
    } else if (kind === "song") {
      const url = b.audio_url ? String(b.audio_url) : await (await sunoApi()).getWavFileUrl(String(b.clip_id));
      data = await download(url);
      const cover = b.cover_url ? await coverToJpeg({ data: await download(String(b.cover_url)), mime: "image/png" }) : undefined;
      data = tagWav(data, (b.tags || {}) as AudioTags, cover);
      contentType = contentType || "audio/wav";
    } else {
      return NextResponse.json({ error: "kind must be song or cover" }, { status: 400, headers: corsHeaders });
    }

    const key = `${b.key_prefix}${data.length}--${b.filename}`;
    const r = await postMultipart(
      String(b.upload_url),
      {
        key,
        acl: String(b.acl || "authenticated-read"),
        "Content-Type": contentType,
        AWSAccessKeyId: String(b.accessKeyId),
        policy: String(b.policy),
        signature: String(b.signature),
        "x-amz-meta-user-id": String(b.user_id),
      },
      { name: "file", filename: String(b.filename), type: contentType, data }
    );
    if (r.statusCode < 200 || r.statusCode >= 300) {
      return NextResponse.json({ error: `S3 HTTP ${r.statusCode}: ${r.body}`, key, size: data.length }, { status: 502, headers: corsHeaders });
    }
    return NextResponse.json({ ok: true, status: r.statusCode, key, size: data.length }, { headers: corsHeaders });
  } catch (error: any) {
    console.error("dk-upload failed:", error?.message);
    return NextResponse.json({ error: error?.message || "dk-upload failed" }, { status: 500, headers: corsHeaders });
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 200, headers: corsHeaders });
}
