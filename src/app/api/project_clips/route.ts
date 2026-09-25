import { NextRequest, NextResponse } from "next/server";
import { sunoApi } from "@/lib/SunoApi";
import { corsHeaders } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * POST /api/project_clips
 * Files clips into a Suno workspace (internally a "project").
 *
 * JSON body: { workspace_id, clip_ids: string[] }
 * Response: Suno's raw response from POST /api/project/{workspace_id}/clips
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { workspace_id, clip_ids } = body || {};

    if (!workspace_id) {
      return NextResponse.json({ error: "workspace_id required" }, { status: 400, headers: corsHeaders });
    }
    const ids = Array.isArray(clip_ids) ? clip_ids : [clip_ids].filter(Boolean);
    if (!ids.length) {
      return NextResponse.json({ error: "clip_ids required" }, { status: 400, headers: corsHeaders });
    }

    const result = await (await sunoApi()).addToProject(String(workspace_id), ids.map(String));
    return NextResponse.json(result ?? { ok: true }, { status: 200, headers: corsHeaders });
  } catch (error: any) {
    console.error("Error filing clips to workspace:", error);
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