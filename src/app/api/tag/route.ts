import { NextRequest, NextResponse } from "next/server";
import { corsHeaders } from "@/lib/utils";
import { AudioTags, CoverArt, coverToJpeg, tagM4a, tagWav } from "@/lib/audioTags";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/tag
 * Embeds release metadata + cover art into an audio file and returns the tagged bytes.
 *
 * JSON body:
 *   { audio_url | audio_b64, format?: "wav"|"m4a" (default: sniffed),
 *     cover_url?, title, artist, album?, album_artist?, label?, genre?, year?,
 *     copyright?, composer?, comment?, lyrics?, track?, isrc? }
 *
 * WAV: RIFF LIST/INFO + ID3v2.4 "id3 " chunk (incl. APIC cover); audio data untouched.
 * M4A: ffmpeg; AAC is stream-copied, anything else (Suno ships Opus-in-MP4) -> AAC 256k. Cover as attached picture.
 * Cover is normalized to a 3000x3000 JPEG for both formats.
 * Response: the tagged file (audio/wav | audio/mp4), X-Tagged-Bytes header.
 */
async function fetchBuf(url: string): Promise<{ data: Buffer; type: string }> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download failed ${r.status}: ${url.slice(0, 120)}`);
  return { data: Buffer.from(await r.arrayBuffer()), type: r.headers.get("content-type") || "" };
}

function sniff(buf: Buffer): "wav" | "m4a" | null {
  if (buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WAVE") return "wav";
  if (buf.toString("latin1", 4, 8) === "ftyp") return "m4a";
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    let audio: Buffer;
    if (b.audio_b64) audio = Buffer.from(String(b.audio_b64), "base64");
    else if (b.audio_url) audio = (await fetchBuf(String(b.audio_url))).data;
    else return NextResponse.json({ error: "audio_url or audio_b64 required" }, { status: 400, headers: corsHeaders });

    const format = (b.format || sniff(audio)) as "wav" | "m4a" | null;
    if (format !== "wav" && format !== "m4a") {
      return NextResponse.json({ error: "unsupported audio format (wav or m4a)" }, { status: 400, headers: corsHeaders });
    }

    let cover: CoverArt | undefined;
    if (b.cover_url) {
      const c = await fetchBuf(String(b.cover_url));
      const isPng = c.data.subarray(0, 4).toString("hex") === "89504e47";
      cover = { data: c.data, mime: isPng ? "image/png" : "image/jpeg" };
      cover = await coverToJpeg(cover);
    }

    const keys: (keyof AudioTags)[] = ["title", "artist", "album", "album_artist", "label", "genre", "year",
      "copyright", "composer", "comment", "lyrics", "track", "isrc"];
    const tags: AudioTags = {};
    for (const k of keys) if (b[k] !== undefined && b[k] !== null && b[k] !== "") tags[k] = String(b[k]);
    if (!tags.album && tags.title) tags.album = tags.title; // single
    if (!tags.album_artist && tags.artist) tags.album_artist = tags.artist;

    const out = format === "wav" ? tagWav(audio, tags, cover) : await tagM4a(audio, tags, cover);
    return new NextResponse(new Uint8Array(out), {
      status: 200,
      headers: {
        "Content-Type": format === "wav" ? "audio/wav" : "audio/mp4",
        "Content-Length": String(out.length),
        "X-Tagged-Bytes": String(out.length),
        ...corsHeaders
      }
    });
  } catch (error: any) {
    console.error("tag error:", error?.message);
    return NextResponse.json({ error: error?.message || "tag failed" }, { status: 500, headers: corsHeaders });
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 200, headers: corsHeaders });
}
