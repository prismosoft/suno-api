import { NextRequest, NextResponse } from "next/server";
import { sunoApi } from "@/lib/SunoApi";
import { corsHeaders } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const ids: string[] = Array.isArray(body.ids)
      ? body.ids
      : body.id
        ? [body.id]
        : [];
    const trash = body.trash !== false;

    if (!ids.length || ids.some((i) => !i)) {
      return new NextResponse(
        JSON.stringify({ error: "Missing parameter: ids (array of clip IDs)" }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders
          }
        }
      );
    }

    const result = await (await sunoApi()).deleteClips(ids, trash);

    return new NextResponse(
      JSON.stringify({ success: true, trashed: trash, deleted: ids, result: result ?? null }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders
        }
      }
    );
  } catch (error: any) {
    const upStatus = error?.response?.status;
    console.error(
      "Error deleting clip(s):",
      upStatus,
      error?.message,
      JSON.stringify(error?.response?.data)?.slice(0, 500)
    );

    // Clip(s) not found upstream -> nothing to delete; treat as success (idempotent).
    if (upStatus === 404) {
      return new NextResponse(
        JSON.stringify({ success: true, trashed: trash, deleted: ids, note: "clip(s) not found upstream (already deleted?)" }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders
          }
        }
      );
    }

    const status = upStatus === 403 ? 422 : 500;
    return new NextResponse(
      JSON.stringify({
        error: "Delete failed",
        detail: error?.response?.status
          ? `upstream ${error.response.status}: ${JSON.stringify(error.response.data).slice(0, 300)}`
          : error?.message
      }),
      {
        status,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders
        }
      }
    );
  }
}

export async function OPTIONS(request: Request) {
  return new Response(null, {
    status: 200,
    headers: corsHeaders
  });
}