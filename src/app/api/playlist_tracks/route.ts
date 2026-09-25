import { NextRequest, NextResponse } from "next/server";
import { sunoApi } from "@/lib/SunoApi";
import { corsHeaders } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * POST /api/playlist_tracks
 * Adds clips to a playlist.
 *
 * JSON body: { playlist_id, clip_ids: string[] }
 * Response: Suno's raw response from POST /api/playlist/v2/{id}/tracks/add
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { playlist_id, clip_ids } = body || {};

    if (!playlist_id) {
      return NextResponse.json({ error: "playlist_id required" }, { status: 400, headers: corsHeaders });
    }
    const ids = Array.isArray(clip_ids) ? clip_ids : [clip_ids].filter(Boolean);
    if (!ids.length) {
      return NextResponse.json({ error: "clip_ids required" }, { status: 400, headers: corsHeaders });
    }

    const result = await (await sunoApi()).addToPlaylist(String(playlist_id), ids.map(String));
    return NextResponse.json(result ?? { ok: true }, { status: 200, headers: corsHeaders });
  } catch (error: any) {
    console.error("Error adding clips to playlist:", error);
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